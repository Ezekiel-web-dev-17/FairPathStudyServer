// - getAnalytics:      GET  /admin/analytics        — KPI metrics (admin only)
// - createUniversity:  POST /admin/universities      — Create university record
// - updateUniversity:  PUT  /admin/universities/:id  — Update university record

import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { invalidateCacheByPattern } from '../config/redis.js';
import { prisma } from '../config/db.js';

export const getAnalytics = async (_req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  res.status(501).json({ error: 'Not implemented' });
};

export const createUniversity = async (req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  const {
    name,
    slug,
    locationCity,
    locationCountry,
    rankingGlobal,
    rankingNational,
    tuitionMin,
    tuitionMax,
    setting,
    type,
    acceptanceRate,
    studentBodySize,
    description,
    featuredImage,
    departments,
    isFeatured,
    isPartner,
  } = req.body;


  const existingUniversity = await prisma.university.findFirst({
    where: { name, locationCity, locationCountry },
  });

  if (existingUniversity) {
    res.status(400).json({ error: 'University already exists' });
    return;
  }

  await prisma.university.create({
    data: {
      name,
      slug,
      locationCity,
      locationCountry,
      rankingGlobal,
      rankingNational,
      tuitionMin,
      tuitionMax,
      setting,
      type,
      acceptanceRate,
      studentBodySize,
      description,
      featuredImage,
      departments,
      isFeatured,
      isPartner,
    },
  });

  res.status(201).json({ message: 'University created successfully' });
};

export const updateUniversity = async (req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    if (typeof id !== 'string') {
      res.status(400).json({ error: 'Invalid university ID' });
      return;
    }

    const { data } = req.body;
    const existingUniversity = await prisma.university.findFirst({
      where: { id },
    });

    if (!existingUniversity) {
      res.status(404).json({ error: 'University not found' });
      return;
    }

    await prisma.university.update({
      where: { id },
      data,
    });

    res.status(200).json({ message: 'University updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update university' });
  }
};

export const deleteUniversity = async (req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    if (typeof id !== 'string') {
      res.status(400).json({ error: 'Invalid university ID' });
      return;
    }

    const existingUniversity = await prisma.university.findFirst({
      where: { id },
    });

    if (!existingUniversity) {
      res.status(404).json({ error: 'University not found' });
      return;
    }

    await prisma.university.delete({
      where: { id },
    });

    res.status(200).json({ message: 'University deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete university' });
  }
};

export const clearCache = async (_req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  try {
    await invalidateCacheByPattern('cache:*');
    res.status(200).json({ success: true, message: 'Cache cleared successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear cache' });
  }
};