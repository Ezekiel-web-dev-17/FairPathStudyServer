import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../config/db.js';
import { Prisma } from '@prisma/client';
import logger from '../utils/logger.js';

interface ScholarshipQueryParams {
  page?: string;
  limit?: string;
  title?: string;
  provider?: string;
  category?: string;
  amountType?: string;
  minAmount?: string;
  maxAmount?: string;
}

/**
 * Builds a Prisma `where` filter from common query parameters.
 */
function buildScholarshipFilter(params: ScholarshipQueryParams): Prisma.ScholarshipWhereInput {
  const filter: Prisma.ScholarshipWhereInput = {};

  if (params.title) {
    filter.title = { contains: params.title, mode: 'insensitive' };
  }

  if (params.provider) {
    filter.provider = { contains: params.provider, mode: 'insensitive' };
  }

  if (params.category) {
    filter.category = { equals: params.category, mode: 'insensitive' };
  }

  if (params.amountType) {
    filter.amountType = { equals: params.amountType, mode: 'insensitive' };
  }

  if (params.minAmount || params.maxAmount) {
    const amountFilter: Prisma.FloatNullableFilter = {};
    
    if (params.minAmount) {
      const minVal = parseFloat(params.minAmount);
      if (!isNaN(minVal)) {
        amountFilter.gte = minVal;
      }
    }

    if (params.maxAmount) {
      const maxVal = parseFloat(params.maxAmount);
      if (!isNaN(maxVal)) {
        amountFilter.lte = maxVal;
      }
    }

    filter.amountValue = amountFilter;
  }

  return filter;
}

/**
 * Regex helper to extract a minimum GPA requirement from eligibility criteria text.
 * e.g., "Minimum GPA of 3.7", "GPA >= 3.5", "GPA 3.0"
 */
function extractMinGpa(criteria: string): number | null {
  const gpaRegex = /gpa\s*(?:of|>=|>=|minimum|minimum of)?\s*([0-9.]+)/i;
  const match = criteria.match(gpaRegex);
  if (match && match[1]) {
    const parsed = parseFloat(match[1]);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 4.0) {
      return parsed;
    }
  }
  return null;
}

/**
 * GET /api/v1/scholarships
 * Returns a paginated, filterable list of scholarships.
 */
