import app from "../app.js";
import request from "supertest";
import bcrypt from "bcryptjs";
import { prisma } from "../config/db.js";
import { redisClient } from "../config/redis.js";

describe("Refresh Token Rotation and Access Token Blacklisting Tests", () => {
  const testEmail = "refresh_test@fairpath.com";
  const testPassword = "securePassword123!";
  let testUser: any;

  beforeAll(async () => {
    // Clean up
    await prisma.user.deleteMany({
      where: { email: testEmail },
    }).catch(() => {});

    // Create verified user
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(testPassword, salt);
    testUser = await prisma.user.create({
      data: {
        email: testEmail,
        passwordHash,
        firstName: "Refresh",
        lastName: "User",
        isVerified: true,
        role: "STUDENT",
      },
    });

    // Make sure redis client is connected in test environment
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
  }, 30000);

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: testEmail },
    }).catch(() => {});

  }, 30000);

  describe("Refresh Token Rotation", () => {
    it("should successfully login and return access and refresh token cookies", async () => {
      const response = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: testEmail, password: testPassword })
        .expect(200);

      const cookies = response.headers["set-cookie"] as any;
      expect(cookies).toBeDefined();
      
      const hasToken = cookies.some((c: string) => c.startsWith("token="));
      const hasRefreshToken = cookies.some((c: string) => c.startsWith("refreshToken="));
      
      expect(hasToken).toBe(true);
      expect(hasRefreshToken).toBe(true);
    });

    it("should refresh tokens using a valid refresh token", async () => {
      // Login first to get cookies
      const loginRes = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: testEmail, password: testPassword })
        .expect(200);

      const cookies = loginRes.headers["set-cookie"] as any;
      const refreshCookie = cookies.find((c: string) => c.startsWith("refreshToken="));
      
      // Perform refresh
      const refreshRes = await request(app)
        .post("/api/v1/auth/refresh-token")
        .set("Cookie", [refreshCookie])
        .expect(200);

      expect(refreshRes.body).toHaveProperty("status", "success");
      
      const newCookies = refreshRes.headers["set-cookie"] as any;
      expect(newCookies).toBeDefined();
      expect(newCookies.some((c: string) => c.startsWith("token="))).toBe(true);
      expect(newCookies.some((c: string) => c.startsWith("refreshToken="))).toBe(true);
    });

    it("should fail to refresh with a blacklisted or replayed refresh token (rotation check)", async () => {
      // Login to get a fresh refresh token
      const loginRes = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: testEmail, password: testPassword })
        .expect(200);

      const cookies = loginRes.headers["set-cookie"] as any;
      const refreshCookie = cookies.find((c: string) => c.startsWith("refreshToken="));

      // First refresh should succeed
      const refreshRes1 = await request(app)
        .post("/api/v1/auth/refresh-token")
        .set("Cookie", [refreshCookie])
        .expect(200);
      expect(refreshRes1.body.status).toBe("success");

      // Second refresh using the SAME refresh token should fail (rotated/blacklisted)
      const refreshRes2 = await request(app)
        .post("/api/v1/auth/refresh-token")
        .set("Cookie", [refreshCookie])
        .expect(403);

      expect(refreshRes2.body).toHaveProperty("status", "error");
      expect(refreshRes2.body.message).toContain("blacklisted");
    });
  });

  describe("Access Token Blacklisting", () => {
    it("should blacklist the access token on logout and reject subsequent calls", async () => {
      // 1. Login to get cookies
      const loginRes = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: testEmail, password: testPassword })
        .expect(200);

      const cookies = loginRes.headers["set-cookie"] as any;
      const accessCookie = cookies.find((c: string) => c.startsWith("token="));
      const refreshCookie = cookies.find((c: string) => c.startsWith("refreshToken="));

      // 2. Access /users/me (should succeed)
      const meBeforeLogout = await request(app)
        .get("/api/v1/users/me")
        .set("Cookie", [accessCookie])
        .expect(200);
      expect(meBeforeLogout.body.status).toBe("success");

      // 3. Logout (should blacklist the access token)
      await request(app)
        .post("/api/v1/auth/logout")
        .set("Cookie", [accessCookie, refreshCookie])
        .expect(200);

      // 4. Access /users/me again with the blacklisted token (should fail)
      const meAfterLogout = await request(app)
        .get("/api/v1/users/me")
        .set("Cookie", [accessCookie])
        .expect(403);
      expect(meAfterLogout.body.error).toContain("Forbidden");
    });
  });
});
