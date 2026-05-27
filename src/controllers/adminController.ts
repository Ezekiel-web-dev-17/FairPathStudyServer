// TODO: Implement admin controllers
// - getAnalytics:      GET  /admin/analytics        — KPI metrics (admin only)
// - createUniversity:  POST /admin/universities      — Create university record
// - updateUniversity:  PUT  /admin/universities/:id  — Update university record

import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';

export const getAnalytics = async (_req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  res.status(501).json({ error: 'Not implemented' });
};

export const createUniversity = async (_req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  res.status(501).json({ error: 'Not implemented' });
};

export const updateUniversity = async (_req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  res.status(501).json({ error: 'Not implemented' });
};
