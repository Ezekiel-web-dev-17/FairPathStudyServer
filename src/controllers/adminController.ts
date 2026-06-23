// - getAnalytics:      GET    /admin/analytics        — KPI metrics (admin only)
// - createUniversity:  POST   /admin/universities      — Create university record
// - updateUniversity:  PUT    /admin/universities/:id  — Update university record
// - deleteUniversity:  DELETE /admin/universities/:id  — Delete university record
// - clearCache:        POST   /admin/cache/clear       — Bust Redis cache

import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { invalidateCacheByPattern } from '../config/redis.js';
import { prisma } from '../config/db.js';
import { ApplicationStatus, Prisma } from '@prisma/client';
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
export const getAnalytics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { skip, limit, status } = req.query as { skip: string, limit: string, status: ApplicationStatus };

    // 1. Run all scalar counts in parallel via a single transaction
    const [
      totalStudents,
      totalAdmins,
      verifiedUsers,
      totalUniversities,
      partnerUniversities,
      totalScholarships,
      totalApplications,
      totalActiveApplications,
      acceptedApplications,
      rejectedApplications,
      inReviewApplications,
      verifiedApplications,
      flaggedApplications,
    ] = await prisma.$transaction([
      prisma.user.count({ where: { role: 'STUDENT' } }),
      prisma.user.count({ where: { role: 'ADMIN' } }),
      prisma.user.count({ where: { isVerified: true } }),
      prisma.university.count(),
      prisma.university.count({ where: { isPartner: true } }),
      prisma.scholarship.count(),
      prisma.application.count({ where: { status: { in: ["IN_REVIEW", "SUBMITTED", "VERIFIED", "ACCEPTED", "REJECTED", "FLAGGED", "NEEDS_DOCUMENT"] } } }),
      prisma.application.count({ where: { status: { in: ["IN_REVIEW", "SUBMITTED", "VERIFIED", "NEEDS_DOCUMENT"] } } }),
      prisma.application.count({ where: { status: { in: ["ACCEPTED"] } } }),
      prisma.application.count({ where: { status: { in: ["REJECTED"] } } }),
      prisma.application.count({ where: { status: { in: ["IN_REVIEW"] } } }),
      prisma.application.count({ where: { status: { in: ["VERIFIED"] } } }),
      prisma.application.count({ where: { status: { in: ["FLAGGED"] } } }),
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
          totalStudents,
          totalAdmins,
          verified: verifiedUsers,
          unverified: totalStudents + totalAdmins - verifiedUsers,
        },
        universities: {
          total: totalUniversities,
          partners: partnerUniversities,
          nonPartners: totalUniversities - partnerUniversities,
        },
        scholarships: {
          total: totalScholarships,
        },
        applications: {
          ...(await getApplications(skip, limit, status)),
          total: totalApplications,
          byStatus: statusBreakdown,
          activeApplications: totalActiveApplications,
          accepted: acceptedApplications,
          rejected: rejectedApplications,
          inReview: inReviewApplications,
          verified: verifiedApplications,
          flagged: flaggedApplications,
          matchSuccessRate: totalApplications === 0
            ? 0
            : Math.round((acceptedApplications / totalApplications) * 100),
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

const getApplications = async (skip: string | undefined, limit: string | undefined, status: string | undefined) => {
  try {
    const where = {
      status: {
        in: status
          ? [status as ApplicationStatus]
          : [ApplicationStatus.SUBMITTED, ApplicationStatus.IN_REVIEW, ApplicationStatus.ACCEPTED, ApplicationStatus.REJECTED, ApplicationStatus.FLAGGED],
      },
    };

    // Run the paginated fetch and the total count in parallel with the same filter
    const [applications, total] = await Promise.all([
      prisma.application.findMany({
        select: {
          id: true,
          status: true,
          updatedAt: true,
          createdAt: true,
          universityId: true,
          userId: true,
          university: {
            select: {
              name: true,
            },
          },
          user: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
        take: Number(limit) || 5,
        skip: Number(skip) || 0,
        where,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.application.count({ where }),
    ]);

    // For each application, fetch the applicant's match score for that university
    const applicationsWithScores = await Promise.all(
      applications.map(async (app) => {
        const matchScore = await prisma.universityMatchScore.findUnique({
          where: { userId_universityId: { userId: app.userId, universityId: app.universityId } },
          select: { matchScore: true },
        });
        return { ...app, matchScore: matchScore ?? null };
      })
    );

    return { data: applicationsWithScores, total };
  } catch (error) {
    logger.error('getApplications error:', error);
    throw error;
  }
};

export const getKPISeries = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {timeframe} = req.query;
    if (!timeframe) {
      res.status(400).json({ success: false, error: 'Timeframe is required' });
      return;
    }

    let where;
    if (timeframe === 'today') {
      where = {
        createdAt: {
          gte: new Date(new Date().getTime() - 1 * 24 * 60 * 60 * 1000),
        },
      };
    }else if (timeframe === 'week') {
      where = {
        createdAt: {
          gte: new Date(new Date().getTime() - 7 * 24 * 60 * 60 * 1000),
        },
      };
    } else if (timeframe === 'month') {
      where = {
        createdAt: {
          gte: new Date(new Date().getTime() - 30 * 24 * 60 * 60 * 1000),
        },
      };
    } else if (timeframe === 'year') {
      where = {
        createdAt: {
          gte: new Date(new Date().getTime() - 365 * 24 * 60 * 60 * 1000),
        },
      };
    }else if (timeframe === 'custom') {
      const {startDate, endDate} = req.query;
      if (!startDate || !endDate) {
        res.status(400).json({ success: false, error: 'Start date and end date are required' });
        return;
      }
      where = {
        createdAt: {
          gte: new Date(startDate as string),
          lte: new Date(endDate as string),
        },
      };
    }

    const totalApplicants = await prisma.application.count({
      where: {
        ...where,
        status: { not: ApplicationStatus.DRAFT },
      },
    });
    
    const matchRate = await prisma.universityMatchScore.aggregate({
      _avg: {
        matchScore: true,
      },
    });

    const partneredUniversities = await prisma.university.count({
      where: { isPartner: true, ...where }
    });

    // TODO: add Match Rate and Average Time to Match based on the timeframe(Decision time)

    const gteDate = (where?.createdAt as any)?.gte as Date | undefined;
    const lteDate = (where?.createdAt as any)?.lte as Date | undefined;

    // Applications per destination country — JOIN required since locationCountry lives on University
    // $queryRaw used because Prisma groupBy cannot span relations
    type CountryRow = { locationCountry: string; count: bigint };
    const rawCountryCounts = await prisma.$queryRaw<CountryRow[]>(Prisma.sql`
      SELECT u."locationCountry", COUNT(*) AS count
      FROM "Application" a
      JOIN "University" u ON a."universityId" = u."id"
      WHERE 1=1
        ${gteDate ? Prisma.sql`AND a."createdAt" >= ${gteDate}` : Prisma.sql``}
        ${lteDate ? Prisma.sql`AND a."createdAt" <= ${lteDate}` : Prisma.sql``}
      GROUP BY u."locationCountry"
      ORDER BY count DESC
    `);

    const applicationsByCountry = rawCountryCounts.map((row) => ({
      locationCountry: row.locationCountry,
      count: Number(row.count),
    }));

    // Parallelise all remaining independent queries — single round-trip
    const [
      signedUpUsers,
      profiledUsers,
      draftSubmitted,
      finalMatches,
      institutionKPI,
      applicationStatusBreakdown,
    ] = await Promise.all([
      prisma.user.count({ where }),

      prisma.userOnboarding.count({
        where: { isCompleted: true, ...where },
      }),

      prisma.application.count({
        where: { status: ApplicationStatus.SUBMITTED, ...where },
      }),

      prisma.application.count({
        where: { status: ApplicationStatus.ACCEPTED, ...where },
      }),

      // Applications grouped by university + status — gives per-institution breakdown
      prisma.application.groupBy({
        by: ['universityId', 'status'],
        _count: { _all: true },
        where: { ...where },
      }),

      // Overall status distribution within the timeframe
      prisma.application.groupBy({
        by: ['status'],
        _count: { _all: true },
        where: { ...where },
      }),
    ]);

    // Monthly trend — uses $queryRaw + Prisma.sql (parameterized) to safely truncate dates by month
    // gteDate/lteDate are declared above alongside the country query
    const gteFilter = gteDate ? Prisma.sql`AND "createdAt" >= ${gteDate}` : Prisma.sql``;
    const lteFilter = lteDate ? Prisma.sql`AND "createdAt" <= ${lteDate}` : Prisma.sql``;

    type TrendRow = { month: string; submitted: bigint; accepted: bigint };
    const rawTrend = await prisma.$queryRaw<TrendRow[]>(Prisma.sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', "createdAt"), 'YYYY-MM') AS month,
        COUNT(*) FILTER (WHERE status = 'SUBMITTED') AS submitted,
        COUNT(*) FILTER (WHERE status = 'ACCEPTED')  AS accepted
      FROM "Application"
      WHERE 1=1 ${gteFilter} ${lteFilter}
      GROUP BY DATE_TRUNC('month', "createdAt")
      ORDER BY DATE_TRUNC('month', "createdAt") ASC
    `);

    // Convert BigInt (returned by $queryRaw) to regular numbers for JSON serialisation
    const applicationTrend = rawTrend.map((row) => ({
      month: row.month,
      submitted: Number(row.submitted),
      accepted: Number(row.accepted),
    }));

    const universityIds = [...new Set(institutionKPI.map((r) => r.universityId))];
    const universities = await prisma.university.findMany({
      where: { id: { in: universityIds } },
      select: { id: true, name: true, locationCountry: true },
    });
    const universityMap = new Map(universities.map((u) => [u.id, u]));

    // Compute per-university totals and accepted counts for admission rate
    const totalsPerUniversity = new Map<string, { total: number; accepted: number }>();
    for (const row of institutionKPI) {
      const entry = totalsPerUniversity.get(row.universityId) ?? { total: 0, accepted: 0 };
      entry.total += row._count._all;
      if (row.status === ApplicationStatus.ACCEPTED) {
        entry.accepted += row._count._all;
      }
      totalsPerUniversity.set(row.universityId, entry);
    }

    const institutionPerformance = institutionKPI.map((row) => {
      const { total, accepted } = totalsPerUniversity.get(row.universityId) ?? { total: 0, accepted: 0 };
      return {
        university: universityMap.get(row.universityId) ?? { id: row.universityId, name: 'Unknown', locationCountry: '' },
        status: row.status,
        count: row._count._all,
        admissionRate: total > 0 ? Math.round((accepted / total) * 100) : 0,
      };
    });

    res.status(200).json({
      success: true,
      data: {
        totalApplicants,
        averageMatchScore: matchRate._avg.matchScore ?? 0,
        partneredUniversities,
        applicationsByCountry,
        signedUpUsers,
        profiledUsers,
        draftSubmitted,
        finalMatches,
        applicationStatusBreakdown,
        institutionPerformance,
        applicationTrend,
      },
    });
  } catch (error) {
    logger.error('getKPISeries error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}