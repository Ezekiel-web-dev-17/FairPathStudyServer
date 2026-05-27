import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: 'STUDENT' | 'ADMIN';
  };
}

export const authenticateJWT = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET!;

    jwt.verify(token, secret, (err, decoded) => {
      if (err) {
        res.status(403).json({ error: 'Forbidden: Invalid or expired token' });
        return;
      }
      req.user = decoded as AuthRequest['user'];
      next();
    });
  } else {
    res.status(401).json({ error: 'Unauthorized: Missing authorization header' });
  }
};

declare module 'express-session' {
  interface SessionData {
    user?: {
      id: string;
      email: string;
      role: 'STUDENT' | 'ADMIN';
    };
  }
}

// The Auth Middleware
export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: "Access denied. Please log in." });
    }

    req.user = req.session.user; 
    next(); 
};

export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized: Missing token' });
    return;
  }

  if (req.user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Forbidden: Admin access required' });
    return;
  }

  next();
};
