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
import { createAdminNotification } from '../services/notificationService.js';

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
 * Returns a comprehensive KPI snapshot for the admin dashboard in a single DB round-trip.
 * Matches the data structure expected by the Operations Overview and Analytics pages.
 */
export const getAnalytics = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Run all counts in parallel — groupBy requires a separate call (not inside $transaction)
    const [
      totalUsers,
      verifiedUsers,
      onboardedUsers,
      newUsersLast30Days,
      totalApplications,
      applicationsByStatus,
      totalUniversities,
      partnerUniversities,
      featuredUniversities,
      totalScholarships,
      topUniversities,
      recentNotifications,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isVerified: true } }),
      prisma.userOnboarding.count({ where: { isCompleted: true } }),
      prisma.user.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      prisma.application.count(),
      prisma.application.groupBy({
        by: ['status'],
        _count: { _all: true },
        orderBy: { status: 'asc' },
      }),
      prisma.university.count(),
      prisma.university.count({ where: { isPartner: true } }),
      prisma.university.count({ where: { isFeatured: true } }),
      prisma.scholarship.count(),
      prisma.university.findMany({
        take: 5,
        orderBy: { applications: { _count: 'desc' } },
        select: {
          id: true,
          name: true,
          locationCountry: true,
          isPartner: true,
          _count: { select: { applications: true } },
        },
      }),
      (prisma as any).notification.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: { id: true, type: true, title: true, body: true, isRead: true, createdAt: true },
      }),
    ]);

    // Reshape applicationsByStatus into a flat object
    const byStatus: Record<string, number> = {
      DRAFT: 0, SUBMITTED: 0, IN_REVIEW: 0, ACCEPTED: 0, REJECTED: 0, DEFERRED: 0,
    };
    for (const row of applicationsByStatus) {
      byStatus[row.status] = row._count._all;
    }

    // Acceptance rate: ACCEPTED / total with final decisions
    const decided = (byStatus.ACCEPTED ?? 0) + (byStatus.REJECTED ?? 0);
    const acceptanceRate = decided > 0 ? Math.round(((byStatus.ACCEPTED ?? 0) / decided) * 1000) / 10 : null;

    res.status(200).json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          verified: verifiedUsers,
          onboardingCompleted: onboardedUsers,
          newLast30Days: newUsersLast30Days,
        },
        applications: {
          total: totalApplications,
          byStatus,
          acceptanceRate,
        },
        universities: {
          total: totalUniversities,
          partners: partnerUniversities,
          featured: featuredUniversities,
        },
        scholarships: { total: totalScholarships },
        topUniversitiesByApplications: topUniversities.map((u: { id: string; name: string; locationCountry: string; isPartner: boolean; _count: { applications: number } }) => ({
          id: u.id,
          name: u.name,
          country: u.locationCountry,
          isPartner: u.isPartner,
          applicationCount: u._count.applications,
        })),
        recentActivity: recentNotifications,
      },
    });
  } catch (error) {
    logger.error('getAnalytics error: %o', error);
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

    // Notify admins of the new university (fire-and-forget)
    await createAdminNotification({
      type: 'UNIVERSITY_CREATED',
      title: 'University Added',
      body: `"${university.name}" (${university.locationCity}, ${university.locationCountry}) was added to the platform.`,
      metadata: { universityId: university.id },
    });

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

    // Notify admins (fire-and-forget)
    await createAdminNotification({
      type: 'UNIVERSITY_UPDATED',
      title: 'University Updated',
      body: `"${updated.name}" record was updated.`,
      metadata: { universityId: id },
    });

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

    const deleted = await prisma.university.findUnique({ where: { id }, select: { name: true } });
    await prisma.university.delete({ where: { id } });
    logger.info(`University deleted: ${id}`);

    // Notify admins (fire-and-forget)
    await createAdminNotification({
      type: 'UNIVERSITY_DELETED',
      title: 'University Removed',
      body: `"${deleted?.name ?? 'A university'}" was removed from the platform.`,
      metadata: { universityId: id },
    });

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

    // Notify admins (fire-and-forget)
    await createAdminNotification({
      type: 'CACHE_CLEARED',
      title: 'Cache Cleared',
      body: 'The platform Redis cache was fully invalidated by an admin.',
      metadata: {},
    });

    res.status(200).json({ success: true, message: 'Cache cleared successfully' });
  } catch (error) {
    logger.error('clearCache error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

function getShortCountry(country: string): string {
  const norm = country.toLowerCase().trim();
  if (norm === 'united kingdom' || norm === 'uk' || norm === 'great britain') return 'UK';
  if (norm === 'united states' || norm === 'us' || norm === 'united states of america') return 'US';
  if (norm === 'canada' || norm === 'ca') return 'CA';
  if (norm === 'australia' || norm === 'au') return 'AU';
  if (norm === 'switzerland' || norm === 'ch') return 'CH';
  if (norm === 'singapore' || norm === 'sg') return 'SG';
  return country;
}

// ── GET /admin/universities ───────────────────────────────────────────────────
export const getAdminUniversities = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const search = req.query.search as string | undefined;
    const statusFilter = req.query.status as string | undefined; // 'all', 'active', 'pending'

    // Base search where clause
    const baseWhere: any = {};
    if (search && typeof search === 'string' && search.trim() !== '') {
      baseWhere.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { locationCity: { contains: search, mode: 'insensitive' } },
        { locationCountry: { contains: search, mode: 'insensitive' } },
      ];
    }

    const where: any = { ...baseWhere };
    if (statusFilter === 'active') {
      where.isPartner = true;
    } else if (statusFilter === 'pending') {
      where.isPartner = false;
    }

    // Dynamic tab counts (matching active search)
    const [countAll, countActive, countPending] = await Promise.all([
      prisma.university.count({ where: baseWhere }),
      prisma.university.count({ where: { ...baseWhere, isPartner: true } }),
      prisma.university.count({ where: { ...baseWhere, isPartner: false } }),
    ]);

    const partnerList = await prisma.university.findMany({
      where,
      include: {
        applications: {
          select: {
            status: true
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    const formattedData = partnerList.map((uni) => {
      const details = (uni.details as Record<string, any>) || {};

      // Status mapping
      const status = details.partnershipStatus || (uni.isPartner ? "Active Partnership" : "Contract Pending");

      // Location formatting (e.g. Edinburgh, UK)
      const countryAbbrev = getShortCountry(uni.locationCountry);
      const location = `${uni.locationCity}, ${countryAbbrev}`;

      // Global Rank
      const rank = uni.rankingGlobal ? `#${uni.rankingGlobal}` : "--";

      // Application Volume and Match Rate Calculations
      const volume = uni.applications.length;
      const accepted = uni.applications.filter((app) => app.status === 'ACCEPTED').length;

      const hasApps = volume > 0;
      const applicationVolume = hasApps ? volume.toLocaleString() : "--";
      const matchRate = hasApps ? `${Math.round((accepted / volume) * 100)}%` : "--";

      // Footer actions and pending signs
      const substatus = details.partnershipSubstatus || (status === "Contract Pending" ? "Awaiting Signatures" : null);
      const actionLabel = status === "Contract Pending" ? "Review" : "View Details";

      return {
        id: uni.id,
        name: uni.name,
        location,
        rank,
        status,
        applicationVolume,
        applicationsCount: volume,
        matchRate,
        substatus,
        actionLabel,
        isPartner: uni.isPartner
      };
    });

    res.status(200).json({
      success: true,
      data: formattedData,
      counts: {
        all: countAll,
        active: countActive,
        pending: countPending
      }
    });
  } catch (error) {
    logger.error('getAdminUniversities error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};