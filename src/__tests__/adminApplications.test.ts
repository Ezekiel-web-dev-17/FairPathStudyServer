import app from "../app.js";
import request from "supertest";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/config.js";
import { prisma } from "../config/db.js";
import { redisClient } from "../config/redis.js";
import bcrypt from "bcryptjs";

const generateToken = (role: "STUDENT" | "ADMIN", email: string, id: string) =>
  jwt.sign({ id, email, role }, JWT_SECRET!);

describe("Admin Applications Management Endpoint Tests", () => {
  let adminToken: string;
  let studentToken: string;

  let adminUserId: string;
  let studentUserId: string;

  let uniId1: string;
  let uniId2: string;
  let appId1: string;
  let appId2: string;

  beforeAll(async () => {
    const hashedPassword = await bcrypt.hash("Test@1234", 10);

    // Clean prior leftover test records
    await prisma.application.deleteMany({
      where: { applicant: { email: { in: ["app_admin_test@fairpath.com", "app_student_test@fairpath.com"] } } }
    }).catch(() => {});

    // Create unique test users
    const admin = await prisma.user.upsert({
      where: { email: "app_admin_test@fairpath.com" },
      update: {},
      create: {
        email: "app_admin_test@fairpath.com",
        firstName: "App Admin",
        lastName: "Manager",
        passwordHash: hashedPassword,
        role: "ADMIN",
        isVerified: true,
      },
    });
    adminUserId = admin.id;
    adminToken = generateToken("ADMIN", admin.email, admin.id);

    const student = await prisma.user.upsert({
      where: { email: "app_student_test@fairpath.com" },
      update: {},
      create: {
        email: "app_student_test@fairpath.com",
        firstName: "App Student",
        lastName: "Applicant",
        passwordHash: hashedPassword,
        role: "STUDENT",
        isVerified: true,
      },
    });
    studentUserId = student.id;
    studentToken = generateToken("STUDENT", student.email, student.id);

    // Create universities for application tests
    const uni1 = await prisma.university.create({
      data: {
        name: "Stanford University",
        slug: "stanford-test-admin-app",
        locationCity: "Stanford",
        locationCountry: "United States",
        rankingGlobal: 2,
        rankingNational: 2,
        tuitionMin: 50000,
        tuitionMax: 60000,
        setting: "SUBURBAN",
        type: "PRIVATE",
        acceptanceRate: 4.0,
        studentBodySize: 17000,
        description: "Stanford University",
        featuredImage: "https://example.com/stanford.jpg",
        departments: ["Computer Science"],
      },
    });
    uniId1 = uni1.id;

    const uni2 = await prisma.university.create({
      data: {
        name: "Oxford University",
        slug: "oxford-test-admin-app",
        locationCity: "Oxford",
        locationCountry: "United Kingdom",
        rankingGlobal: 3,
        rankingNational: 1,
        tuitionMin: 35000,
        tuitionMax: 45000,
        setting: "URBAN",
        type: "PUBLIC",
        acceptanceRate: 15.0,
        studentBodySize: 24000,
        description: "Oxford University",
        featuredImage: "https://example.com/oxford.jpg",
        departments: ["Business"],
      },
    });
    uniId2 = uni2.id;

    // Create application 1: Stanford, Under Review (IN_REVIEW)
    const app1 = await prisma.application.create({
      data: {
        userId: studentUserId,
        universityId: uniId1,
        program: "MSc Computer Science",
        deadline: new Date("2026-11-24T00:00:00.000Z"),
        status: "IN_REVIEW",
        documents: [],
      },
    });
    appId1 = app1.id;

    // Create application 2: Oxford, Pending (SUBMITTED)
    const app2 = await prisma.application.create({
      data: {
        userId: studentUserId,
        universityId: uniId2,
        program: "MBA Global Business",
        deadline: new Date("2026-12-15T00:00:00.000Z"),
        status: "SUBMITTED",
        documents: [],
      },
    });
    appId2 = app2.id;

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
      where: { id: { in: [uniId1, uniId2] } },
    }).catch(() => {});

    await prisma.user.deleteMany({
      where: { id: { in: [adminUserId, studentUserId] } },
    }).catch(() => {});

  }, 30000);

  it("should return paginated and formatted applications for admins", async () => {
    const response = await request(app)
      .get("/api/v1/admin/applications")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body).toHaveProperty("success", true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBeGreaterThanOrEqual(2);

    const first = response.body.data.find((a: any) => a.id === appId1);
    expect(first).toBeDefined();
    expect(first).toHaveProperty("appId");
    expect(first.appId).toMatch(/^APP-\d{4}-\d{3}$/);
    expect(first).toHaveProperty("studentName", "App Student Applicant");
    expect(first).toHaveProperty("program", "MSc Computer Science");
    expect(first).toHaveProperty("institution", "Stanford University");
    expect(first).toHaveProperty("region", "United States");
    expect(first).toHaveProperty("statusLabel", "Under Review");
  });

  it("should reject student users with 403", async () => {
    await request(app)
      .get("/api/v1/admin/applications")
      .set("Authorization", `Bearer ${studentToken}`)
      .expect(403);
  });

  it("should reject unauthenticated users with 401", async () => {
    await request(app)
      .get("/api/v1/admin/applications")
      .expect(401);
  });

  it("should support status filtering using UI display string format", async () => {
    const response = await request(app)
      .get("/api/v1/admin/applications?status=Under Review")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const matches = response.body.data.filter((a: any) => a.id === appId1 || a.id === appId2);
    expect(matches.length).toBe(1);
    expect(matches[0].id).toBe(appId1);
  });

  it("should support status filtering using DB enum format", async () => {
    const response = await request(app)
      .get("/api/v1/admin/applications?status=SUBMITTED")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const matches = response.body.data.filter((a: any) => a.id === appId1 || a.id === appId2);
    expect(matches.length).toBe(1);
    expect(matches[0].id).toBe(appId2);
  });

  it("should support region filtering", async () => {
    const response = await request(app)
      .get("/api/v1/admin/applications?region=United Kingdom")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const matches = response.body.data.filter((a: any) => a.id === appId1 || a.id === appId2);
    expect(matches.length).toBe(1);
    expect(matches[0].id).toBe(appId2);
  });

  it("should support institution filtering", async () => {
    const response = await request(app)
      .get("/api/v1/admin/applications?institution=Stanford")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const matches = response.body.data.filter((a: any) => a.id === appId1 || a.id === appId2);
    expect(matches.length).toBe(1);
    expect(matches[0].id).toBe(appId1);
  });
});
