// TODO: Implement university controllers
// - getUniversities:         GET /universities          — Paginated + filtered list
// - getFeaturedUniversities: GET /universities/featured  — Featured/partner universities
// - getUniversityBySlug:     GET /universities/:slug     — Single university details

import { Request, Response, NextFunction } from 'express';

export const getUniversities = async (_req: Request, res: Response, _next: NextFunction): Promise<void> => {
  res.status(501).json({ error: 'Not implemented' });
};

export const getFeaturedUniversities = async (_req: Request, res: Response, _next: NextFunction): Promise<void> => {
  res.status(501).json({ error: 'Not implemented' });
};

export const getUniversityBySlug = async (_req: Request, res: Response, _next: NextFunction): Promise<void> => {
  res.status(501).json({ error: 'Not implemented' });
};
