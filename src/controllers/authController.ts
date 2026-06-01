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
import { sendVerificationEmail, resend, sendResetPasswordEmail } from '../services/emailService.js';
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
 * Opts out a user from receiving marketing/engagement emails by verifying a signed JWT token and updating Resend.
 */
export const unsubscribe = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, email: rawEmail } = req.query;
    let email = '';

    if (token && typeof token === 'string') {
      try {
        const decoded = jwt.verify(token, JWT_SECRET!, { algorithms: ['HS256'] }) as { email: string };
        email = decoded.email;
      } catch (err) {
        res.status(400).json({
          status: 'error',
          message: 'Unsubscribe token is invalid or expired.',
        });
        return;
      }
    } else if (rawEmail && typeof rawEmail === 'string') {
      email = rawEmail;
    } else {
      res.status(400).json({
        status: 'error',
        message: 'Invalid or missing unsubscribe details.',
      });
      return;
    }

    if (!email) {
      res.status(400).json({
        status: 'error',
        message: 'Email address not provided.',
      });
      return;
    }

    // Call Resend to unsubscribe the contact from the Audience
    const audienceId = process.env.RESEND_AUDIENCE_ID || 'default';
    
    if (process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== 're_placeholder_key' && process.env.NODE_ENV !== 'test') {
      try {
        const { error: updateError } = await resend.contacts.update({
          email,
          unsubscribed: true,
          audienceId,
        });

        if (updateError) {
          logger.info(`Resend contact update failed (likely doesn't exist), creating unsubscribed contact for: ${email}`);
          const { error: createError } = await resend.contacts.create({
            email,
            unsubscribed: true,
            audienceId,
          });

          if (createError) {
            logger.error(`Failed to create unsubscribed contact in Resend:`, createError);
          }
        }
      } catch (resendErr) {
        logger.error(`Error communicating with Resend during unsubscribe:`, resendErr);
      }
    } else {
      logger.info(`[Unsubscribe Bypassed] Resend API call skipped in test/dev environment for: ${email}`);
    }

    // Still keep the database User model sync'd
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          marketingOptIn: false,
        },
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'You have been successfully unsubscribed from all marketing and onboarding follow-up emails via Resend.',
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

/**
 * POST /auth/forgot-password
 * Triggers a password reset email for verified accounts using stateless dynamic JWTs.
 */
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      res.status(400).json({
        status: 'error',
        message: 'A valid email address is required',
      });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({
        status: 'error',
        message: 'Invalid email address format',
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    // Enforce generic response regardless of whether user exists to prevent email enumeration
    const genericSuccessResponse = {
      status: 'success',
      message: 'If that email exists in our system, we have sent a reset password link.',
    };

    if (!user || !user.isVerified) {
      logger.info(`[Forgot Password] Bypassed reset email for non-existent/unverified address: ${email}`);
      res.status(200).json(genericSuccessResponse);
      return;
    }

    // Dynamic stateless token: secret incorporates the current passwordHash.
    // If the password is changed, the secret changes, invalidating this token.
    const secret = JWT_SECRET! + user.passwordHash;
    const token = jwt.sign({ id: user.id, email: user.email }, secret, { expiresIn: '15m' });

    await sendResetPasswordEmail(email, token);

    res.status(200).json(genericSuccessResponse);
  } catch (error) {
    logger.error('Error during forgot password request:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error during forgot password processing.',
    });
  }
};

/**
 * POST /auth/reset-password
 * Resets a user's password using a verified dynamic token and clears current sessions.
 */
export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, newPassword } = req.body;

    if (!token || typeof token !== 'string' || !newPassword || typeof newPassword !== 'string') {
      res.status(400).json({
        status: 'error',
        message: 'Token and new password are required',
      });
      return;
    }

    if (newPassword.length < 8) {
      res.status(400).json({
        status: 'error',
        message: 'Password must be at least 8 characters long',
      });
      return;
    }

    // Statelessly identify target user via decode first
    const decoded = jwt.decode(token) as { email?: string } | null;
    if (!decoded || !decoded.email) {
      res.status(400).json({
        status: 'error',
        message: 'Invalid or malformed reset token payload',
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email: decoded.email },
    });

    if (!user) {
      res.status(400).json({
        status: 'error',
        message: 'User associated with this token does not exist',
      });
      return;
    }

    // Securely verify token using the dynamic secret + HS256 constraints
    try {
      const secret = JWT_SECRET! + user.passwordHash;
      jwt.verify(token, secret, { algorithms: ['HS256'] });
    } catch (err) {
      res.status(400).json({
        status: 'error',
        message: 'Password reset link is invalid or has expired',
      });
      return;
    }

    // Update credentials
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    logger.info(`[Reset Password] Successfully updated password for user: ${user.email}`);

    // Clear authentication cookie to force re-login
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });

    // Destroy active session
    if (req.session) {
      req.session.destroy((err) => {
        if (err) {
          logger.warn('Session destruction warning during password reset:', err);
        }
        res.status(200).json({
          status: 'success',
          message: 'Password has been reset successfully. Please log in with your new password.',
        });
      });
    } else {
      res.status(200).json({
        status: 'success',
        message: 'Password has been reset successfully. Please log in with your new password.',
      });
    }
  } catch (error) {
    logger.error('Error during password reset:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error during password reset processing.',
    });
  }
};

