// TODO: Implement dashboard controllers
// - getDashboardSummary: GET    /dashboard/summary — Core widget metrics
// - getFavourites:       GET    /favourites         — List saved universities/scholarships
// - addFavourite:        POST   /favourites         — Save a university or scholarship
// - deleteFavourite:     DELETE /favourites/:id     — Remove from favourites
// - getApplications:     GET    /applications       — List user's applications

import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';

export const getDashboardSummary = async (_req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  res.status(501).json({ error: 'Not implemented' });
};

export const getFavourites = async (_req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  res.status(501).json({ error: 'Not implemented' });
};

export const addFavourite = async (_req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  res.status(501).json({ error: 'Not implemented' });
};

export const deleteFavourite = async (_req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  res.status(501).json({ error: 'Not implemented' });
};

export const getApplications = async (_req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  res.status(501).json({ error: 'Not implemented' });
};
