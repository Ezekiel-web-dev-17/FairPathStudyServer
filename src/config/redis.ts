import { createClient } from 'redis';
import { logger } from '../utils/logger.js';
import { REDIS_URL } from './config.js';

const redisUrl = REDIS_URL!;

export const redisClient = createClient({
  url: redisUrl,
});

redisClient.on('error', (err) => logger.error('Redis Client Error: %o', err));
redisClient.on('connect', () => logger.info('Redis Client Connected successfully.'));

export const connectRedis = async (): Promise<void> => {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
  } catch (err) {
    logger.error('Failed to connect to Redis: %o', err);
  }
};

/**
 * Get data from Redis cache.
 * Returns null on cache miss or if Redis is unavailable.
 */
export const getCachedData = async <T>(key: string): Promise<T | null> => {
  try {
    if (!redisClient.isOpen) return null;
    const data = await redisClient.get(key);
    return data ? (JSON.parse(data) as T) : null;
  } catch (err) {
    logger.error(`Error getting cached data for key ${key}: %o`, err);
    return null;
  }
};

/**
 * Set data in Redis cache with an optional TTL (Time To Live) in seconds.
 * Defaults to 5 minutes (300s).
 */
export const setCachedData = async (
  key: string,
  value: unknown,
  ttlSeconds: number = 300,
): Promise<void> => {
  try {
    if (!redisClient.isOpen) return;
    await redisClient.set(key, JSON.stringify(value), {
      EX: ttlSeconds,
    });
  } catch (err) {
    logger.error(`Error setting cached data for key ${key}: %o`, err);
  }
};

/**
 * Delete a cache key (invalidation).
 */
export const invalidateCache = async (key: string): Promise<void> => {
  try {
    if (!redisClient.isOpen) return;
    await redisClient.del(key);
  } catch (err) {
    logger.error(`Error invalidating cache for key ${key}: %o`, err);
  }
};

/**
 * Invalidate all cache keys matching a given pattern.
 * Useful for clearing all university or scholarship caches at once.
 */
export const invalidateCacheByPattern = async (pattern: string): Promise<void> => {
  try {
    if (!redisClient.isOpen) return;
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  } catch (err) {
    logger.error(`Error invalidating cache by pattern ${pattern}: %o`, err);
  }
};

