import { 
  generateAccessToken, 
  generateRefreshToken, 
  verifyAccessToken, 
  verifyRefreshToken, 
  blacklistToken, 
  isTokenBlacklisted 
} from "../services/tokenService.js";
import { redisClient } from "../config/redis.js";
import crypto from "node:crypto";

describe("Token Service and Redis Blacklisting Unit Tests", () => {
  const payload = {
    id: "test-user-id",
    email: "tokenservice@test.com",
    role: "STUDENT" as const
  };

  beforeAll(async () => {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
  });

  afterAll(async () => {
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  });

  describe("Token Generation and Verification", () => {
    it("should generate a valid access token and successfully verify it", () => {
      const token = generateAccessToken(payload);
      expect(token).toBeDefined();

      const decoded = verifyAccessToken(token);
      expect(decoded.id).toBe(payload.id);
      expect(decoded.email).toBe(payload.email);
      expect(decoded.role).toBe(payload.role);
      expect(decoded.jti).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it("should generate a valid refresh token and successfully verify it", () => {
      const token = generateRefreshToken(payload);
      expect(token).toBeDefined();

      const decoded = verifyRefreshToken(token);
      expect(decoded.id).toBe(payload.id);
      expect(decoded.email).toBe(payload.email);
      expect(decoded.role).toBe(payload.role);
      expect(decoded.jti).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it("should throw an error when verifying a tampered access token", () => {
      const token = generateAccessToken(payload);
      const tamperedToken = token + "invalid";
      expect(() => verifyAccessToken(tamperedToken)).toThrow();
    });

    it("should throw an error when verifying a tampered refresh token", () => {
      const token = generateRefreshToken(payload);
      const tamperedToken = token + "invalid";
      expect(() => verifyRefreshToken(tamperedToken)).toThrow();
    });
  });

  describe("Redis Blacklisting", () => {
    it("should return false for non-blacklisted JTI", async () => {
      const randomJti = crypto.randomUUID();
      const isBlacklisted = await isTokenBlacklisted(randomJti);
      expect(isBlacklisted).toBe(false);
    });

    it("should successfully blacklist a JTI and identify it as blacklisted", async () => {
      const jti = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + 10; // Expires in 10 seconds

      await blacklistToken(jti, expiresAt);

      const isBlacklisted = await isTokenBlacklisted(jti);
      expect(isBlacklisted).toBe(true);

      // Verify that the Redis key actually exists and has a TTL
      const ttl = await redisClient.ttl(`bl:jti:${jti}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(10);

      // Clean up the test key from Redis
      await redisClient.del(`bl:jti:${jti}`);
    });

    it("should fail open and return false if Redis client is disconnected", async () => {
      const jti = crypto.randomUUID();
      
      // Temporarily mock redisClient.isOpen to false
      const originalIsOpen = redisClient.isOpen;
      Object.defineProperty(redisClient, 'isOpen', {
        value: false,
        writable: true,
        configurable: true
      });

      // Try blacklisting & checking status
      await blacklistToken(jti, Math.floor(Date.now() / 1000) + 10);
      const isBlacklisted = await isTokenBlacklisted(jti);
      expect(isBlacklisted).toBe(false);

      // Restore redisClient.isOpen status
      Object.defineProperty(redisClient, 'isOpen', {
        value: originalIsOpen,
        writable: true,
        configurable: true
      });
    });
  });
});
