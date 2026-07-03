/**
 * Middleware Unit and Integration Tests
 * --------------------------------------
 * Tests the custom Express middlewares:
 * - errorHandler.ts: Global error responses, 404 notFoundHandler
 * - cache.ts: caching responses in Redis, invalidating cache on mutation
 * - auth.ts: authenticateJWT, requireAuth, requireAdmin
 */

import { errorHandler, notFoundHandler } from '../middleware/errorHandler.js';
import { cacheMiddleware, inValidateCacheMiddleware } from '../middleware/cache.js';
import { authenticateJWT, authenticateJWTCookie, requireAuth, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { redisClient } from '../config/redis.js';
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/config.js';

interface CustomMock {
  (...args: any[]): any;
  mock: {
    calls: any[][];
    returnValue: any;
  };
  mockReturnValue: (val: any) => CustomMock;
}

const createMockFn = (returnValue?: any): CustomMock => {
  const fn = (...args: any[]) => {
    fn.mock.calls.push(args);
    return fn.mock.returnValue;
  };
  fn.mock = {
    calls: [] as any[][],
    returnValue: returnValue,
  };
  fn.mockReturnValue = (val: any) => {
    fn.mock.returnValue = val;
    return fn;
  };
  return fn;
};

// Helper to create mocked Request, Response, NextFunction
const mockRequest = (overrides: any = {}): AuthRequest => {
  return {
    headers: {},
    cookies: {},
    query: {},
    params: {},
    body: {},
    session: {},
    ...overrides,
  } as unknown as AuthRequest;
};

const mockResponse = (): Response => {
  const res = {} as Response;
  const statusMock = createMockFn(res);
  const jsonMock = createMockFn(res);
  const setHeaderMock = createMockFn(res);
  
  res.status = statusMock as any;
  res.json = jsonMock as any;
  res.setHeader = setHeaderMock as any;
  res.statusCode = 200;
  return res;
};

const mockNext = () => createMockFn();

describe('Middleware Unit Tests', () => {
  // ── errorHandler.ts ────────────────────────────────────────────────────────
  describe('ErrorHandler Middleware', () => {
    it('should catch error and return 500 status code with JSON message by default', () => {
      const err = new Error('Database connection failed');
      const req = mockRequest();
      const res = mockResponse();
      const next = mockNext();

      errorHandler(err, req, res, next as any);

      expect((res.status as any).mock.calls[0][0]).toBe(500);
      expect((res.json as any).mock.calls[0][0]).toHaveProperty('error');
    });

    it('should respect response.statusCode if already set to non-200', () => {
      const err = new Error('Bad request details');
      const req = mockRequest();
      const res = mockResponse();
      res.statusCode = 400;
      const next = mockNext();

      errorHandler(err, req, res, next as any);

      expect((res.status as any).mock.calls[0][0]).toBe(400);
    });

    it('notFoundHandler should return 404 with Endpoint not found error', () => {
      const req = mockRequest();
      const res = mockResponse();

      notFoundHandler(req, res);

      expect((res.status as any).mock.calls[0][0]).toBe(404);
      expect((res.json as any).mock.calls[0][0]).toEqual({ error: 'Endpoint not found' });
    });
  });

  // ── auth.ts ────────────────────────────────────────────────────────────────
  describe('Auth Middleware', () => {
    const payload = { id: 'user-1', email: 'test@auth.com', role: 'STUDENT' as const, jti: 'jti-1' };
    let validToken: string;

    beforeAll(() => {
      validToken = jwt.sign(payload, JWT_SECRET || 'secret', { algorithm: 'HS256' });
    });

    describe('requireAdmin', () => {
      it('should return 401 if req.user is missing', () => {
        const req = mockRequest({ user: undefined });
        const res = mockResponse();
        const next = mockNext();

        requireAdmin(req, res, next as any);

        expect((res.status as any).mock.calls[0][0]).toBe(401);
        expect((res.json as any).mock.calls[0][0]).toEqual({ error: 'Unauthorized: Missing token' });
        expect((next as any).mock.calls.length).toBe(0);
      });

      it('should return 403 if user is not an admin', () => {
        const req = mockRequest({ user: { id: '1', email: 's@test.com', role: 'STUDENT' } });
        const res = mockResponse();
        const next = mockNext();

        requireAdmin(req, res, next as any);

        expect((res.status as any).mock.calls[0][0]).toBe(403);
        expect((res.json as any).mock.calls[0][0]).toEqual({ error: 'Forbidden: Admin access required' });
        expect((next as any).mock.calls.length).toBe(0);
      });

      it('should call next() if user is an admin', () => {
        const req = mockRequest({ user: { id: '1', email: 'a@test.com', role: 'ADMIN' } });
        const res = mockResponse();
        const next = mockNext();

        requireAdmin(req, res, next as any);

        expect((next as any).mock.calls.length).toBe(1);
        expect((res.status as any).mock.calls.length).toBe(0);
      });
    });

    describe('requireAuth', () => {
      it('should return 401 if session or user is missing', () => {
        const req = mockRequest({ session: undefined });
        const res = mockResponse();
        const next = mockNext();

        requireAuth(req, res, next as any);

        expect((res.status as any).mock.calls[0][0]).toBe(401);
        expect((next as any).mock.calls.length).toBe(0);
      });

      it('should populate req.user and call next if session user exists', () => {
        const sessionUser = { id: '2', email: 'u@test.com', role: 'STUDENT' as const };
        const req = mockRequest({ session: { user: sessionUser } });
        const res = mockResponse();
        const next = mockNext();

        requireAuth(req, res, next as any);

        expect(req.user).toEqual(sessionUser);
        expect((next as any).mock.calls.length).toBe(1);
      });
    });

    describe('authenticateJWT', () => {
      it('should return 401 if auth header and token cookie are missing', () => {
        const req = mockRequest({ headers: {}, cookies: {} });
        const res = mockResponse();
        const next = mockNext();

        authenticateJWT(req, res, next as any);

        expect((res.status as any).mock.calls[0][0]).toBe(401);
        expect((next as any).mock.calls.length).toBe(0);
      });

      it('should verify and decode valid token in Authorization header', (done) => {
        const req = mockRequest({ headers: { authorization: `Bearer ${validToken}` } });
        const res = mockResponse();
        const next = () => {
          expect(req.user).toBeDefined();
          expect(req.user!.id).toBe(payload.id);
          expect(req.tokenJti).toBe(payload.jti);
          done();
        };

        authenticateJWT(req, res, next as any);
      });

      it('should verify and decode valid token in cookies', (done) => {
        const req = mockRequest({ cookies: { token: validToken } });
        const res = mockResponse();
        const next = () => {
          expect(req.user).toBeDefined();
          expect(req.user!.id).toBe(payload.id);
          done();
        };

        authenticateJWT(req, res, next as any);
      });
    });

    describe('authenticateJWTCookie', () => {
      it('should return 401 if token cookie is missing', () => {
        const req = mockRequest({ cookies: {} });
        const res = mockResponse();
        const next = mockNext();

        authenticateJWTCookie(req, res, next as any);

        expect((res.status as any).mock.calls[0][0]).toBe(401);
      });

      it('should verify token cookie successfully', (done) => {
        const req = mockRequest({ cookies: { token: validToken } });
        const res = mockResponse();
        const next = () => {
          expect(req.user).toBeDefined();
          expect(req.user!.email).toBe(payload.email);
          done();
        };

        authenticateJWTCookie(req, res, next as any);
      });
    });
  });

  // ── cache.ts ───────────────────────────────────────────────────────────────
  describe('Cache Middleware', () => {
    beforeAll(async () => {
      if (!redisClient.isOpen) {
        await redisClient.connect();
      }
    });

    it('should pass to next middleware if Redis is not connected', async () => {
      // Mock redisClient.isOpen to false
      const originalIsOpen = redisClient.isOpen;
      Object.defineProperty(redisClient, 'isOpen', {
        value: false,
        writable: true,
        configurable: true
      });

      const middleware = cacheMiddleware(10);
      const req = mockRequest({ originalUrl: '/api/v1/test-cache-fail' });
      const res = mockResponse();
      const next = mockNext();

      await middleware(req, res, next as any);

      expect((next as any).mock.calls.length).toBe(1);
      
      // Restore originalIsOpen
      Object.defineProperty(redisClient, 'isOpen', {
        value: originalIsOpen,
        writable: true,
        configurable: true
      });
    });

    it('should set and get cache correctly from Redis', async () => {
      const cacheKey = '/api/v1/test-cache-hit';
      const responseBody = { data: 'some cached data value' };
      
      // Prime cache manually in Redis
      await redisClient.setEx(`cache:${cacheKey}`, 30, JSON.stringify(responseBody));

      const middleware = cacheMiddleware(30);
      const req = mockRequest({ originalUrl: cacheKey });
      const res = mockResponse();
      const next = mockNext();

      await middleware(req, res, next as any);

      expect((res.status as any).mock.calls[0][0]).toBe(200);
      expect((res.json as any).mock.calls[0][0]).toHaveProperty('fromCache', true);
      expect((next as any).mock.calls.length).toBe(0);

      // Clean up Redis key
      await redisClient.del(`cache:${cacheKey}`);
    });

    it('should invalidate cache key correctly on inValidateCacheMiddleware call', async () => {
      const cacheKey = '/api/v1/invalidate-me';
      await redisClient.set(`cache:${cacheKey}*`, 'dummy data');

      const req = mockRequest({ originalUrl: cacheKey });
      const res = mockResponse();
      const next = mockNext();

      await inValidateCacheMiddleware(req, res, next as any);

      expect((next as any).mock.calls.length).toBe(1);
      const data = await redisClient.get(`cache:${cacheKey}*`);
      expect(data).toBeNull();
    });
  });
});
