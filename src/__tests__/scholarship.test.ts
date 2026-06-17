import app from "../app.js";
import request from "supertest";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/config.js";
import { prisma, pool } from "../config/db.js";
import { redisClient } from "../config/redis.js";
import bcrypt from "bcryptjs";

// Helper: generate JWT tokens for authentication testing
const generateToken = (role: "STUDENT" | "ADMIN", email: string, id: string) =>
  jwt.sign({ id, email, role }, JWT_SECRET!);

describe("Scholarships Integration Tests", () => {
  let studentToken: string;
  let adminToken: string;

  // DB entities created by this test suite
  let studentUserId: string;
  let adminUserId: string;

  let stemScholId: string;
  let meritScholId: string;
  let needScholId: string;

  let testUniId: string;

  beforeAll(async () => {
    const hashedPassword = await bcrypt.hash("TestPassword123", 10);

    // 1. Create student user
    const student = await prisma.user.upsert({
      where: { email: "scholar_test_student@fairpath.com" },
      update: {},
      create: {
        email: "scholar_test_student@fairpath.com",
        firstName: "Scholar",
        lastName: "Student",
        passwordHash: hashedPassword,
        role: "STUDENT",
      },
    });
    studentUserId = student.id;
    studentToken = generateToken("STUDENT", student.email, student.id);

    // 2. Create admin user
    const admin = await prisma.user.upsert({
      where: { email: "scholar_test_admin@fairpath.com" },
      update: {},
      create: {
        email: "scholar_test_admin@fairpath.com",
        firstName: "Scholar",
        lastName: "Admin",
        passwordHash: hashedPassword,
        role: "ADMIN",
      },
    });
    adminUserId = admin.id;
    adminToken = generateToken("ADMIN", admin.email, admin.id);

    // 3. Create a test university to match provider name
    const university = await prisma.university.upsert({
      where: { slug: "scholar-test-uni" },
      update: {},
      create: {
        name: "Scholar Test University",
        slug: "scholar-test-uni",
        locationCity: "New York",
        locationCountry: "United States",
        tuitionMin: 20000,
        tuitionMax: 40000,
        setting: "URBAN",
        type: "PRIVATE",
        description: "A testing university for scholarship mapping.",
        departments: ["Computer Science", "Engineering"],
      },
    });
    testUniId = university.id;

    // 4. Create dummy scholarships
    const stemSchol = await prisma.scholarship.create({
      data: {
        title: "Test STEM Pioneers Scholarship",
        provider: "Scholar Test University",
        amountType: "Fixed",
        amountValue: 20000,
        amountMaxValue: 20000,
        deadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        category: "STEM",
        eligibilityCriteria: "Requires minimum GPA of 3.6. Enrolled in Computer Science or Software Engineering.",
      },
    });
    stemScholId = stemSchol.id;

    const meritSchol = await prisma.scholarship.create({
      data: {
        title: "Test Academic Merit Excellence",
        provider: "Oxford Scholars Foundation",
        amountType: "Range",
        amountValue: 10000,
        amountMaxValue: 30000,
        deadline: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
        category: "Merit",
        eligibilityCriteria: "For high achievers. Must show a GPA >= 3.8.",
      },
    });
    meritScholId = meritSchol.id;

    const needSchol = await prisma.scholarship.create({
      data: {
        title: "Test Social Opportunity Grant",
        provider: "Global Relief Charity",
        amountType: "Full Tuition",
        amountValue: 50000,
        amountMaxValue: 50000,
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        category: "Need-based",
        eligibilityCriteria: "Financial need must be proven. GPA of 3.0 required.",
      },
    });
    needScholId = needSchol.id;
  });

  afterAll(async () => {
    // 1. Clean up user onboarding
    await prisma.userOnboarding.deleteMany({
      where: { userId: { in: [studentUserId, adminUserId] } },
    }).catch(() => {});

    // 2. Clean up scholarships
    await prisma.scholarship.deleteMany({
      where: { id: { in: [stemScholId, meritScholId, needScholId] } },
    }).catch(() => {});

    // 3. Clean up universities
    await prisma.university.deleteMany({
      where: { id: testUniId },
    }).catch(() => {});

    // 4. Clean up users
    await prisma.user.deleteMany({
      where: { id: { in: [studentUserId, adminUserId] } },
    }).catch(() => {});

    // Disconnect DB client and pool
    await prisma.$disconnect();
    await pool.end();

    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  });

  // ── GET /api/v1/scholarships ────────────────────────────────────────────────
  describe("GET /api/v1/scholarships", () => {
    it("should retrieve a paginated list of scholarships", async () => {
      const response = await request(app)
        .get("/api/v1/scholarships?page=1&limit=2")
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeLessThanOrEqual(2);
      expect(response.body).toHaveProperty("pagination");
      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.limit).toBe(2);
    });

    it("should filter scholarships by title (case-insensitive substring)", async () => {
      const response = await request(app)
        .get("/api/v1/scholarships?title=pioneers")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
      expect(response.body.data[0].title).toContain("STEM Pioneers");
    });

    it("should filter scholarships by category", async () => {
      const response = await request(app)
        .get("/api/v1/scholarships?category=STEM")
        .expect(200);

      expect(response.body.success).toBe(true);
      response.body.data.forEach((schol: any) => {
        expect(schol.category.toUpperCase()).toBe("STEM");
      });
    });

    it("should filter scholarships by minAmount and maxAmount", async () => {
      const response = await request(app)
        .get("/api/v1/scholarships?minAmount=15000&maxAmount=25000")
        .expect(200);

      expect(response.body.success).toBe(true);
      response.body.data.forEach((schol: any) => {
        if (schol.amountValue !== null) {
          expect(schol.amountValue).toBeGreaterThanOrEqual(15000);
          expect(schol.amountValue).toBeLessThanOrEqual(25000);
        }
      });
    });
  });

  // ── GET /api/v1/scholarships/recommended ────────────────────────────────────
  describe("GET /api/v1/scholarships/recommended", () => {
    it("should return 401 if authorization token is missing", async () => {
      await request(app)
        .get("/api/v1/scholarships/recommended")
        .expect(401);
    });

    it("should return 400 if user onboarding is not completed/found", async () => {
      const response = await request(app)
        .get("/api/v1/scholarships/recommended")
        .set("Authorization", `Bearer ${adminToken}`) // admin user has no onboarding
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("complete onboarding first");
    });

    it("should return matching results with scores based on onboarding data", async () => {
      // 1. Create a user onboarding record that matches stemSchol:
      // - intendedMajor: "Computer Science"
      // - GPA: "3.7" (meets STEM gpa 3.6, does not meet Merit gpa 3.8)
      // - destinations: ["United States"] (matches Scholar Test University in NY)
      // - financialAid: "No"
      await prisma.userOnboarding.upsert({
        where: { userId: studentUserId },
        update: {
          fullName: "Scholar Student",
          dob: new Date("2002-05-15"),
          currentCountry: "Canada",
          nationality: "Canadian",
          visaHistory: false,
          degreeLevel: "Undergraduate",
          intendedMajor: "Computer Science",
          gpa: "3.7",
          annualBudget: 25000,
          financialAid: "No",
          destinations: ["United States"],
          consent: true,
          isCompleted: true,
        },
        create: {
          userId: studentUserId,
          fullName: "Scholar Student",
          dob: new Date("2002-05-15"),
          currentCountry: "Canada",
          nationality: "Canadian",
          visaHistory: false,
          degreeLevel: "Undergraduate",
          intendedMajor: "Computer Science",
          gpa: "3.7",
          annualBudget: 25000,
          financialAid: "No",
          destinations: ["United States"],
          consent: true,
          isCompleted: true,
        },
      });

      const response = await request(app)
        .get("/api/v1/scholarships/recommended")
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);

      const firstRec = response.body.data[0];
      expect(firstRec).toHaveProperty("matchScore");
      expect(firstRec).toHaveProperty("reasons");
      expect(firstRec).toHaveProperty("warnings");

      // Verify sorting: highest score should be first
      const scores = response.body.data.map((r: any) => r.matchScore);
      const sortedScores = [...scores].sort((a, b) => b - a);
      expect(scores).toEqual(sortedScores);

      // Verify the STEM scholarship matches well for the student
      const stemMatch = response.body.data.find(
        (r: any) => r.scholarship.id === stemScholId
      );
      expect(stemMatch).toBeDefined();
      expect(stemMatch.matchScore).toBeGreaterThanOrEqual(60);
      expect(stemMatch.reasons.some((reason: string) => reason.includes("GPA"))).toBe(true);
    });
  });
});
