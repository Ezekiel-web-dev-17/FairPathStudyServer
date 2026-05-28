import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../config/redis.js';
import { logger } from '../utils/logger.js';

/**
 * Express middleware that caches JSON responses in Redis.
 * Cache key is derived from the request URL (path + query string).
 */
export const cacheMiddleware = (durationInSeconds: number) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const cacheKey = `cache:${req.originalUrl || req.url}`;

    try {
      if (!redisClient.isOpen) {
        next();
        return;
      }

      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        res.status(200).json({ ...JSON.parse(cachedData), fromCache: true, cachedAt: new Date().toISOString() });
        return;
      }

      // Override response.json to capture and cache data on success
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        if (res.statusCode === 200) {
          redisClient.setEx(cacheKey, durationInSeconds, JSON.stringify(body));
        }
        return originalJson(body);
      };

      next();
    } catch (err) {
      logger.error('Redis Caching Error: %o', err);
      next(); // fallback to DB query on cache failure
    }
  };
};

export const inValidateCacheMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const cacheKey = `cache:${req.originalUrl}*`;

  try {
    if (redisClient.isOpen) {
      await redisClient.del(cacheKey);
    }
    next();
  } catch (err) {
    logger.error(`Error invalidating cache for key ${cacheKey}: %o`, err);
    next(); // fallback to DB query on cache failure
  }
};
