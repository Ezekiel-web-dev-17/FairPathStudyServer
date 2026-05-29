// - register: POST /auth/register  — Creates a new user, returns JWT + user
// - login:    POST /auth/login     — Authenticates credentials, returns JWT + user
// - getMe:    GET  /users/me       — Returns the authenticated user's profile
// - updateProfile: PUT /users/me/profile — Updates academic data & preferences

import { Request, Response, NextFunction } from 'express';
import { AuthRequest, cookieOptions } from '../middleware/auth.js';
import { prisma } from '../config/db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { StringValue } from 'ms';
import { JWT_EXPIRES_IN, JWT_SECRET } from '../config/config.js';
import crypto from 'node:crypto';
import { sendVerificationEmail } from '../services/emailService.js';
import logger from '../utils/logger.js';

export const register = async (req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  try {
    const {
      fullName,
      email,
      password,
      role
    } = req.body as {fullName: string, email: string, password: string, role?: "ADMIN"};

    if(!fullName || !email || !password || !role){
      res.status(400).json({
        status: 'error',
        message: 'Full name, email and password are required',
      });

      return;
    }

    const existingUser = await prisma.user.findUnique({
      where: {email}
    });

    if (existingUser){
      if (existingUser.isVerified) {
        res.status(400).json({
          status: 'error',
          message: 'User already exists',
        });

        return;
      }

      // Handle unverified user re-registering (regenerate token and update credentials)
      const salt = await bcrypt.genSalt(12);
      const passwordHash = await bcrypt.hash(password, salt);
      const firstName = fullName.split(' ')[0];
      const lastName = fullName.split(' ').slice(1).join(' ');

      const verificationCode = crypto.randomBytes(32).toString('hex');
      const verificationCodeExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          firstName,
          lastName,
          passwordHash,
          role,
          verificationCode,
          verificationCodeExpires,
        },
      });

      await sendVerificationEmail(email, verificationCode);

      res.status(201).json({
        status: 'success',
        message: 'User registered successfully. Please check your email to verify your account.',
      });

      return;
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    const firstName = fullName.split(' ')[0];
    const lastName = fullName.split(' ').slice(1).join(' ');

    const verificationCode = crypto.randomBytes(32).toString('hex');
    const verificationCodeExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const user = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email,
        passwordHash,
        role,
        isVerified: false,
        verificationCode,
        verificationCodeExpires,
      },
    });

    await sendVerificationEmail(email, verificationCode);

    res.status(201).json({
      status: 'success',
      message: 'User registered successfully. Please check your email to verify your account.',
    });

    return;
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error
    });
  }
};

export const login = async (req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  try {
    const {email, password} = req.body;
    if (!email || !password){
      res.status(400).json({
        status: 'error',
        message: 'Email and password are required',
      });

      return
    }

    const user = await prisma.user.findUnique({
      where: {email}
    });

    if (!user){
      res.status(401).json({
        status: 'error',
        message: 'Invalid email or password',
      });

      return;
    }

    if (!user.isVerified) {
      res.status(401).json({
        status: 'error',
        message: 'Please verify your email before logging in.',
      });

      return;
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid){
      res.status(401).json({
        status: 'error',
        message: 'Invalid email or password',
      });

      return;
    }

    if (!JWT_SECRET || !JWT_EXPIRES_IN){
      res.status(500).json({
        status: 'error',
        message: 'Server configuration error',
      });

      return;
    }

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN as StringValue });

    res.cookie('token', token, cookieOptions);
    
    res.status(200).json({
      status: 'success',
      message: 'Login successful.',
    });

    return;
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error
    });
  }
};

export const getMe = async (_req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  try {
    res.status(501).json({ error: 'Not implemented' });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error
    });
  }
};

export const updateProfile = async (_req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  try {
    res.status(501).json({ error: 'Not implemented' });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error
    });
  }
};

export const verifyEmail = async (req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  try {
    const { code } = req.query;

    if (!code || typeof code !== 'string') {
      res.status(400).json({
        status: 'error',
        message: 'Verification code is required',
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { verificationCode: code },
    });

    if (!user) {
      res.status(400).json({
        status: 'error',
        message: 'Invalid or expired verification code',
      });
      return;
    }

    if (user.verificationCodeExpires && new Date() > user.verificationCodeExpires) {
      res.status(400).json({
        status: 'error',
        message: 'Verification code has expired. Please register again.',
      });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        verificationCode: null,
        verificationCodeExpires: null,
        profileCompletionPercent: 20, // Verification gives them an initial 20% profile score
      },
    });

    // Redirect to frontend login page
    res.redirect('http://localhost:5173/login?verified=true');
    return;
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Internal server error during email verification',
      error,
    });
  }
};

/**
 * GET /auth/unsubscribe
 * Opts out a user from receiving marketing/engagement emails by verifying a signed JWT token.
 */
export const unsubscribe = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      res.status(400).json({
        status: 'error',
        message: 'Invalid or missing unsubscribe token.',
      });
      return;
    }

    let decoded: { email: string };
    try {
      decoded = jwt.verify(token, JWT_SECRET!) as { email: string };
    } catch (err) {
      res.status(400).json({
        status: 'error',
        message: 'Unsubscribe token is invalid or expired.',
      });
      return;
    }

    const email = decoded.email;
    if (!email) {
      res.status(400).json({
        status: 'error',
        message: 'Invalid token payload.',
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      res.status(404).json({
        status: 'error',
        message: 'User not found.',
      });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        marketingOptIn: false,
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'You have been successfully unsubscribed from all marketing and onboarding follow-up emails.',
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Internal server error during unsubscribe.',
      error,
    });
  }
};

/**
 * POST /auth/logout
 * Logs out a user by clearing cookies and destroying session state.
 */
export const logout = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // 1. Clear the JWT token cookie
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });

    // 2. Destroy express-session if it exists
    if (req.session) {
      req.session.destroy((err) => {
        if (err) {
          logger.warn('Session destruction warning during logout (session might not exist in store):', err);
        }
        res.status(200).json({
          status: 'success',
          message: 'Logout successful.',
        });
      });
    } else {
      res.status(200).json({
        status: 'success',
        message: 'Logout successful.',
      });
    }
  } catch (error) {
    logger.error('Error during logout:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error during logout.',
    });
  }
};
