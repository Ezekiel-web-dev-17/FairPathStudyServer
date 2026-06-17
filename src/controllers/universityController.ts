// - getUniversities:            GET /universities          — Paginated + filtered list
// - getFeaturedUniversitiesSlug: GET /universities/featured  — Filterable partner universities
// - getFeaturedUniversities:    GET /universities/partners  — Featured partner images only

import { Request, Response } from 'express';
import { prisma } from '../config/db.js';
import { Prisma } from '@prisma/client';
import logger from '../utils/logger.js';

// ── Shared query-param types ──────────────────────────────────────────────────
interface UniversityQueryParams {
  name?: string;
  country?: string;
  city?: string;
  campusSetting?: 'urban' | 'suburban' | 'rural';
  /** Budget tier: under $20k | $20k–$40k | over $40k */
  tuition?: 'min' | 'mid' | 'max';
  ranking?: string;
}

/**
 * Builds a shared Prisma `where` filter from common query parameters.
 * Called by both the public list and the featured/partner list endpoints.
 */
function buildUniversityFilter(
  params: UniversityQueryParams,
  base: Prisma.UniversityWhereInput = {}
): Prisma.UniversityWhereInput {
  const filter: Prisma.UniversityWhereInput = { ...base };

  if (params.name) {
    filter.name = { contains: params.name, mode: 'insensitive' };
  }

  if (params.country) {
    filter.locationCountry = { equals: params.country, mode: 'insensitive' };
  }

  if (params.city) {
    filter.locationCity = { equals: params.city, mode: 'insensitive' };
  }

  if (params.campusSetting) {
    // DB stores UPPER-CASE enum values
    filter.setting = { equals: params.campusSetting.toUpperCase(), mode: 'insensitive' };
  }

  if (params.tuition) {
    // min  → tuitionMax ≤ $20k
    // mid  → $20k ≤ tuitionMax and tuitionMin ≤ $40k
    // max  → tuitionMin ≥ $40k
    if (params.tuition === 'min') {
      filter.tuitionMax = { lte: 20000 };
    } else if (params.tuition === 'mid') {
      filter.tuitionMin = { lte: 40000 };
      filter.tuitionMax = { gte: 20000 };
    } else if (params.tuition === 'max') {
      filter.tuitionMin = { gte: 40000 };
    }
  }

  if (params.ranking) {
    const parsedRank = parseInt(params.ranking, 10);
    if (!isNaN(parsedRank) && parsedRank > 0) {
      filter.rankingGlobal = { lte: parsedRank };
    }
  }

  return filter;
}

// ── GET /universities ─────────────────────────────────────────────────────────
export const getUniversities = async (req: Request, res: Response): Promise<void> => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  as string, 10) || 1);
    const limit = Math.min(50, parseInt(req.query.limit as string, 10) || 10);
    const skip  = (page - 1) * limit;

    const filter = buildUniversityFilter(
      req.query as UniversityQueryParams,
      { isPartner: false }
    );

    // Run count + fetch in parallel — single round-trip to the DB pool
    const [total, universities] = await prisma.$transaction([
      prisma.university.count({ where: filter }),
      prisma.university.findMany({
        skip,
        take: limit,
        where: filter,
        orderBy: { rankingGlobal: 'asc' },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: universities,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error('getUniversities error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── GET /universities/featured ────────────────────────────────────────────────
export const getFeaturedUniversitiesSlug = async (req: Request, res: Response): Promise<void> => {
  try {
    const filter = buildUniversityFilter(
      req.query as UniversityQueryParams,
      { isPartner: true }
    );

    const universities = await prisma.university.findMany({
      where: filter,
      orderBy: { rankingGlobal: 'asc' },
    });

    res.status(200).json({ success: true, data: universities });
  } catch (error) {
    logger.error('getFeaturedUniversitiesSlug error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── GET /universities/partners ────────────────────────────────────────────────
export const getFeaturedUniversities = async (_req: Request, res: Response): Promise<void> => {
  try {
    // Returns only the minimal fields needed for logo/banner carousels on the frontend
    const featured = await prisma.university.findMany({
      where: { isFeatured: true, isPartner: true },
      select: { id: true, featuredImage: true },
    });

    res.status(200).json({ success: true, data: featured });
  } catch (error) {
    logger.error('getFeaturedUniversities error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
