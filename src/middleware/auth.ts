import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN, JWT_SECRET } from '../config/config.js';
import { isTokenBlacklisted } from '../services/tokenService.js';
import ms from 'ms';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: 'STUDENT' | 'ADMIN';
  };
  tokenJti?: string;
  tokenExp?: number;
}

// Define cookie options with strict security guidelines:
export const cookieOptions = {
  httpOnly: true, // Prevents XSS attacks by blocking client-side JS access
  secure: process.env.NODE_ENV === 'production', // Enforces HTTPS in production
  sameSite: 'lax' as const, // Standard CSRF defense for navigation/API requests
  maxAge: JWT_EXPIRES_IN ? (ms(JWT_EXPIRES_IN as any) as unknown as number) : 15 * 60 * 1000 // default 15 minutes
};

export const refreshCookieOptions = {
  httpOnly: true, // Prevents XSS attacks by blocking client-side JS access
  secure: process.env.NODE_ENV === 'production', // Enforces HTTPS in production
  sameSite: 'lax' as const, // Standard CSRF defense for navigation/API requests
  maxAge: JWT_REFRESH_EXPIRES_IN ? (ms(JWT_REFRESH_EXPIRES_IN as any) as unknown as number) : 7 * 24 * 60 * 60 * 1000 // default 7 days
};

export const authenticateJWT = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader) {
    token = authHeader.split(' ')[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (token) {
    const secret = JWT_SECRET!;

    jwt.verify(token, secret, { algorithms: ['HS256'] }, async (err: Error | null, decoded: any) => {
      if (err) {
        res.status(403).json({ error: 'Forbidden: Invalid or expired token' });
        return;
      }
      
      const payload = decoded as any;
      if (payload.jti) {
        const blacklisted = await isTokenBlacklisted(payload.jti);
        if (blacklisted) {
          res.status(403).json({ error: 'Forbidden: Token is blacklisted' });
          return;
        }
        req.tokenJti = payload.jti;
        req.tokenExp = payload.exp;
      }
      
      req.user = {
        id: payload.id,
        email: payload.email,
        role: payload.role,
      };
      next();
    });
  } else {
    res.status(401).json({ error: 'Unauthorized: Missing authorization header or token cookie' });
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

    jwt.verify(token, secret, { algorithms: ['HS256'] }, async (err: Error | null, decoded: any) => {
      if (err) {
        res.status(403).json({ error: 'Forbidden: Invalid or expired token' });
        return;
      }
      
      const payload = decoded as any;
      if (payload.jti) {
        const blacklisted = await isTokenBlacklisted(payload.jti);
        if (blacklisted) {
          res.status(403).json({ error: 'Forbidden: Token is blacklisted' });
          return;
        }
        req.tokenJti = payload.jti;
        req.tokenExp = payload.exp;
      }
      
      req.user = {
        id: payload.id,
        email: payload.email,
        role: payload.role,
      };
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
