import app from "../app.js";
import request from "supertest";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/config.js";
import { prisma, pool } from "../config/db.js";
import { redisClient } from "../config/redis.js";

describe("User Auth Verification Flow Tests", () => {
  const testEmail = "verify_test@fairpath.com";
  const testPassword = "securePassword123!";
  const testFullName = "Test Verification User";

  beforeAll(async () => {
    // Delete test user if leftover from aborted test runs
    await prisma.user.deleteMany({
      where: { email: testEmail },
    }).catch(() => {});
  });

  afterAll(async () => {
    // Cleanup test user
    await prisma.user.deleteMany({
      where: { email: testEmail },
    }).catch(() => {});

    // Disconnect pools and Redis to allow Jest to exit cleanly
    await prisma.$disconnect();
    await pool.end();
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  });

  describe("Complete Verification Flow", () => {
    let verificationCode: string | null = null;

    it("should register a user in unverified state and generate a token", async () => {
      const response = await request(app)
        .post("/api/v1/auth/register")
        .send({
          fullName: testFullName,
          email: testEmail,
          password: testPassword,
          role: "STUDENT",
        })
        .expect(201);

      expect(response.body).toHaveProperty("status", "success");
      expect(response.body.message).toContain("Please check your email");

      // Verify user in database
      const user = await prisma.user.findUnique({
        where: { email: testEmail },
      });

      expect(user).not.toBeNull();
      expect(user!.isVerified).toBe(false);
      expect(user!.verificationCode).not.toBeNull();
      expect(user!.verificationCodeExpires).not.toBeNull();

      verificationCode = user!.verificationCode;
    });

    it("should prevent login when user is unverified", async () => {
      const response = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: testEmail,
          password: testPassword,
        })
        .expect(401);

      expect(response.body).toHaveProperty("status", "error");
      expect(response.body.message).toContain("Please verify your email");
    });

    it("should reject verification with invalid verification code", async () => {
      const response = await request(app)
        .get("/api/v1/auth/verify-email?code=invalid_code")
        .expect(400);

      expect(response.body).toHaveProperty("status", "error");
      expect(response.body.message).toContain("Invalid or expired verification code");
    });

    it("should successfully verify the user with valid verification code and redirect", async () => {
      const response = await request(app)
        .get(`/api/v1/auth/verify-email?code=${verificationCode}`)
        .expect(302); // Redirect code

      expect(response.headers.location).toBe("http://localhost:5173/login?verified=true");

      // Verify state in database
      const user = await prisma.user.findUnique({
        where: { email: testEmail },
      });

      expect(user!.isVerified).toBe(true);
      expect(user!.verificationCode).toBeNull();
      expect(user!.verificationCodeExpires).toBeNull();
    });

    it("should successfully allow login after email verification", async () => {
      const response = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: testEmail,
          password: testPassword,
        })
        .expect(200);

      expect(response.body).toHaveProperty("status", "success");
      expect(response.body.message).toContain("Login successful");
      expect(response.headers["set-cookie"]).toBeDefined();
    });

    it("should reject unsubscribe request with missing or invalid token", async () => {
      const response = await request(app)
        .get("/api/v1/auth/unsubscribe?token=invalid_unsub_token")
        .expect(400);

      expect(response.body).toHaveProperty("status", "error");
      expect(response.body.message).toContain("Unsubscribe token is invalid or expired");
    });

    it("should successfully opt-out the user from marketing emails with a valid unsubscribe token", async () => {
      const unsubscribeToken = jwt.sign({ email: testEmail }, JWT_SECRET!);

      const response = await request(app)
        .get(`/api/v1/auth/unsubscribe?token=${unsubscribeToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("status", "success");
      expect(response.body.message).toContain("successfully unsubscribed");

      // Verify the state has changed in the database
      const user = await prisma.user.findUnique({
        where: { email: testEmail }
      });
      expect(user).not.toBeNull();
      expect(user!.marketingOptIn).toBe(false); // Successfully opted out!
    });

    it("should successfully log out the user and clear cookie parameters", async () => {
      const response = await request(app)
        .post("/api/v1/auth/logout")
        .expect(200);

      expect(response.body).toHaveProperty("status", "success");
      expect(response.body.message).toContain("Logout successful");

      const setCookieHeader = response.headers["set-cookie"];
      expect(setCookieHeader).toBeDefined();
      expect(setCookieHeader[0]).toContain("token=;");
    });
  });
});
