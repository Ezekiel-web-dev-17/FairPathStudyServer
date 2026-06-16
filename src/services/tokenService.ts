import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { JWT_SECRET, JWT_REFRESH_SECRET } from '../config/config.js';
import { redisClient } from '../config/redis.js';
import logger from '../utils/logger.js';

export interface TokenPayload {
  id: string;
  email: string;
  role: 'STUDENT' | 'ADMIN';
}

export interface DecodedToken extends TokenPayload {
  jti: string;
  iat: number;
  exp: number;
}

/**
 * Generates a short-lived access token (15m) with a unique jti.
 */
export const generateAccessToken = (payload: TokenPayload): string => {
  const jti = crypto.randomUUID();
  return jwt.sign({ ...payload, jti }, JWT_SECRET!, { expiresIn: '15m' });
};

/**
 * Generates a long-lived refresh token (7d) with a unique jti.
 */
export const generateRefreshToken = (payload: TokenPayload): string => {
  const jti = crypto.randomUUID();
  return jwt.sign({ ...payload, jti }, JWT_REFRESH_SECRET!, { expiresIn: '7d' });
};

/**
 * Verifies an access token and returns its decoded payload.
 */
export const verifyAccessToken = (token: string): DecodedToken => {
  return jwt.verify(token, JWT_SECRET!, { algorithms: ['HS256'] }) as DecodedToken;
};

/**
 * Verifies a refresh token and returns its decoded payload.
 */
export const verifyRefreshToken = (token: string): DecodedToken => {
  return jwt.verify(token, JWT_REFRESH_SECRET!, { algorithms: ['HS256'] }) as DecodedToken;
};

/**
 * Blacklists a token by its jti in Redis for the remaining duration of its validity.
 */
export const blacklistToken = async (jti: string, expiresAt: number): Promise<void> => {
  try {
    if (!redisClient.isOpen) {
      logger.warn(`Redis is not open. Cannot blacklist token: ${jti}`);
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const ttl = expiresAt - now;
    if (ttl > 0) {
      await redisClient.set(`bl:jti:${jti}`, '1', { EX: ttl });
      logger.info(`Blacklisted token jti: ${jti} for ${ttl}s`);
    }
  } catch (err) {
    logger.error(`Failed to blacklist token jti ${jti}: %o`, err);
  }
};

/**
 * Checks if a token's jti is blacklisted in Redis.
 * If Redis is unavailable, fails open (returns false) to prevent system lockout.
 */
export const isTokenBlacklisted = async (jti: string): Promise<boolean> => {
  try {
    if (!redisClient.isOpen) {
      logger.warn(`Redis is not open. Skipping blacklist check for jti: ${jti}`);
      return false;
    }
    const result = await redisClient.get(`bl:jti:${jti}`);
    return result !== null;
  } catch (err) {
    logger.error(`Failed to check blacklist status for jti ${jti}: %o`, err);
    return false;
  }
};
