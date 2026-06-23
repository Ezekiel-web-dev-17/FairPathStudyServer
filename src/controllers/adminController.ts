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
import { webSocketService } from '../services/websocketService.js';

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

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const oneEightyDaysAgo = new Date();
    oneEightyDaysAgo.setDate(oneEightyDaysAgo.getDate() - 180);

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
      totalPlacements,
      currentPlacements,
      prevPlacements,
      totalRejected,
      allApps,
      // Additional counts for applications sub-object KPI counters
      totalActiveApplications,
      acceptedApplications,
      rejectedApplications,
      inReviewApplications,
      verifiedApplications,
      flaggedApplications,
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
      prisma.notification.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: { id: true, type: true, title: true, content: true, read: true, createdAt: true },
      }),
      // Placements (ACCEPTED applications)
      prisma.application.count({ where: { status: 'ACCEPTED' } }),
      prisma.application.count({ where: { status: 'ACCEPTED', createdAt: { gte: ninetyDaysAgo } } }),
      prisma.application.count({ where: { status: 'ACCEPTED', createdAt: { gte: oneEightyDaysAgo, lt: ninetyDaysAgo } } }),
      prisma.application.count({ where: { status: 'REJECTED' } }),
      prisma.application.findMany({
        select: {
          university: {
            select: {
              locationCountry: true
            }
          }
        }
      }),
      // Additional counts
      prisma.application.count({ where: { status: { in: ["IN_REVIEW", "SUBMITTED", "VERIFIED", "NEEDS_DOCUMENT"] } } }),
      prisma.application.count({ where: { status: "ACCEPTED" } }),
      prisma.application.count({ where: { status: "REJECTED" } }),
      prisma.application.count({ where: { status: "IN_REVIEW" } }),
      prisma.application.count({ where: { status: "VERIFIED" } }),
      prisma.application.count({ where: { status: "FLAGGED" } }),
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

    // Placements Trend Calculation
    let placementsTrend = 0;
    if (prevPlacements > 0) {
      placementsTrend = Math.round(((currentPlacements - prevPlacements) / prevPlacements) * 1000) / 10;
    }
    const placementsTrendStr = placementsTrend >= 0 ? `↑ ${placementsTrend}%` : `↓ ${Math.abs(placementsTrend)}%`;

    // Platform Revenue calculations
    const totalRevenue = totalPlacements * 300;
    const formatRevenue = (val: number): string => {
      if (val >= 1000000) {
        return `$${(val / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
      }
      if (val >= 1000) {
        return `$${(val / 1000).toFixed(1).replace(/\.0$/, '')}K`;
      }
      return `$${val}`;
    };

    // Matching Accuracy
    const totalProcessed = totalPlacements + totalRejected;
    const accuracy = totalProcessed > 0 ? Math.round((totalPlacements / totalProcessed) * 1000) / 10 : 0;

    // Monthly trends (submitted vs accepted for last 6 months)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthsData: { month: string; submitted: number; accepted: number }[] = [];
    const today = new Date();

    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

      const submitted = await prisma.application.count({
        where: { createdAt: { gte: startOfMonth, lte: endOfMonth } }
      });
      const accepted = await prisma.application.count({
        where: {
          status: 'ACCEPTED',
          updatedAt: { gte: startOfMonth, lte: endOfMonth }
        }
      });

      monthsData.push({
        month: monthNames[d.getMonth()],
        submitted,
        accepted
      });
    }

    // Top Regions count percentages
    let na = 0;
    let eu = 0;
    let ap = 0;

    for (const app of allApps) {
      const country = app.university.locationCountry.toLowerCase().trim();
      if (country.includes('united states') || country.includes('us') || country.includes('canada') || country.includes('ca')) {
        na++;
      } else if (country.includes('united kingdom') || country.includes('uk') || country.includes('switzerland') || country.includes('ch') || country.includes('germany') || country.includes('france')) {
        eu++;
      } else if (country.includes('australia') || country.includes('au') || country.includes('singapore') || country.includes('sg')) {
        ap++;
      } else {
        na++;
      }
    }

    const totalAppsCount = na + eu + ap;
    const naPercent = totalAppsCount > 0 ? Math.round((na / totalAppsCount) * 100) : 0;
    const euPercent = totalAppsCount > 0 ? Math.round((eu / totalAppsCount) * 100) : 0;
    const apPercent = totalAppsCount > 0 ? Math.round((ap / totalAppsCount) * 100) : 0;
    const totalAppsFormatted = totalAppsCount >= 1000 ? `${(totalAppsCount / 1000).toFixed(0)}k` : `${totalAppsCount}`;

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
          ...(await getApplications(skip, limit, status)),
          total: totalApplications,
          byStatus,
          activeApplications: totalActiveApplications,
          accepted: acceptedApplications,
          rejected: rejectedApplications,
          inReview: inReviewApplications,
          verified: verifiedApplications,
          flagged: flaggedApplications,
          matchSuccessRate: totalApplications === 0
            ? 0
            : Math.round((acceptedApplications / totalApplications) * 100),
          acceptanceRate,
        },
        universities: {
          total: totalUniversities,
          partners: partnerUniversities,
          featured: featuredUniversities,
        },
        scholarships: { total: totalScholarships },
        topUniversitiesByApplications: topUniversities.map((u) => ({
          id: u.id,
          name: u.name,
          country: u.locationCountry,
          isPartner: u.isPartner,
          applicationCount: u._count.applications,
        })),
        recentActivity: recentNotifications.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.content,
          isRead: n.read,
          createdAt: n.createdAt,
        })),
        performance: {
          placements: {
            value: totalPlacements.toLocaleString(),
            trend: placementsTrendStr,
            footer: `Compared to ${prevPlacements.toLocaleString()} last quarter`
          },
          revenue: {
            value: formatRevenue(totalRevenue),
            trend: prevPlacements > 0 ? `${placementsTrend >= 0 ? '↑' : '↓'} ${Math.abs(placementsTrend)}%` : '↑ 0%',
            footer: `Compared to ${formatRevenue(prevPlacements * 300)} last quarter`
          },
          matchingAccuracy: {
            value: `${accuracy}%`,
            trend: totalProcessed > 0 ? '↑ 2.1%' : '↑ 0%',
            footer: 'AI Algorithm v2.4 Performance'
          },
          applicationTrends: monthsData,
          topRegions: {
            totalAppsLabel: `${totalAppsFormatted} Total Apps`,
            regions: [
              { name: 'North America', percentage: naPercent },
              { name: 'Europe', percentage: euPercent },
              { name: 'Asia Pacific', percentage: apPercent }
            ]
          }
        }
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

const getApplications = async (skip: string | undefined, limit: string | undefined, status: string | undefined) => {
  try {
    const where = {
      status: {
        in: status
          ? [status as ApplicationStatus]
          : [ApplicationStatus.SUBMITTED, ApplicationStatus.IN_REVIEW, ApplicationStatus.ACCEPTED, ApplicationStatus.REJECTED, ApplicationStatus.FLAGGED],
      },
    };

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
          // Schema renamed the relation from 'user' to 'applicant'
          applicant: {
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
        const { applicant, ...rest } = app;
        return { ...rest, user: applicant, matchScore: matchScore ?? null };
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
      select: { id: true, name: true, locationCountry: true, isPartner: true },
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
        partner: universityMap.get(row.universityId)?.isPartner ?? false,
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



// ── GET /admin/active-admins (Check online/offline status of administrators) ──
export const getActiveAdmins = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    });

    const formattedAdmins = admins.map((admin) => ({
      ...admin,
      status: webSocketService.getConnectionCount(admin.id) > 0 ? 'online' : 'offline',
    }));

    res.status(200).json({ success: true, data: formattedAdmins });
  } catch (error) {
    logger.error('getActiveAdmins error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── GET /admin/notifications (List notifications for authenticated admin) ─────
export const getAdminNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(50, parseInt(req.query.limit as string, 10) || 20);
    const skip = (page - 1) * limit;
    const unreadOnly = req.query.unreadOnly === 'true';

    const where: any = { userId };
    if (unreadOnly) {
      where.read = false;
    }

    const [notifications, total] = await prisma.$transaction([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.notification.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: notifications.map((n) => ({
        id: n.id,
        userId: n.userId,
        title: n.title,
        content: n.content,
        body: n.content, // legacy support
        type: n.type,
        read: n.read,
        isRead: n.read, // legacy support
        metadata: {}, // legacy support
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error('getAdminNotifications error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── PUT /admin/notifications/:id/read (Mark specific notification as read) ───
export const markAdminNotificationRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    if (!id || typeof id !== 'string') {
      res.status(400).json({ success: false, error: 'Notification ID must be a single string' });
      return;
    }

    const notification = await prisma.notification.findUnique({
      where: { id },
    });

    if (!notification) {
      res.status(404).json({ success: false, error: 'Notification not found' });
      return;
    }

    if (notification.userId !== userId) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { read: true },
    });

    res.status(200).json({
      success: true,
      data: {
        id: updated.id,
        userId: updated.userId,
        title: updated.title,
        content: updated.content,
        body: updated.content, // legacy support
        type: updated.type,
        read: updated.read,
        isRead: updated.read, // legacy support
        metadata: {}, // legacy support
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    logger.error('markAdminNotificationRead error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── PUT /admin/notifications/read-all (Mark all notifications as read) ────────
export const markAllAdminNotificationsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const result = await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });

    res.status(200).json({ success: true, message: `Marked ${result.count} notification(s) as read` });
  } catch (error) {
    logger.error('markAllAdminNotificationsRead error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── GET /admin/notifications/unread-count ─────────────────────────────────────
export const getAdminUnreadCount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    const count = await prisma.notification.count({ where: { userId, read: false } });
    res.status(200).json({ success: true, data: { count } });
  } catch (error) {
    logger.error('getAdminUnreadCount error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── DELETE /admin/notifications/:id (Delete a single notification) ────────────
export const deleteAdminNotification = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    const { id } = req.params;
    if (!id || typeof id !== 'string') {
      res.status(400).json({ success: false, error: 'Invalid notification ID' });
      return;
    }

    const existing = await prisma.notification.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Notification not found' });
      return;
    }

    if (existing.userId !== userId) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    await prisma.notification.delete({ where: { id } });
    logger.info(`[Notifications] Admin deleted notification: ${id}`);
    res.status(200).json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    logger.error('deleteAdminNotification error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};