// TODO: Implement authentication controllers
// - register: POST /auth/register  — Creates a new user, returns JWT + user
// - login:    POST /auth/login     — Authenticates credentials, returns JWT + user
// - getMe:    GET  /users/me       — Returns the authenticated user's profile
// - updateProfile: PUT /users/me/profile — Updates academic data & preferences

import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';

export const register = async (_req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  res.status(501).json({ error: 'Not implemented' });
};

export const login = async (_req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  res.status(501).json({ error: 'Not implemented' });
};

export const getMe = async (_req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  res.status(501).json({ error: 'Not implemented' });
};

export const updateProfile = async (_req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  res.status(501).json({ error: 'Not implemented' });
};
