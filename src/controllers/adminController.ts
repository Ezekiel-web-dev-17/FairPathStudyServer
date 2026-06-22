// - getAnalytics:      GET    /admin/analytics        — KPI metrics (admin only)
// - createUniversity:  POST   /admin/universities      — Create university record
// - updateUniversity:  PUT    /admin/universities/:id  — Update university record
// - deleteUniversity:  DELETE /admin/universities/:id  — Delete university record
// - clearCache:        POST   /admin/cache/clear       — Bust Redis cache

import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { invalidateCacheByPattern } from '../config/redis.js';
import { prisma } from '../config/db.js';
import logger from '../utils/logger.js';

// ── Whitelist of fields an admin is allowed to set on a university ─────────────
const UNIVERSITY_WRITABLE_FIELDS = new Set([
  'name', 'slug', 'locationCity', 'locationCountry',
  'rankingGlobal', 'rankingNational', 'tuitionMin', 'tuitionMax',
  'setting', 'type', 'acceptanceRate', 'studentBodySize',
  'description', 'featuredImage', 'departments',
  'isFeatured', 'isPartner', 'details',
]);

/** Strips any keys not in the whitelist so callers can never touch internal fields. */
function sanitizeUniversityBody(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(body).filter(([key]) => UNIVERSITY_WRITABLE_FIELDS.has(key))
  );
}

// ── GET /admin/analytics ──────────────────────────────────────────────────────
/**
 * Returns aggregated KPI metrics for the admin dashboard.
 * Scalar counts are fetched in a single DB transaction; groupBy is run separately
 * due to Prisma's type-narrowing limitations inside $transaction arrays.
 */
export const getAnalytics = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    // 1. Run all scalar counts in parallel via a single transaction
    const [
      totalUsers,
      verifiedUsers,
      totalUniversities,
      partnerUniversities,
      totalScholarships,
      totalSavedMatches,
      totalApplications,
    ] = await prisma.$transaction([
      prisma.user.count(),
      prisma.user.count({ where: { isVerified: true } }),
      prisma.university.count(),
      prisma.university.count({ where: { isPartner: true } }),
      prisma.scholarship.count(),
      prisma.savedMatch.count(),
      prisma.application.count(),
    ]);

    // 2. Fetch application status breakdown separately (Prisma groupBy type is not composable in $transaction tuples)
    const applicationsByStatus = await prisma.application.groupBy({
      by: ['status'],
      _count: { _all: true },
      orderBy: { status: 'asc' },
    });

    // Map status groups into a readable object { DRAFT: 2, SUBMITTED: 1, ... }
    const statusBreakdown = Object.fromEntries(
      applicationsByStatus.map((g) => [g.status, g._count._all])
    );

    logger.info('Admin analytics fetched');
    res.status(200).json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          verified: verifiedUsers,
          unverified: totalUsers - verifiedUsers,
        },
        universities: {
          total: totalUniversities,
          partners: partnerUniversities,
          nonPartners: totalUniversities - partnerUniversities,
        },
        scholarships: {
          total: totalScholarships,
        },
        savedMatches: {
          total: totalSavedMatches,
        },
        applications: {
          total: totalApplications,
          byStatus: statusBreakdown,
        },
      },
    });
  } catch (error) {
    logger.error('getAnalytics error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── POST /universities ────────────────────────────────────────────────────────
export const createUniversity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, slug, locationCity, locationCountry } = req.body;

    // Validate required fields
    if (!name || !slug || !locationCity || !locationCountry) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: name, slug, locationCity, locationCountry',
      });
      return;
    }

    // Prevent duplicates
    const existing = await prisma.university.findFirst({
      where: { name, locationCity, locationCountry },
    });
    if (existing) {
      res.status(400).json({ success: false, error: 'University already exists' });
      return;
    }

    const data = sanitizeUniversityBody(req.body);
    const university = await prisma.university.create({ data: data as any });

    logger.info(`University created: ${university.id} — ${university.name}`);
    res.status(201).json({ success: true, message: 'University created successfully', data: university });
  } catch (error) {
    logger.error('createUniversity error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── PUT /universities/:id ─────────────────────────────────────────────────────
export const updateUniversity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== 'string') {
      res.status(400).json({ success: false, error: 'Invalid university ID' });
      return;
    }

    const existing = await prisma.university.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'University not found' });
      return;
    }

    // Support nested 'data' wrapper if provided (e.g. from tests)
    const rawData = (req.body && typeof req.body === 'object' && 'data' in req.body && req.body.data && typeof req.body.data === 'object' && !Array.isArray(req.body.data))
      ? req.body.data
      : req.body;

    // Only allow whitelisted fields — callers cannot touch internal DB columns
    const data = sanitizeUniversityBody(rawData);
    if (Object.keys(data).length === 0) {
      res.status(400).json({ success: false, error: 'No valid fields provided to update' });
      return;
    }

    const updated = await prisma.university.update({ where: { id }, data: data as any });
    logger.info(`University updated: ${id}`);
    res.status(200).json({ success: true, message: 'University updated successfully', data: updated });
  } catch (error) {
    logger.error('updateUniversity error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── DELETE /universities/:id ──────────────────────────────────────────────────
export const deleteUniversity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== 'string') {
      res.status(400).json({ success: false, error: 'Invalid university ID' });
      return;
    }

    const existing = await prisma.university.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'University not found' });
      return;
    }

    await prisma.university.delete({ where: { id } });
    logger.info(`University deleted: ${id}`);
    res.status(200).json({ success: true, message: 'University deleted successfully' });
  } catch (error) {
    logger.error('deleteUniversity error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── POST /admin/cache/clear ───────────────────────────────────────────────────
export const clearCache = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    await invalidateCacheByPattern('cache:*');
    logger.info('Cache cleared by admin');
    res.status(200).json({ success: true, message: 'Cache cleared successfully' });
  } catch (error) {
    logger.error('clearCache error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── GET /admin/universities ───────────────────────────────────────────────────
export const getAdminUniversities = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const partnerList = await prisma.university.findMany({
      select: {
        id: true,
        name: true,
        locationCity: true,
        locationCountry: true,
        rankingGlobal: true,
        isPartner: true,
        _count: {
          select: { applications: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    const formattedData = partnerList.map(uni => ({
      id: uni.id,
      name: uni.name,
      location: `${uni.locationCity}, ${uni.locationCountry}`,
      rank: uni.rankingGlobal ?? "--",
      applicationsCount: uni._count.applications,
      status: uni.isPartner ? "Active Partnership" : "Inactive"
    }));

    res.status(200).json({ success: true, data: formattedData });
  } catch (error) {
    logger.error('getAdminUniversities error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};