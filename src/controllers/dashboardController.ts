/**
 * Dashboard Controller
 * --------------------
 * Serves student-facing dashboard data.
 *
 * Security notes:
 * - All endpoints require authenticateJWT; user ID is read from the verified token, never from request body.
 * - Ownership is enforced at the DB query level (every query scopes to req.user.id).
 * - Pagination inputs are clamped to prevent memory/DoS abuse.
 * - matchType is validated against a hard-coded allow-list to prevent enumeration attacks.
 */

import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../config/db.js';
import logger from '../utils/logger.js';

/** Safe pagination defaults */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function getPagination(query: Record<string, unknown>) {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(query.limit ?? String(DEFAULT_LIMIT)), 10) || DEFAULT_LIMIT));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

// ── GET /dashboard/summary ────────────────────────────────────────────────────
/**
 * Returns headline metrics for the authenticated student's dashboard:
 * profile completion, saved matches, applications count, onboarding status,
 * and count of recommended scholarships available.
 */
export const getDashboardSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized: Missing user credentials' });
      return;
    }

    const [user, savedMatchesCount, applicationsCount, onboarding, scholarshipCount] = await prisma.$transaction([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          firstName: true,
          lastName: true,
          email: true,
          profileCompletionPercent: true,
          role: true,
        },
      }),
      prisma.savedMatch.count({ where: { userId } }),
      prisma.application.count({ where: { userId } }),
      prisma.userOnboarding.findUnique({ where: { userId }, select: { isCompleted: true } }),
      prisma.scholarship.count(),
    ]);

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        user: {
          firstName: user.firstName,
          lastName: user.lastName,
          // Mask email: only show domain for privacy (e.g. "***@gmail.com")
          email: user.email.replace(/^[^@]+/, '***'),
          role: user.role,
        },
        profileCompletionPercent: user.profileCompletionPercent,
        onboardingCompleted: onboarding?.isCompleted ?? false,
        savedMatchesCount,
        applicationsCount,
        availableScholarshipsCount: scholarshipCount,
      },
    });
  } catch (error) {
    logger.error('getDashboardSummary error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── GET /favourites ───────────────────────────────────────────────────────────
/**
 * Returns the authenticated user's paginated saved matches,
 * hydrated with the relevant university or scholarship data.
 */
export const getFavourites = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized: Missing user credentials' });
      return;
    }

    const { page, limit, skip } = getPagination(req.query as Record<string, unknown>);

    const [total, matches] = await prisma.$transaction([
      prisma.savedMatch.count({ where: { userId } }),
      prisma.savedMatch.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { savedAt: 'desc' },
      }),
    ]);

    // Hydrate match details in a single pass
    const universityIds = matches
      .filter((m) => m.matchType === 'UNIVERSITY')
      .map((m) => m.matchId);

    const scholarshipIds = matches
      .filter((m) => m.matchType === 'SCHOLARSHIP')
      .map((m) => m.matchId);

    const [universities, scholarships] = await prisma.$transaction([
      prisma.university.findMany({
        where: { id: { in: universityIds } },
        select: { id: true, name: true, locationCity: true, locationCountry: true, featuredImage: true, rankingGlobal: true, isPartner: true },
      }),
      prisma.scholarship.findMany({
        where: { id: { in: scholarshipIds } },
        select: { id: true, title: true, provider: true, amountType: true, amountValue: true, deadline: true, category: true },
      }),
    ]);

    const uniMap = new Map(universities.map((u) => [u.id, u]));
    const scholMap = new Map(scholarships.map((s) => [s.id, s]));

    const hydratedMatches = matches.map((match) => ({
      id: match.id,
      matchType: match.matchType,
      savedAt: match.savedAt,
      details: match.matchType === 'UNIVERSITY' ? uniMap.get(match.matchId) ?? null : scholMap.get(match.matchId) ?? null,
    }));

    res.status(200).json({
      success: true,
      data: hydratedMatches,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    logger.error('getFavourites error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── POST /favourites ──────────────────────────────────────────────────────────
/**
 * Saves a university or scholarship to the user's favourites.
 * Validates matchType against an allow-list and verifies the target record exists.
 */
export const addFavourite = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized: Missing user credentials' });
      return;
    }

    const { matchType, matchId } = req.body as { matchType?: string; matchId?: string };

    // Validate allow-listed matchType
    if (!matchType || !['UNIVERSITY', 'SCHOLARSHIP'].includes(matchType)) {
      res.status(400).json({ success: false, error: 'matchType must be one of: UNIVERSITY, SCHOLARSHIP' });
      return;
    }

    if (!matchId || typeof matchId !== 'string') {
      res.status(400).json({ success: false, error: 'matchId is required and must be a string' });
      return;
    }

    // Verify the target record actually exists before saving
    if (matchType === 'UNIVERSITY') {
      const uni = await prisma.university.findUnique({ where: { id: matchId }, select: { id: true } });
      if (!uni) {
        res.status(404).json({ success: false, error: 'University not found' });
        return;
      }
    } else {
      const schol = await prisma.scholarship.findUnique({ where: { id: matchId }, select: { id: true } });
      if (!schol) {
        res.status(404).json({ success: false, error: 'Scholarship not found' });
        return;
      }
    }

    const saved = await prisma.savedMatch.create({
      data: { userId, matchType, matchId },
    });

    res.status(201).json({ success: true, message: 'Saved to favourites', data: { id: saved.id, matchType, matchId, savedAt: saved.savedAt } });
  } catch (error: any) {
    // Unique constraint means already saved
    if (error?.code === 'P2002') {
      res.status(409).json({ success: false, error: 'Already in favourites' });
      return;
    }
    logger.error('addFavourite error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── DELETE /favourites/:id ────────────────────────────────────────────────────
/**
 * Removes a saved match. Ownership is verified — users can only delete their own records.
 */
export const deleteFavourite = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized: Missing user credentials' });
      return;
    }

    const { id } = req.params;
    if (!id || typeof id !== 'string') {
      res.status(400).json({ success: false, error: 'Invalid favourite ID' });
      return;
    }

    // Ownership check: scope to userId so users can never delete another user's record
    const existing = await prisma.savedMatch.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Favourite not found or access denied' });
      return;
    }

    await prisma.savedMatch.delete({ where: { id } });

    res.status(200).json({ success: true, message: 'Removed from favourites' });
  } catch (error) {
    logger.error('deleteFavourite error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── GET /applications ─────────────────────────────────────────────────────────
/**
 * Returns the authenticated student's paginated application history
 * with university name and current status.
 */
export const getApplications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized: Missing user credentials' });
      return;
    }

    const { page, limit, skip } = getPagination(req.query as Record<string, unknown>);
    const statusFilter = req.query.status as string | undefined;

    // Validate status filter against the enum allow-list
    const validStatuses = ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'ACCEPTED', 'REJECTED', 'DEFERRED'];
    const whereClause = {
      userId,
      ...(statusFilter && validStatuses.includes(statusFilter) ? { status: statusFilter as any } : {}),
    };

    const [total, applications] = await prisma.$transaction([
      prisma.application.count({ where: whereClause }),
      prisma.application.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
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
              locationCity: true,
              locationCountry: true,
              featuredImage: true,
            },
          },
        },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: applications,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    logger.error('getApplications error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
