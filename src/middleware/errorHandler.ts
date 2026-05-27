import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

/**
 * Global error handling middleware.
 * Catches unhandled errors and returns a consistent JSON response.
 */
export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  logger.error('Unhandled Server Error: %o', err);

  const statusCode = res.statusCode !== 200 ? res.statusCode : 500;

  res.status(statusCode).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

/**
 * 404 handler — catches routes that don't match any registered endpoint.
 */
export const notFoundHandler = (_req: Request, res: Response): void => {
  res.status(404).json({ error: 'Endpoint not found' });
};
