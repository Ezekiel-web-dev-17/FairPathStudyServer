import { Request, Response, NextFunction } from "express";
import { aj, authAj } from "../config/arcjet.js";
import { logger } from "../utils/logger.js";

/**
 * Global rate limiting middleware.
 * Applied to all routes — enforces 100 req/60s per IP,
 * blocks bots, and provides WAF shield protection.
 */
export const rateLimitMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (process.env.NODE_ENV === "test") {
    next();
    return;
  }

  try {
    const decision = await aj.protect(req);

    if (decision.isDenied()) {
      if (decision.reason.isRateLimit()) {
        res.status(429).json({ error: "Too many requests. Please try again later." });
        return;
      }
      if (decision.reason.isBot()) {
        res.status(403).json({ error: "Bot traffic detected." });
        return;
      }
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    next();
  } catch (err) {
    // If Arcjet is unavailable (e.g. bad key in dev), fail open and log
    logger.error("Arcjet error (failing open): %o", err);
    next();
  }
};

/**
 * Stricter rate limiting middleware for auth endpoints.
 * Limits to 10 req/60s to prevent brute-force login/registration attacks.
 */
export const authRateLimitMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (process.env.NODE_ENV === "test") {
    next();
    return;
  }

  try {
    const decision = await authAj.protect(req);

    if (decision.isDenied()) {
      if (decision.reason.isRateLimit()) {
        res.status(429).json({ error: "Too many authentication attempts. Please try again later." });
        return;
      }
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    next();
  } catch (err) {
    logger.error("Arcjet auth error (failing open): %o", err);
    next();
  }
};

