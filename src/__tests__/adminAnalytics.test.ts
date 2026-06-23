import app from "../app.js";
import request from "supertest";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/config.js";
import { prisma, pool } from "../config/db.js";
import { redisClient } from "../config/redis.js";
import bcrypt from "bcryptjs";

const generateToken = (role: "STUDENT" | "ADMIN", email: string, id: string) =>
  jwt.sign({ id, email, role }, JWT_SECRET!);

describe("Admin Performance Analytics Endpoint Tests", () => {
  let adminToken: string;
  let studentToken: string;

  let adminUserId: string;
  let studentUserId: string;

  let uniId: string;
  let testAppId: string;

  beforeAll(async () => {
    const hashedPassword = await bcrypt.hash("Test@1234", 10);

    // Clean prior leftover test records
    await prisma.application.deleteMany({
      where: { applicant: { email: { in: ["an_admin_test@fairpath.com", "an_student_test@fairpath.com"] } } }
    }).catch(() => {});

    await prisma.university.deleteMany({
      where: { slug: "an-test-uni" }
    }).catch(() => {});

    // Create unique test users
    const admin = await prisma.user.upsert({
      where: { email: "an_admin_test@fairpath.com" },
      update: {},
      create: {
        email: "an_admin_test@fairpath.com",
        firstName: "Analytics Admin",
        lastName: "Manager",
        passwordHash: hashedPassword,
        role: "ADMIN",
        isVerified: true,
      },
    });
    adminUserId = admin.id;
    adminToken = generateToken("ADMIN", admin.email, admin.id);

    const student = await prisma.user.upsert({
      where: { email: "an_student_test@fairpath.com" },
      update: {},
      create: {
        email: "an_student_test@fairpath.com",
        firstName: "Analytics Student",
        lastName: "Applicant",
        passwordHash: hashedPassword,
        role: "STUDENT",
        isVerified: true,
      },
    });
    studentUserId = student.id;
    studentToken = generateToken("STUDENT", student.email, student.id);

    // Create a university to link applications to
    const uni = await prisma.university.create({
      data: {
        name: "Analytics Test University",
        slug: "an-test-uni",
        locationCity: "Toronto",
        locationCountry: "Canada",
        rankingGlobal: 50,
        tuitionMin: 30000,
        tuitionMax: 40000,
        setting: "URBAN",
        type: "PUBLIC",
        description: "Test",
      },
    });
    uniId = uni.id;

    // Create an accepted application to generate placement stats
    const appRecord = await prisma.application.create({
      data: {
        userId: studentUserId,
        universityId: uniId,
        program: "CS",
        deadline: new Date(),
        status: "ACCEPTED",
        documents: [],
      },
    });
    testAppId = appRecord.id;

    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
  }, 30000);

  afterAll(async () => {
    // Cleanup records
    await prisma.application.deleteMany({
      where: { userId: studentUserId },
    }).catch(() => {});

    await prisma.university.deleteMany({
      where: { id: uniId },
    }).catch(() => {});

    await prisma.user.deleteMany({
      where: { id: { in: [adminUserId, studentUserId] } },
    }).catch(() => {});

    await prisma.$disconnect();
    await pool.end();
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  }, 30000);

  it("should return performance analytics fields for admin", async () => {
    const response = await request(app)
      .get("/api/v1/admin/analytics")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body).toHaveProperty("success", true);
    expect(response.body.data).toHaveProperty("performance");
    
    const perf = response.body.data.performance;
    expect(perf).toHaveProperty("placements");
    expect(perf.placements).toHaveProperty("value");
    expect(perf.placements).toHaveProperty("trend");
    expect(perf.placements).toHaveProperty("footer");

    expect(perf).toHaveProperty("revenue");
    expect(perf.revenue).toHaveProperty("value");
    expect(perf.revenue).toHaveProperty("trend");
    expect(perf.revenue).toHaveProperty("footer");

    expect(perf).toHaveProperty("matchingAccuracy");
    expect(perf.matchingAccuracy).toHaveProperty("value");
    expect(perf.matchingAccuracy).toHaveProperty("trend");
    expect(perf.matchingAccuracy).toHaveProperty("footer");

    expect(perf).toHaveProperty("applicationTrends");
    expect(Array.isArray(perf.applicationTrends)).toBe(true);
    expect(perf.applicationTrends.length).toBe(6);

    expect(perf).toHaveProperty("topRegions");
    expect(perf.topRegions).toHaveProperty("totalAppsLabel");
    expect(Array.isArray(perf.topRegions.regions)).toBe(true);
    
    // Canada maps to North America
    const na = perf.topRegions.regions.find((r: any) => r.name === "North America");
    expect(na).toBeDefined();
    expect(na.percentage).toBeGreaterThan(0);
  });

  it("should reject student users with 403 on admin analytics list", async () => {
    await request(app)
      .get("/api/v1/admin/analytics")
      .set("Authorization", `Bearer ${studentToken}`)
      .expect(403);
  });

  it("should reject unauthenticated users with 401 on admin analytics list", async () => {
    await request(app)
      .get("/api/v1/admin/analytics")
      .expect(401);
  });
});
