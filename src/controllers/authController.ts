// - register: POST /auth/register  — Creates a new user, returns JWT + user
// - login:    POST /auth/login     — Authenticates credentials, returns JWT + user
// - getMe:    GET  /users/me       — Returns the authenticated user's profile
// - updateProfile: PUT /users/me/profile — Updates academic data & preferences

import { Request, Response, NextFunction } from 'express';
import { AuthRequest, cookieOptions, refreshCookieOptions } from '../middleware/auth.js';
import { prisma } from '../config/db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, NODE_ENV, RESEND_API_KEY, RESEND_AUDIENCE_ID } from '../config/config.js';
import crypto from 'node:crypto';
import { sendVerificationEmail, resend, sendResetPasswordEmail, sendPasswordResetSuccessEmail } from '../services/emailService.js';
import logger from '../utils/logger.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  blacklistToken,
  isTokenBlacklisted,
  DecodedToken
} from '../services/tokenService.js';
import { encryptResetToken, decryptResetToken } from '../utils/crypto.js';
import { webSocketService } from '../services/websocketService.js';

export const validatePassword = (password: string): string | null => {
  if (password.length < 8) {
    return 'Password must be at least 8 characters long';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must contain at least one lowercase letter';
  }
  if (!/\d/.test(password)) {
    return 'Password must contain at least one number';
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return 'Password must contain at least one special character';
  }
  return null;
};

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

    const passwordError = validatePassword(password);
    if (passwordError) {
      res.status(400).json({
        status: 'error',
        message: passwordError,
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

    const audienceId = RESEND_AUDIENCE_ID || 'default';
    if (RESEND_API_KEY && RESEND_API_KEY !== 're_placeholder_key' && NODE_ENV !== 'test') {
      try {
        await resend.contacts.create({
          email,
          unsubscribed: false,
          audienceId,
          firstName,
          lastName,
        });
      } catch (err) {
        logger.error(`Error creating contact in Resend during registration for ${email}:`, err);
      }
    }

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

    const payload = { id: user.id, email: user.email, role: user.role };
    const token = generateAccessToken(payload);
    const newRefreshToken = generateRefreshToken(payload);

    res.cookie('token', token, cookieOptions);
    res.cookie('refreshToken', newRefreshToken, refreshCookieOptions);
    
    res.status(200).json({
      status: 'success',
      message: 'Login successful.',
    });

    return;
  } catch (error) {
    logger.error('Error during login:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error
    });
  }
};

export const getMe = async (req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        status: 'error',
        message: 'Not authenticated',
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isVerified: true,
        countryOfOrigin: true,
        targetDestinations: true,
        academicData: true,
        preferences: true,
        profileCompletionPercent: true,
      }
    });

    if (!user) {
      res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
      return;
    }

    res.status(200).json({
      status: 'success',
      data: user,
    });
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

<<<<<<< HEAD
    let decoded: { email: string };
    try {
      decoded = jwt.verify(token, JWT_SECRET!, { algorithms: ['HS256'] }) as { email: string };
    } catch (err) {
      res.status(400).json({
        status: 'error',
        message: 'Unsubscribe token is invalid or expired.',
      });
      return;
    }

    const email = decoded.email;
