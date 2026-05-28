import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/config.js';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: 'STUDENT' | 'ADMIN';
  };
}

// Define cookie options with strict security guidelines:
export const cookieOptions = {
  httpOnly: true, // Prevents XSS attacks by blocking client-side JS access
  secure: process.env.NODE_ENV === 'production', // Enforces HTTPS in production
  sameSite: 'lax' as const, // Standard CSRF defense for navigation/API requests
  maxAge: 24 * 60 * 60 * 1000 // Match your token duration (e.g., 24 hours in ms)
};

export const authenticateJWT = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const token = authHeader.split(' ')[1];
    const secret = JWT_SECRET!;

    jwt.verify(token, secret, (err: Error | null, decoded: any) => {
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

export const authenticateJWTCookie = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void => {
  // Read token from the cookie instead of the Authorization header
  const token = req.cookies.token;

  if (token) {
    const secret = JWT_SECRET!;

    jwt.verify(token, secret, (err: Error | null, decoded: any) => {
      if (err) {
        res.status(403).json({ error: 'Forbidden: Invalid or expired token' });
        return;
      }
      req.user = decoded as AuthRequest['user'];
      next();
    });
  } else {
    res.status(401).json({ error: 'Unauthorized: Missing token cookie' });
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
