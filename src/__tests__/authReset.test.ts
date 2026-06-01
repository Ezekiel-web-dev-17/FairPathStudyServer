import app from "../app.js";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { JWT_SECRET } from "../config/config.js";
import { prisma, pool } from "../config/db.js";
import { redisClient } from "../config/redis.js";

describe("User Password Recovery and Reset Flow Tests", () => {
  const testEmail = "reset_test@fairpath.com";
  const testPassword = "securePassword123!";

  beforeAll(async () => {
    // Clean up any remnants from prior runs
    await prisma.user.deleteMany({
      where: { email: testEmail },
    }).catch(() => {});
  }, 30000);

  afterAll(async () => {
    // Final clean up
    await prisma.user.deleteMany({
      where: { email: testEmail },
    }).catch(() => {});

    // Disconnect pools and Redis to allow Jest to exit cleanly
    await prisma.$disconnect();
    await pool.end();
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  }, 30000);

  describe("Forgot Password Flow", () => {
    it("should return a generic successful response regardless of whether the email exists", async () => {
      // 1. Non-existent email
      const responseNonExistent = await request(app)
        .post("/api/v1/auth/forgot-password")
        .send({ email: "non_existent_email@fairpath.com" })
        .expect(200);

      expect(responseNonExistent.body).toHaveProperty("status", "success");
      expect(responseNonExistent.body.message).toContain("If that email exists in our system");

      // 2. Real email (unverified) — should still return the same generic response
      const salt = await bcrypt.genSalt(12);
      const passwordHash = await bcrypt.hash(testPassword, salt);
      await prisma.user.create({
        data: {
          email: testEmail,
          passwordHash,
          firstName: "Reset",
          lastName: "User",
          isVerified: false,
          role: "STUDENT",
        },
      });

      const responseUnverified = await request(app)
        .post("/api/v1/auth/forgot-password")
        .send({ email: testEmail })
        .expect(200);

      expect(responseUnverified.body).toHaveProperty("status", "success");
      expect(responseUnverified.body.message).toContain("If that email exists in our system");
    });

    it("should reject forgot-password with malformed email formatting", async () => {
      const response = await request(app)
        .post("/api/v1/auth/forgot-password")
        .send({ email: "bademailformat" })
        .expect(400);

      expect(response.body).toHaveProperty("status", "error");
      expect(response.body.message).toContain("Invalid email address format");
    });
  });

  describe("Reset Password Flow", () => {
    beforeAll(async () => {
      // Upsert a verified user so this describe block is self-sufficient
      // even if the "Forgot Password Flow" describe did not run first.
      const salt = await bcrypt.genSalt(12);
      const passwordHash = await bcrypt.hash(testPassword, salt);

      await prisma.user.upsert({
        where: { email: testEmail },
        update: { isVerified: true, passwordHash },
        create: {
          email: testEmail,
          passwordHash,
          firstName: "Reset",
          lastName: "User",
          isVerified: true,
          role: "STUDENT",
        },
      });
    }, 30000);

    it("should successfully reset password with a valid token", async () => {
      const user = await prisma.user.findUnique({
        where: { email: testEmail },
      });
      expect(user).not.toBeNull();

      // Generate a valid stateless hybrid token (expires in 15 mins)
      const secret = JWT_SECRET! + user!.passwordHash;
      const token = jwt.sign({ id: user!.id, email: user!.email }, secret, { expiresIn: "15m" });

      const newPassword = "newerSecurePassword123!";

      const response = await request(app)
        .post("/api/v1/auth/reset-password")
        .send({ token, newPassword })
        .expect(200);

      expect(response.body).toHaveProperty("status", "success");
      expect(response.body.message).toContain("Password has been reset successfully");

      // Verify we can now log in with the new password
      const loginResponse = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: testEmail, password: newPassword })
        .expect(200);

      expect(loginResponse.body).toHaveProperty("status", "success");
    });

    it("should enforce the single-use token guarantee (token reuse fails after password has changed)", async () => {
      const user = await prisma.user.findUnique({
        where: { email: testEmail },
      });
      expect(user).not.toBeNull();

      // Generate token using the current hash
      const secret = JWT_SECRET! + user!.passwordHash;
      const token = jwt.sign({ id: user!.id, email: user!.email }, secret, { expiresIn: "15m" });

      // First reset (should succeed)
      const firstReset = await request(app)
        .post("/api/v1/auth/reset-password")
        .send({ token, newPassword: "anotherSuperSecurePassword987!" })
        .expect(200);
      expect(firstReset.body.status).toBe("success");

      // Second reset using the same token (must fail because passwordHash has changed)
      const secondReset = await request(app)
        .post("/api/v1/auth/reset-password")
        .send({ token, newPassword: "yetAnotherPassword12345!" })
        .expect(400);

      expect(secondReset.body).toHaveProperty("status", "error");
      expect(secondReset.body.message).toContain("Password reset link is invalid or has expired");
    });

    it("should reject reset password if new password is too short", async () => {
      const user = await prisma.user.findUnique({
        where: { email: testEmail },
      });
      const secret = JWT_SECRET! + user!.passwordHash;
      const token = jwt.sign({ id: user!.id, email: user!.email }, secret, { expiresIn: "15m" });

      const response = await request(app)
        .post("/api/v1/auth/reset-password")
        .send({ token, newPassword: "short" })
        .expect(400);

      expect(response.body).toHaveProperty("status", "error");
      expect(response.body.message).toContain("at least 8 characters");
    });

    it("should reject password reset with an expired token", async () => {
      const user = await prisma.user.findUnique({
        where: { email: testEmail },
      });
      
      const secret = JWT_SECRET! + user!.passwordHash;
      // Simulate an expired token: iat 20 minutes in the past, expiresIn 15m → already expired
      const token = jwt.sign(
        { id: user!.id, email: user!.email, iat: Math.floor(Date.now() / 1000) - 1200 }, 
        secret, 
        { expiresIn: "15m" }
      );

      const response = await request(app)
        .post("/api/v1/auth/reset-password")
        .send({ token, newPassword: "validNewPassword123!" })
        .expect(400);

      expect(response.body).toHaveProperty("status", "error");
      expect(response.body.message).toContain("invalid or has expired");
    });
  });
});