=======
>>>>>>> 02fc64d (feat(service): integrate Resend SDK and refactor email unsubscribe logic)
    if (!email) {
      res.status(400).json({
        status: 'error',
        message: 'Email address not provided.',
      });
      return;
    }

    // Call Resend to unsubscribe the contact from the Audience
    const audienceId = RESEND_AUDIENCE_ID || 'default';
    
    if (RESEND_API_KEY && RESEND_API_KEY !== 're_placeholder_key' && NODE_ENV !== 'test') {
      try {
        const { error: updateError } = await resend.contacts.update({
          email,
          unsubscribed: true,
          audienceId,
        });

        if (updateError) {
          logger.error(`Failed to update unsubscribe status for contact in Resend:`, updateError);
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
    // 1. Blacklist tokens if present
    let tokenJti = req.tokenJti;
    let tokenExp = req.tokenExp;
    let userId = req.user?.id;

    if (!tokenJti) {
      const authHeader = req.headers.authorization;
      let token = "";
      if (authHeader) {
        token = authHeader.split(' ')[1];
      } else if (req.cookies && req.cookies.token) {
        token = req.cookies.token;
      }

      if (token) {
        try {
          const decoded = verifyAccessToken(token);
          if (decoded && decoded.jti) {
            tokenJti = decoded.jti;
            tokenExp = decoded.exp;
            userId = decoded.id;
          }
        } catch (err) {
          // ignore invalid/expired access token
        }
      }
    }

    if (tokenJti && tokenExp) {
      await blacklistToken(tokenJti, tokenExp);
    }

    const oldRefreshToken = req.cookies.refreshToken;
    if (oldRefreshToken) {
      try {
        const decodedRefresh = verifyRefreshToken(oldRefreshToken);
        if (decodedRefresh && decodedRefresh.jti) {
          await blacklistToken(decodedRefresh.jti, decodedRefresh.exp);
        }
      } catch (err) {
        // ignore invalid/expired refresh token
      }
    }

    const finalUserId = req.user?.id || userId || req.session?.user?.id;
    if (finalUserId) {
      webSocketService.terminateUserConnections(finalUserId, 'User logged out');
    }

    // 2. Clear both cookie tokens
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });

    // 3. Destroy express-session if it exists
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

    // Crypto-encrypted stateless token containing the password hash for rotation check
    const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60; // 15 minutes
    const token = encryptResetToken({
      id: user.id,
      email: user.email,
      passwordHash: user.passwordHash,
      expiresAt,
    });

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

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      res.status(400).json({
        status: 'error',
        message: passwordError,
      });
      return;
    }

    // Securely verify token using crypto-decryption
    const decoded = decryptResetToken(token);
    if (!decoded || !decoded.email || !decoded.passwordHash || !decoded.expiresAt) {
      res.status(400).json({
        status: 'error',
        message: 'Invalid or malformed reset token payload',
      });
      return;
    }

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (decoded.expiresAt < now) {
      res.status(400).json({
        status: 'error',
        message: 'Password reset link is invalid or has expired',
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

    // Verify password hash has not changed (ensures single-use reset link)
    if (user.passwordHash !== decoded.passwordHash) {
      res.status(400).json({
        status: 'error',
        message: 'Password reset link is invalid or has already been used',
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

    // Send successful reset email
    await sendPasswordResetSuccessEmail(user.email);

    // Terminate any active websocket sessions for this user
    webSocketService.terminateUserConnections(user.id, 'Password reset');

    // Blacklist active tokens if cookies are set
    const currentAccessToken = req.cookies.token;
    if (currentAccessToken) {
      try {
        const decodedAccess = verifyAccessToken(currentAccessToken);
        if (decodedAccess && decodedAccess.jti) {
          await blacklistToken(decodedAccess.jti, decodedAccess.exp);
        }
      } catch (e) {}
    }
    const currentRefreshToken = req.cookies.refreshToken;
    if (currentRefreshToken) {
      try {
        const decodedRefresh = verifyRefreshToken(currentRefreshToken);
        if (decodedRefresh && decodedRefresh.jti) {
          await blacklistToken(decodedRefresh.jti, decodedRefresh.exp);
        }
      } catch (e) {}
    }

    // Clear cookies to force re-login
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    res.clearCookie('refreshToken', {
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

/**
 * POST /auth/refresh-token
 * Rotates the refresh token: validates the old refresh token, blacklists it, and issues a new pair.
 */
export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const oldRefreshToken = req.cookies.refreshToken;

    if (!oldRefreshToken) {
      res.status(401).json({
        status: 'error',
        message: 'Refresh token cookie is missing',
      });
      return;
    }

    let decoded: DecodedToken;
    try {
      decoded = verifyRefreshToken(oldRefreshToken);
    } catch (err) {
      res.status(403).json({
        status: 'error',
        message: 'Invalid or expired refresh token',
      });
      return;
    }

    // Check if the old refresh token is blacklisted in Redis
    const isBlacklisted = await isTokenBlacklisted(decoded.jti);
    if (isBlacklisted) {
      res.status(403).json({
        status: 'error',
        message: 'Refresh token has been blacklisted',
      });
      return;
    }

    // Blacklist the old refresh token (Token Rotation)
    await blacklistToken(decoded.jti, decoded.exp);

    // Fetch the user to ensure they still exist and are active
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
    });

    if (!user || !user.isVerified) {
      res.status(403).json({
        status: 'error',
        message: 'User no longer exists or is unverified',
      });
      return;
    }

    // Generate a new token pair
    const payload = { id: user.id, email: user.email, role: user.role };
    const newAccessToken = generateAccessToken(payload);
    const newRefreshToken = generateRefreshToken(payload);

    // Set cookies
    res.cookie('token', newAccessToken, cookieOptions);
    res.cookie('refreshToken', newRefreshToken, refreshCookieOptions);

    res.status(200).json({
      status: 'success',
      message: 'Tokens refreshed successfully.',
    });
  } catch (error) {
    logger.error('Error during token refresh:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error during token refresh.',
    });
  }
};

