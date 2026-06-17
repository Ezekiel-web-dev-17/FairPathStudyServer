// - getUniversities:            GET /universities          — Paginated + filtered list
// - getFeaturedUniversitiesSlug: GET /universities/featured  — Filterable partner universities
// - getFeaturedUniversities:    GET /universities/partners  — Featured partner images only

import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
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

export const getUniversityBySlug = async (req: Request, res: Response): Promise<void> => {
  try {
    const { slug } = req.params;

    if (typeof slug !== 'string') {
      res.status(400).json({ success: false, error: 'Invalid slug' });
      return;
    }

    const university = await prisma.university.findUnique({
      where: { slug }
    });

    if (!university) {
      res.status(404).json({ success: false, error: 'University not found' });
      return;
    }

    res.status(200).json({ success: true, data: university });
  } catch (error) {
    logger.error('getUniversityBySlug error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * Normalizes and checks English proficiency scores across different testing platforms.
 * Maps scales to a standard IELTS 6.5 default benchmark.
 */
function isEnglishRequirementMet(
  testType: string | null | undefined,
  scoreStr: string | null | undefined,
  requiredIelts: number = 6.5
): boolean {
  if (!scoreStr) return false;
  const score = parseFloat(scoreStr);
  if (isNaN(score)) return false;

  const type = (testType || 'IELTS').toUpperCase();

  // 1. TOEFL (Scale: 0 - 120)
  if (type.includes('TOEFL')) {
    const toeflRequired = requiredIelts === 6.5 ? 80 : requiredIelts === 7.0 ? 90 : requiredIelts === 7.5 ? 100 : 80;
    return score >= toeflRequired;
  }

  // 2. Duolingo English Test / DET (Scale: 10 - 160)
  if (type.includes('DUOLINGO') || type.includes('DET')) {
    const detRequired = requiredIelts === 6.5 ? 110 : requiredIelts === 7.0 ? 120 : requiredIelts === 7.5 ? 130 : 110;
    return score >= detRequired;
  }

  // 3. PTE Academic (Scale: 10 - 90)
  if (type.includes('PTE')) {
    const pteRequired = requiredIelts === 6.5 ? 58 : requiredIelts === 7.0 ? 65 : requiredIelts === 7.5 ? 73 : 58;
    return score >= pteRequired;
  }

  // 4. Default / IELTS (Scale: 0 - 9)
  return score >= requiredIelts;
}

export const getUserMatches = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized: Missing user credentials' });
      return;
    }

    // 1. Fetch user profile and onboarding settings
    const onboarding = await prisma.userOnboarding.findUnique({ where: { userId } });
    if (!onboarding) {
      res.status(400).json({ success: false, error: 'Please complete onboarding first.' });
      return;
    }

    // 2. Fetch all partner universities
    const universities = await prisma.university.findMany({
      where: { isPartner: true },
    });

    // 3. Score calculation logic
    const matchedList = universities.map((uni) => {
      let score = 0;
      const reasons: string[] = [];
      const warnings: string[] = [];

      // A. Budget Match (Weight: 30%)
      if (onboarding.annualBudget) {
        const userBudget = Number(onboarding.annualBudget);
        if (userBudget >= uni.tuitionMax) {
          score += 30;
          reasons.push('Budget Aligned');
        } else if (userBudget >= uni.tuitionMin) {
          score += 15;
          reasons.push('Partially Budget Aligned');
        } else {
          warnings.push('Exceeds Budget');
        }
      }

      // B. Major Match (Weight: 30%)
      if (onboarding.intendedMajor) {
        const hasMajor = uni.departments.some((dept) =>
          dept.toLowerCase().includes(onboarding.intendedMajor!.toLowerCase())
        );
        if (hasMajor) {
          score += 30;
          reasons.push('Offering Intended Major');
        }
      }

      // C. Destination Country Match (Weight: 20%)
      if (onboarding.destinations && onboarding.destinations.length > 0) {
        const destMatch = onboarding.destinations.some(
          (dest) => dest.toLowerCase() === uni.locationCountry.toLowerCase()
        );
        if (destMatch) {
          score += 20;
          reasons.push('Located in Preferred Destination');
        }
      }

      // D. English proficiency (Weight: 20%)
      if (onboarding.englishScore) {
        const isMet = isEnglishRequirementMet(onboarding.englishTest, onboarding.englishScore, 6.5);
        if (isMet) {
          score += 20;
          reasons.push('English Requirements Met');
        } else {
          warnings.push('Higher Language Scores Recommended');
        }
      }

      return {
        university: uni,
        matchScore: score === 0 ? 50 : score, // Default baseline
        reasons,
        warnings,
      };
    });

    // Sort matching results descending
    matchedList.sort((a, b) => b.matchScore - a.matchScore);
    res.status(200).json({ success: true, data: matchedList });
  } catch (error) {
    logger.error('getUserMatches error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
