import app from "../app.js";
import request from "supertest";
import bcrypt from "bcryptjs";
import { prisma } from "../config/db.js";
import { redisClient } from "../config/redis.js";
import { encryptResetToken } from "../utils/crypto.js";

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
  }, 30000);

  describe("Forgot Password Flow", () => {
    it("should return a generic successful response regardless of whether the email exists", async () => {
      // 1. Non-existent email
      const responseNonExistent = await request(app)
        .post("/api/v1/auth/forgot-password")
        .send({ email: "non_existent_email@fairpath.com" })
        .expect(200);

      expect(responseNonExistent.body).toHaveProperty("success", true);
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

      expect(responseUnverified.body).toHaveProperty("success", true);
      expect(responseUnverified.body.message).toContain("If that email exists in our system");
    });

    it("should reject forgot-password with malformed email formatting", async () => {
      const response = await request(app)
        .post("/api/v1/auth/forgot-password")
        .send({ email: "bademailformat" })
        .expect(400);

      expect(response.body).toHaveProperty("success", false);
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

      // Generate a valid encrypted token (expires in 15 mins)
      const token = encryptResetToken({
        id: user!.id,
        email: user!.email,
        passwordHash: user!.passwordHash,
        expiresAt: Math.floor(Date.now() / 1000) + 900
      });

      const newPassword = "newerSecurePassword123!";

      const response = await request(app)
        .post("/api/v1/auth/reset-password")
        .send({ token, newPassword })
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.message).toContain("Password has been reset successfully");

      // Verify we can now log in with the new password
      const loginResponse = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: testEmail, password: newPassword })
        .expect(200);

      expect(loginResponse.body).toHaveProperty("success", true);
    });

    it("should enforce the single-use token guarantee (token reuse fails after password has changed)", async () => {
      const user = await prisma.user.findUnique({
        where: { email: testEmail },
      });
      expect(user).not.toBeNull();

      // Generate encrypted token using the current hash
      const token = encryptResetToken({
        id: user!.id,
        email: user!.email,
        passwordHash: user!.passwordHash,
        expiresAt: Math.floor(Date.now() / 1000) + 900
      });

      // First reset (should succeed)
      const firstReset = await request(app)
        .post("/api/v1/auth/reset-password")
        .send({ token, newPassword: "anotherSuperSecurePassword987!" })
        .expect(200);
      expect(firstReset.body.success).toBe(true);

      // Second reset using the same token (must fail because passwordHash has changed)
      const secondReset = await request(app)
        .post("/api/v1/auth/reset-password")
        .send({ token, newPassword: "yetAnotherPassword12345!" })
        .expect(400);

      expect(secondReset.body).toHaveProperty("success", false);
      expect(secondReset.body.message).toContain("Password reset link is invalid");
    });

    it("should reject reset password if new password is too short", async () => {
      const user = await prisma.user.findUnique({
        where: { email: testEmail },
      });
      const token = encryptResetToken({
        id: user!.id,
        email: user!.email,
        passwordHash: user!.passwordHash,
        expiresAt: Math.floor(Date.now() / 1000) + 900
      });

      const response = await request(app)
        .post("/api/v1/auth/reset-password")
        .send({ token, newPassword: "short" })
        .expect(400);

      expect(response.body).toHaveProperty("success", false);
      expect(response.body.message).toContain("at least 8 characters");
    });

    it("should reject password reset with an expired token", async () => {
      const user = await prisma.user.findUnique({
        where: { email: testEmail },
      });
      
      // Simulate an expired token: expiresAt is 10 seconds in the past
      const token = encryptResetToken({
        id: user!.id,
        email: user!.email,
        passwordHash: user!.passwordHash,
        expiresAt: Math.floor(Date.now() / 1000) - 10
      });

      const response = await request(app)
        .post("/api/v1/auth/reset-password")
        .send({ token, newPassword: "validNewPassword123!" })
        .expect(400);

      expect(response.body).toHaveProperty("success", false);
      expect(response.body.message).toContain("invalid or has expired");
    });
  });
});
