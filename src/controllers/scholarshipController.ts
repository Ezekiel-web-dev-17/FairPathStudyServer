// TODO: Implement scholarship controllers
// - getScholarships:            GET /scholarships             — Paginated list with filters
// - getRecommendedScholarships: GET /scholarships/recommended — Personalized matches (auth required)

import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';

export const getScholarships = async (_req: Request, res: Response, _next: NextFunction): Promise<void> => {
  res.status(501).json({ error: 'Not implemented' });
};

export const getRecommendedScholarships = async (_req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  res.status(501).json({ error: 'Not implemented' });
};