export const getScholarships = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 10));
    const skip = (page - 1) * limit;

    const filter = buildScholarshipFilter(req.query as ScholarshipQueryParams);

    // Run parallel count + fetch
    const [total, scholarships] = await prisma.$transaction([
      prisma.scholarship.count({ where: filter }),
      prisma.scholarship.findMany({
        skip,
        take: limit,
        where: filter,
        orderBy: { deadline: 'asc' },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: scholarships,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error('getScholarships error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * GET /api/v1/scholarships/recommended
 * Renders personalized scholarship recommendations for the authenticated user based on onboarding profile.
 */
export const getRecommendedScholarships = async (req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized: Missing user credentials' });
      return;
    }

    // 1. Fetch user onboarding data
    const onboarding = await prisma.userOnboarding.findUnique({ where: { userId } });
    if (!onboarding) {
      res.status(400).json({ success: false, error: 'Please complete onboarding first.' });
      return;
    }

    // 2. Fetch all scholarships
    const scholarships = await prisma.scholarship.findMany();

    // 3. Fetch all universities to map provider locations
    const universities = await prisma.university.findMany({
      select: {
        name: true,
        locationCountry: true,
      },
    });

    // 4. Calculate recommendation matching score
    const recommended = scholarships.map((schol) => {
      let score = 0;
      const reasons: string[] = [];
      const warnings: string[] = [];

      // A. GPA Match (Weight: 30%)
      const minGpa = extractMinGpa(schol.eligibilityCriteria);
      if (onboarding.gpa) {
        const userGpa = parseFloat(onboarding.gpa);
        if (!isNaN(userGpa)) {
          if (minGpa !== null) {
            if (userGpa >= minGpa) {
              score += 30;
              reasons.push(`Academic Requirements Met (Your GPA: ${userGpa} meets required ${minGpa})`);
            } else {
              warnings.push(`Higher GPA recommended to meet eligibility (Required: ${minGpa})`);
            }
          } else {
            score += 30;
            reasons.push('Academic Requirements Met (No specific GPA required)');
          }
        } else {
          score += 15; // fallback baseline
        }
      } else {
        if (minGpa !== null) {
          warnings.push(`GPA required to verify eligibility (Required: ${minGpa})`);
        } else {
          score += 30;
        }
      }

      // B. Intended Major Match (Weight: 30%)
      if (onboarding.intendedMajor) {
        const majorLower = onboarding.intendedMajor.toLowerCase();
        const criteriaLower = schol.eligibilityCriteria.toLowerCase();
        const titleLower = schol.title.toLowerCase();
        const categoryLower = schol.category.toLowerCase();

        const isStemMajor = ['science', 'engineering', 'technology', 'mathematics', 'computer', 'software', 'data science', 'computing', 'stem'].some(keyword => majorLower.includes(keyword));
        const isStemScholarship = schol.category.toUpperCase() === 'STEM' || schol.title.toUpperCase().includes('STEM') || schol.eligibilityCriteria.toUpperCase().includes('STEM');

        const hasMajorMention = criteriaLower.includes(majorLower) || titleLower.includes(majorLower) || categoryLower.includes(majorLower);
        const hasStemMatch = isStemMajor && isStemScholarship;

        if (hasMajorMention || hasStemMatch) {
          score += 30;
          reasons.push('Field of study aligns with scholarship focus');
        } else {
          const majorKeywords = majorLower.split(/\s+/).filter(word => word.length > 3);
          const hasKeywordMatch = majorKeywords.some(word => criteriaLower.includes(word) || titleLower.includes(word));
          if (hasKeywordMatch) {
            score += 20;
            reasons.push('Field of study partially aligns with scholarship focus');
          }
        }
      }

      // C. Destination Match (Weight: 20%)
      if (onboarding.destinations && onboarding.destinations.length > 0) {
        const providerUni = universities.find(uni => 
          schol.provider.toLowerCase().includes(uni.name.toLowerCase()) ||
          uni.name.toLowerCase().includes(schol.provider.toLowerCase())
        );

        if (providerUni) {
          const isDestMatch = onboarding.destinations.some(
            dest => dest.toLowerCase() === providerUni.locationCountry.toLowerCase()
          );
          if (isDestMatch) {
            score += 20;
            reasons.push(`Offered by a university in your destination country (${providerUni.locationCountry})`);
          } else {
            warnings.push(`Offered by a university in ${providerUni.locationCountry} (Not in your target destinations)`);
          }
        } else {
          score += 15;
          reasons.push('General scholarship open to multiple destinations');
        }
      } else {
        score += 15;
      }

      // D. Financial Need / Category Match (Weight: 20%)
      const userNeedsAid = onboarding.financialAid && 
        ['yes', 'need', 'aid', 'financial'].some(kw => onboarding.financialAid!.toLowerCase().includes(kw));
      
      const isNeedBasedSchol = schol.category.toLowerCase().includes('need');

      if (userNeedsAid) {
        if (isNeedBasedSchol) {
          score += 20;
          reasons.push('Need-based financial aid aligns with your preferences');
        } else if (schol.category.toLowerCase().includes('merit')) {
          score += 15;
          reasons.push('Merit-based opportunity to fund your studies');
        } else {
          score += 10;
        }
      } else {
        if (schol.category.toLowerCase().includes('merit') || schol.category.toLowerCase().includes('stem')) {
          score += 20;
          reasons.push('Academic/Merit focus aligns with your profile');
        } else {
          score += 10;
        }
      }

      return {
        scholarship: schol,
        matchScore: score === 0 ? 50 : score,
        reasons,
        warnings
      };
    });

    // Sort descending by matchScore
    recommended.sort((a, b) => b.matchScore - a.matchScore);

    res.status(200).json({
      success: true,
      data: recommended
    });
  } catch (error) {
    logger.error('getRecommendedScholarships error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
