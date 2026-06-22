// Dashboard & Favourites Controllers
// - getDashboardSummary: GET    /dashboard/summary — Core widget metrics
// - getFavourites:       GET    /favourites         — List saved universities/scholarships
// - addFavourite:        POST   /favourites         — Save a university or scholarship
// - deleteFavourite:     DELETE /favourites/:id     — Remove from favourites
// - getApplications:     GET    /applications       — List user's applications

import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../config/db.js';
import logger from '../utils/logger.js';

// ── Allowed match types (allow-list to prevent injection into DB queries) ──────
const VALID_MATCH_TYPES = new Set(['UNIVERSITY', 'SCHOLARSHIP']);

// ── GET /dashboard/summary ────────────────────────────────────────────────────
/**
 * Returns core widget metrics for the authenticated user's dashboard:
 * - Total saved matches (favourites)
 * - Total applications and breakdown by status
 * - Upcoming application deadline (nearest future deadline)
 */
export const getDashboardSummary = async (req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Fetch counts in parallel — scalar counts in one transaction, groupBy separately
    // Note: groupBy cannot be composed inside $transaction arrays due to Prisma type-widening.
    const [[savedMatchesCount, nextDeadlineApp], applicationsByStatus] = await Promise.all([
      prisma.$transaction([
        // 1. Total saved matches for this user
        prisma.savedMatch.count({ where: { userId } }),

        // 2. Nearest upcoming deadline (status not REJECTED or ACCEPTED)
        prisma.application.findFirst({
          where: {
            userId,
            deadline: { gte: new Date() },
            status: { notIn: ['REJECTED', 'ACCEPTED'] },
          },
          orderBy: { deadline: 'asc' },
          select: {
            id: true,
            deadline: true,
            status: true,
            university: {
              select: { name: true, locationCity: true, locationCountry: true },
            },
          },
        }),
      ]),

      // 3. Applications grouped by status (separate call — required by Prisma type inference)
      prisma.application.groupBy({
        by: ['status'],
        where: { userId },
        _count: { _all: true },
        orderBy: { status: 'asc' },
      }),
    ]);

    // Compute total applications count from grouped results
    const applicationsCount = applicationsByStatus.reduce((sum, g) => sum + g._count._all, 0);

    // Map status groups into a readable object { DRAFT: 2, SUBMITTED: 1, ... }
    const statusBreakdown = Object.fromEntries(
      applicationsByStatus.map((g) => [g.status, g._count._all])
    );

    res.status(200).json({
      success: true,
      data: {
        savedMatchesCount,
        applicationsCount,
        applicationsByStatus: statusBreakdown,
        nextDeadline: nextDeadlineApp ?? null,
      },
    });
  } catch (error) {
    logger.error('getDashboardSummary error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── GET /favourites ────────────────────────────────────────────────────────────
/**
 * Returns all saved matches (favourites) for the authenticated user.
 * Each match is enriched with the full University or Scholarship record it references.
 */
export const getFavourites = async (req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Fetch all saved matches for this user
    const savedMatches = await prisma.savedMatch.findMany({
      where: { userId },
      orderBy: { savedAt: 'desc' },
    });

    // Collect IDs per type so we can batch-load entities
    const universityIds = savedMatches
      .filter((m) => m.matchType === 'UNIVERSITY')
      .map((m) => m.matchId);
    const scholarshipIds = savedMatches
      .filter((m) => m.matchType === 'SCHOLARSHIP')
      .map((m) => m.matchId);

    // Parallel fetch of referenced entities
    const [universities, scholarships] = await Promise.all([
      universityIds.length > 0
        ? prisma.university.findMany({ where: { id: { in: universityIds } } })
        : Promise.resolve([]),
      scholarshipIds.length > 0
        ? prisma.scholarship.findMany({ where: { id: { in: scholarshipIds } } })
        : Promise.resolve([]),
    ]);

    // Build lookup maps for O(1) access
    const universityMap = new Map(universities.map((u) => [u.id, u]));
    const scholarshipMap = new Map(scholarships.map((s) => [s.id, s]));

    // Enrich each saved match with the referenced entity data
    const enriched = savedMatches.map((match) => {
      const entity =
        match.matchType === 'UNIVERSITY'
          ? universityMap.get(match.matchId)
          : scholarshipMap.get(match.matchId);

      return {
        id: match.id,
        matchType: match.matchType,
        matchId: match.matchId,
        savedAt: match.savedAt,
        // entity may be undefined if it was deleted after being saved
        data: entity ?? null,
      };
    });

    res.status(200).json({ success: true, data: enriched });
  } catch (error) {
    logger.error('getFavourites error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── POST /favourites ──────────────────────────────────────────────────────────
/**
 * Saves a university or scholarship as a favourite for the authenticated user.
 * Body: { matchType: 'UNIVERSITY' | 'SCHOLARSHIP', matchId: string }
 *
 * Security: userId is sourced exclusively from the verified JWT — never from the request body.
 */
export const addFavourite = async (req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { matchType, matchId } = req.body as { matchType: string; matchId: string };

    // 1. Validate matchType against a strict allow-list
    if (!matchType || !VALID_MATCH_TYPES.has(matchType)) {
      res.status(400).json({
        success: false,
        error: 'Invalid matchType. Must be UNIVERSITY or SCHOLARSHIP',
      });
      return;
    }

    // 2. Validate matchId is a non-empty string
    if (!matchId || typeof matchId !== 'string' || matchId.trim().length === 0) {
      res.status(400).json({ success: false, error: 'matchId is required' });
      return;
    }

    const sanitizedMatchId = matchId.trim();

    // 3. Verify the referenced entity actually exists in the database
    let entityExists = false;
    if (matchType === 'UNIVERSITY') {
      const uni = await prisma.university.findUnique({ where: { id: sanitizedMatchId }, select: { id: true } });
      entityExists = !!uni;
    } else {
      const schol = await prisma.scholarship.findUnique({ where: { id: sanitizedMatchId }, select: { id: true } });
      entityExists = !!schol;
    }

    if (!entityExists) {
      res.status(404).json({
        success: false,
        error: `${matchType === 'UNIVERSITY' ? 'University' : 'Scholarship'} not found`,
      });
      return;
    }

    // 4. Create the saved match — the DB has a @@unique([userId, matchType, matchId]) constraint
    const savedMatch = await prisma.savedMatch.create({
      data: { userId, matchType, matchId: sanitizedMatchId },
    });

    logger.info(`Favourite added: user=${userId}, type=${matchType}, entity=${sanitizedMatchId}`);
    res.status(201).json({ success: true, message: 'Favourite added successfully', data: savedMatch });
  } catch (error: any) {
    // Handle unique constraint violation (P2002) — user already saved this match
    if (error?.code === 'P2002') {
      res.status(409).json({ success: false, error: 'Already saved to favourites' });
      return;
    }
    logger.error('addFavourite error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── DELETE /favourites/:id ─────────────────────────────────────────────────────
/**
 * Removes a saved match by its ID.
 *
 * Security: Performs an ownership check (savedMatch.userId === req.user.id) to prevent
 * IDOR — a user cannot delete another user's favourites.
 */
export const deleteFavourite = async (req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    if (!id || typeof id !== 'string') {
      res.status(400).json({ success: false, error: 'Invalid favourite ID' });
      return;
    }

    // Find the record first to perform ownership validation
    const savedMatch = await prisma.savedMatch.findUnique({ where: { id } });

    if (!savedMatch) {
      res.status(404).json({ success: false, error: 'Favourite not found' });
      return;
    }

    // Ownership check — prevent IDOR
    if (savedMatch.userId !== userId) {
      res.status(403).json({ success: false, error: 'Forbidden: You do not own this favourite' });
      return;
    }

    await prisma.savedMatch.delete({ where: { id } });

    logger.info(`Favourite removed: id=${id}, user=${userId}`);
    res.status(200).json({ success: true, message: 'Favourite removed successfully' });
  } catch (error) {
    logger.error('deleteFavourite error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── GET /applications ──────────────────────────────────────────────────────────
/**
 * Returns all applications submitted by the authenticated user,
 * including university name and location for display.
 */
export const getApplications = async (req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const applications = await prisma.application.findMany({
      where: { userId },
      orderBy: { deadline: 'asc' },
      select: {
        id: true,
        status: true,
        deadline: true,
        programId: true,
        documents: true,
        createdAt: true,
        updatedAt: true,
        university: {
          select: {
            id: true,
            name: true,
            slug: true,
            locationCity: true,
            locationCountry: true,
            featuredImage: true,
          },
        },
      },
    });

    res.status(200).json({ success: true, data: applications });
  } catch (error) {
    logger.error('getApplications error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
