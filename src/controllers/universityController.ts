// - getUniversities:         GET /universities          — Paginated + filtered list
// - getFeaturedUniversities: GET /universities/featured  — Featured/partner universities
// - getUniversityBySlug:     GET /universities/:slug     — Single university details

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/db.js';
import { Prisma } from '@prisma/client';

export const getUniversities = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 5;
    const skip = (page - 1) * limit;

    // Destructure query parameters with explicit TypeScript typing
    const {
      name,
      country,
      city,
      campusSetting,
      tuition,
      ranking,
    } = req.query as {
      name?: string;
      country?: string;
      city?: string;
      campusSetting?: "urban" | "suburban" | "rural";
      tuition?: "min" | "mid" | "max";
      ranking?: string;
    };

    // Initialize base filter
    let filter: Prisma.UniversityWhereInput = {
      isPartner: false,
    };

    // 1. Country Filter (Case-insensitive matching)
    if (country) {
      filter.locationCountry = { equals: country, mode: 'insensitive' };
    }

    // 2. City Filter (Case-insensitive matching)
    if (city) {
      filter.locationCity = { equals: city, mode: 'insensitive' };
    }

    // 3. Campus Setting Filter (URBAN, SUBURBAN, RURAL)
    if (campusSetting) {
      filter.setting = { equals: campusSetting.toUpperCase(), mode: 'insensitive' };
    }

    // 4. Name Filter (Case-insensitive matching)
    if (name) {
      filter.name = { contains: name, mode: 'insensitive' };
    }


    // 5. Tuition Filters (min <= 30k, mid = 30k-50k, max >= 50k)
    if (tuition) {
      if (tuition === 'min') {
        filter.tuitionMax = { lte: 20000 };
      } else if (tuition === 'mid') {
        filter.tuitionMin = { lte: 40000 };
        filter.tuitionMax = { gte: 20000 };
      } else if (tuition === 'max') {
        filter.tuitionMin = { gte: 40000 };
      }
    }

    // 6. Ranking Filters (top10, top50, top100 or numeric cap)
    if (ranking) {
      if (ranking === '50') {
        filter.rankingGlobal = { lte: 50 };
      } else if (ranking === '100') {
        filter.rankingGlobal = { lte: 100 };
      } else if (ranking === '200') {
        filter.rankingGlobal = { lte: 200 };
      } else {
        const parsedRank = parseInt(ranking);
        if (!isNaN(parsedRank)) {
          filter.rankingGlobal = { lte: parsedRank };
        }
      }
    }

    // Query databases
    const universities = await prisma.university.findMany({
      skip,
      take: limit,
      where: filter,
      orderBy: { name: 'asc' },
    });

    // Count records matching the exact same filters
    const total = await prisma.university.count({
      where: filter,
    });
    
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
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
};

export const getFeaturedUniversitiesSlug = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  try {
     const {
      name,
      country,
      city,
      campusSetting,
      tuition,
      ranking,
    } = req.query as {
      name?: string;
      country?: string;
      city?: string;
      campusSetting?: "urban" | "suburban" | "rural";
      tuition?: "min" | "mid" | "max";
      ranking?: string;
    };

    // Initialize base filter
    let filter: Prisma.UniversityWhereInput = {
      isPartner: true
    };

    // 1. Country Filter (Case-insensitive matching)
    if (country) {
      filter.locationCountry = { equals: country, mode: 'insensitive' };
    }

    // 2. City Filter (Case-insensitive matching)
    if (city) {
      filter.locationCity = { equals: city, mode: 'insensitive' };
    }

    // 3. Campus Setting Filter (URBAN, SUBURBAN, RURAL)
    if (campusSetting) {
      filter.setting = { equals: campusSetting.toUpperCase(), mode: 'insensitive' };
    }

    // 4. Name Filter (Case-insensitive matching)
    if (name) {
      filter.name = { contains: name, mode: 'insensitive' };
    }

    // 5. Tuition Filters (min <= 30k, mid = 30k-50k, max >= 50k)
    if (tuition) {
      if (tuition === 'min') {
        filter.tuitionMax = { lte: 20000 };
      } else if (tuition === 'mid') {
        filter.tuitionMin = { lte: 40000 };
        filter.tuitionMax = { gte: 20000 };
      } else if (tuition === 'max') {
        filter.tuitionMin = { gte: 40000 };
      }
    }

    // 6. Ranking Filters (top10, top50, top100 or numeric cap)
    if (ranking) {
      if (ranking === '50') {
        filter.rankingGlobal = { lte: 50 };
      } else if (ranking === '100') {
        filter.rankingGlobal = { lte: 100 };
      } else if (ranking === '200') {
        filter.rankingGlobal = { lte: 200 };
      } else {
        const parsedRank = parseInt(ranking);
        if (!isNaN(parsedRank)) {
          filter.rankingGlobal = { lte: parsedRank };
        }
      }
    }

    // Query databases
    const universities = await prisma.university.findMany({
      where: filter,
      orderBy: { name: 'asc' },
    });

    // Count records matching the exact same filters
    const total = await prisma.university.count({
      where: filter,
    });
    
    res.status(200).json({
      success: true,
      data: universities,
    });
  } catch (err) {
    res.status(500).json({ error: "Something went wrong." });
  }
}

export const getFeaturedUniversities = async (_req: Request, res: Response, _next: NextFunction): Promise<void> => {
  try {
    // get only the id and image of the featured universities in the most optimal way possible
    const featured = await prisma.university.findMany({
      where: { isFeatured: true, isPartner: true },
      select: { id: true, featuredImage: true }, // only get the id and image of the featured universities
    });

    if (!featured.length) {
      res.status(404).json({ error: "No Featuring Universities Found" });
      return;
    }

    res.status(200).json({ success: true, data: featured });
  } catch (err) {
    res.status(500).json({ error: "Something went wrong." });
  }
};
