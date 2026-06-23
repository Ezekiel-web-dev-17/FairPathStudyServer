import app from "../app.js";
import request from "supertest";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/config.js";
import { prisma, pool } from "../config/db.js";
import { redisClient } from "../config/redis.js";
import bcrypt from "bcryptjs";

const generateToken = (role: "STUDENT" | "ADMIN", email: string, id: string) =>
  jwt.sign({ id, email, role }, JWT_SECRET!);

describe("Admin Universities Management Endpoint Tests", () => {
  let adminToken: string;
  let studentToken: string;

  let adminUserId: string;
  let studentUserId: string;

  let uniIdActive1: string;
  let uniIdActive2: string;
  let uniIdPending: string;

  let testAppId: string;

  beforeAll(async () => {
    const hashedPassword = await bcrypt.hash("Test@1234", 10);

    // Clean prior leftover test records
    await prisma.application.deleteMany({
      where: { applicant: { email: { in: ["uni_admin_test@fairpath.com", "uni_student_test@fairpath.com"] } } }
    }).catch(() => {});

    await prisma.university.deleteMany({
      where: { slug: { in: ["edinburgh-test-admin-uni", "toronto-test-admin-uni", "melbourne-test-admin-uni"] } }
    }).catch(() => {});

    // Create unique test users
    const admin = await prisma.user.upsert({
      where: { email: "uni_admin_test@fairpath.com" },
      update: {},
      create: {
        email: "uni_admin_test@fairpath.com",
        firstName: "Uni Admin",
        lastName: "Manager",
        passwordHash: hashedPassword,
        role: "ADMIN",
        isVerified: true,
      },
    });
    adminUserId = admin.id;
    adminToken = generateToken("ADMIN", admin.email, admin.id);

    const student = await prisma.user.upsert({
      where: { email: "uni_student_test@fairpath.com" },
      update: {},
      create: {
        email: "uni_student_test@fairpath.com",
        firstName: "Uni Student",
        lastName: "Applicant",
        passwordHash: hashedPassword,
        role: "STUDENT",
        isVerified: true,
      },
    });
    studentUserId = student.id;
    studentToken = generateToken("STUDENT", student.email, student.id);

    // Create test universities
    const uniActive1 = await prisma.university.create({
      data: {
        name: "University of Edinburgh",
        slug: "edinburgh-test-admin-uni",
        locationCity: "Edinburgh",
        locationCountry: "United Kingdom",
        rankingGlobal: 22,
        rankingNational: 5,
        tuitionMin: 20000,
        tuitionMax: 30000,
        setting: "URBAN",
        type: "PUBLIC",
        acceptanceRate: 10.0,
        studentBodySize: 35000,
        description: "Edinburgh",
        featuredImage: "https://example.com/edinburgh.jpg",
        departments: ["Informatics"],
        isPartner: true,
      },
    });
    uniIdActive1 = uniActive1.id;

    const uniActive2 = await prisma.university.create({
      data: {
        name: "University of Toronto",
        slug: "toronto-test-admin-uni",
        locationCity: "Toronto",
        locationCountry: "Canada",
        rankingGlobal: 21,
        rankingNational: 1,
        tuitionMin: 35000,
        tuitionMax: 45000,
        setting: "URBAN",
        type: "PUBLIC",
        acceptanceRate: 40.0,
        studentBodySize: 60000,
        description: "Toronto",
        featuredImage: "https://example.com/toronto.jpg",
        departments: ["Science"],
        isPartner: true,
      },
    });
    uniIdActive2 = uniActive2.id;

    const uniPending = await prisma.university.create({
      data: {
        name: "University of Melbourne",
        slug: "melbourne-test-admin-uni",
        locationCity: "Melbourne",
        locationCountry: "Australia",
        rankingGlobal: 14,
        rankingNational: 1,
        tuitionMin: 30000,
        tuitionMax: 40000,
        setting: "URBAN",
        type: "PUBLIC",
        acceptanceRate: 12.0,
        studentBodySize: 50000,
        description: "Melbourne",
        featuredImage: "https://example.com/melbourne.jpg",
        departments: ["Medicine"],
        isPartner: false, // Pending
      },
    });
    uniIdPending = uniPending.id;

    // Create an application to Edinburgh so it has volume and match rate
    const appRecord = await prisma.application.create({
      data: {
        userId: studentUserId,
        universityId: uniIdActive1,
        program: "Informatics",
        deadline: new Date("2026-11-24T00:00:00.000Z"),
        status: "ACCEPTED", // Match rate will be 100% since 1 accepted application
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
      where: { id: { in: [uniIdActive1, uniIdActive2, uniIdPending] } },
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

  it("should return detailed formatted universities card layout matching screenshot for admins", async () => {
    const response = await request(app)
      .get("/api/v1/admin/universities")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body).toHaveProperty("success", true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body).toHaveProperty("counts");
    expect(response.body.counts).toHaveProperty("all");
    expect(response.body.counts).toHaveProperty("active");
    expect(response.body.counts).toHaveProperty("pending");

    // Check Edinburgh card details
    const edin = response.body.data.find((u: any) => u.id === uniIdActive1);
    expect(edin).toBeDefined();
    expect(edin).toHaveProperty("location", "Edinburgh, UK"); // Country abbreviation mapped
    expect(edin).toHaveProperty("rank", "#22");
    expect(edin).toHaveProperty("status", "Active Partnership");
    expect(edin).toHaveProperty("applicationVolume", "1");
    expect(edin).toHaveProperty("matchRate", "100%");
    expect(edin).toHaveProperty("actionLabel", "View Details");
    expect(edin).toHaveProperty("substatus", null);

    // Check Melbourne card details
    const melb = response.body.data.find((u: any) => u.id === uniIdPending);
    expect(melb).toBeDefined();
    expect(melb).toHaveProperty("location", "Melbourne, AU"); // Country abbreviation mapped
    expect(melb).toHaveProperty("rank", "#14");
    expect(melb).toHaveProperty("status", "Contract Pending");
    expect(melb).toHaveProperty("applicationVolume", "--"); // No applications
    expect(melb).toHaveProperty("matchRate", "--");
    expect(melb).toHaveProperty("actionLabel", "Review");
    expect(melb).toHaveProperty("substatus", "Awaiting Signatures");
  });

  it("should reject student users with 403 on admin universities list", async () => {
    await request(app)
      .get("/api/v1/admin/universities")
      .set("Authorization", `Bearer ${studentToken}`)
      .expect(403);
  });

  it("should reject unauthenticated users with 401 on admin universities list", async () => {
    await request(app)
      .get("/api/v1/admin/universities")
      .expect(401);
  });

  it("should support status tab filtering for active partnerships", async () => {
    const response = await request(app)
      .get("/api/v1/admin/universities?status=active")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const matchIds = response.body.data.map((u: any) => u.id);
    expect(matchIds).toContain(uniIdActive1);
    expect(matchIds).toContain(uniIdActive2);
    expect(matchIds).not.toContain(uniIdPending);
  });

  it("should support status tab filtering for pending contracts", async () => {
    const response = await request(app)
      .get("/api/v1/admin/universities?status=pending")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const matchIds = response.body.data.map((u: any) => u.id);
    expect(matchIds).not.toContain(uniIdActive1);
    expect(matchIds).not.toContain(uniIdActive2);
    expect(matchIds).toContain(uniIdPending);
  });

  it("should support searching for universities by city or name", async () => {
    const response = await request(app)
      .get("/api/v1/admin/universities?search=Toronto")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const matchIds = response.body.data.map((u: any) => u.id);
    expect(matchIds).toContain(uniIdActive2);
    expect(matchIds).not.toContain(uniIdActive1);
    expect(matchIds).not.toContain(uniIdPending);
  });
});
