import app from "../app.js";
import request from "supertest";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/config.js";
import { prisma } from "../config/db.js";
import { redisClient } from "../config/redis.js";
import bcrypt from "bcryptjs";
import { ApplicationStatus } from "@prisma/client";

// ─────────────────────────────────────────────────────────
// Helper: mint JWTs without hitting the login endpoint
// ─────────────────────────────────────────────────────────
const generateToken = (role: "STUDENT" | "ADMIN", email: string, id: string) =>
  jwt.sign({ id, email, role }, JWT_SECRET!);

// ─────────────────────────────────────────────────────────
// Admin Dashboard & KPI Integration Tests
// ─────────────────────────────────────────────────────────
describe("Admin Dashboard & KPI Integration Tests", () => {
  let adminToken: string;
  let studentToken: string;

  let adminUserId: string;
  let studentUserId: string;
  let testUniversityId: string;
  let testApplicationId: string;

  // ─────────────────────────────────────────────────────
  // Seed: one admin, one student, one university, one application
  // ─────────────────────────────────────────────────────
  beforeAll(async () => {
    const hashedPassword = await bcrypt.hash("Test@1234", 10);

    const admin = await prisma.user.upsert({
      where: { email: "admin_kpi_test@fairpath.com" },
      update: {},
      create: {
        email: "admin_kpi_test@fairpath.com",
        firstName: "KPI",
        lastName: "Admin",
        passwordHash: hashedPassword,
        role: "ADMIN",
      },
    });
    adminUserId = admin.id;
    adminToken = generateToken("ADMIN", admin.email, admin.id);

    const student = await prisma.user.upsert({
      where: { email: "student_kpi_test@fairpath.com" },
      update: {},
      create: {
        email: "student_kpi_test@fairpath.com",
        firstName: "KPI",
        lastName: "Student",
        passwordHash: hashedPassword,
        role: "STUDENT",
      },
    });
    studentUserId = student.id;
    studentToken = generateToken("STUDENT", student.email, student.id);

    // Seed a university used across tests
    const uni = await prisma.university.upsert({
      where: { slug: "kpi-test-university" },
      update: {},
      create: {
        name: "KPI Test University",
        slug: "kpi-test-university",
        locationCity: "Test City",
        locationCountry: "Test Country",
        rankingGlobal: 100,
        rankingNational: 10,
        tuitionMin: 10000,
        tuitionMax: 20000,
        setting: "URBAN",
        type: "PUBLIC",
        acceptanceRate: 30.0,
        studentBodySize: 5000,
        description: "University for KPI tests.",
        featuredImage: "https://example.com/kpi-uni.jpg",
        departments: ["Computer Science"],
        isFeatured: false,
        isPartner: true,
      },
    });
    testUniversityId = uni.id;

    // Seed onboarding so getUserMatches/getAllUniversityScores has a profile to score against
    await prisma.userOnboarding.upsert({
      where: { userId: studentUserId },
      update: {
        intendedMajor: "Computer Science",
        annualBudget: 50000,
        destinations: ["Test Country"],
        englishScore: "7.5",
        isCompleted: true,
      },
      create: {
        userId: studentUserId,
        fullName: "KPI Student",
        dob: new Date("2000-06-01"),
        currentCountry: "Nigeria",
        nationality: "Nigerian",
        visaHistory: false,
        intendedMajor: "Computer Science",
        annualBudget: 50000,
        destinations: ["Test Country"],
        englishScore: "7.5",
        consent: true,
        isCompleted: true,
      },
    });

    // Seed an application so getApplications and getAnalytics have data
    const app_ = await prisma.application.create({
      data: {
        userId: studentUserId,
        universityId: testUniversityId,
        program: 'Computer Science',
        status: ApplicationStatus.SUBMITTED,
        deadline: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days from now
      },
    });
    testApplicationId = app_.id;
  });

  // ─────────────────────────────────────────────────────
  // Tear down all seeded data
  // ─────────────────────────────────────────────────────
  afterAll(async () => {
    await prisma.application
      .deleteMany({ where: { id: testApplicationId } })
      .catch(() => {});
    await prisma.universityMatchScore
      .deleteMany({ where: { userId: studentUserId } })
      .catch(() => {});
    await prisma.userOnboarding
      .deleteMany({ where: { userId: studentUserId } })
      .catch(() => {});
    await prisma.university
      .deleteMany({ where: { id: testUniversityId } })
      .catch(() => {});
    await prisma.user
      .deleteMany({
        where: { id: { in: [adminUserId, studentUserId].filter(Boolean) } },
      })
      .catch(() => {});

  });

  // ─────────────────────────────────────────────────────
  // GET /admin/analytics
  // ─────────────────────────────────────────────────────
  describe("GET /api/v1/admin/analytics", () => {
    it("should return 401 when no token is provided", async () => {
      await request(app).get("/api/v1/admin/analytics").expect(401);
    });

    it("should return 403 when a student token is used", async () => {
      await request(app)
        .get("/api/v1/admin/analytics")
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(403);
    });

    it("should return full analytics payload for admin", async () => {
      const response = await request(app)
        .get("/api/v1/admin/analytics")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      const { data } = response.body;
      expect(response.body.success).toBe(true);

      // Top-level shape
      expect(data).toHaveProperty("users");
      expect(data).toHaveProperty("universities");
      expect(data).toHaveProperty("scholarships");
      expect(data).toHaveProperty("applications");

      // applications sub-object must include the new KPI counters
      const apps = data.applications;
      expect(apps).toHaveProperty("data");
      expect(apps).toHaveProperty("total");
      expect(apps).toHaveProperty("byStatus");
      expect(apps).toHaveProperty("activeApplications");
      expect(apps).toHaveProperty("accepted");
      expect(apps).toHaveProperty("rejected");
      expect(apps).toHaveProperty("inReview");
      expect(apps).toHaveProperty("verified");
      expect(apps).toHaveProperty("flagged");
      expect(apps).toHaveProperty("matchSuccessRate");

      // matchSuccessRate must be a number 0–100
      expect(typeof apps.matchSuccessRate).toBe("number");
      expect(apps.matchSuccessRate).toBeGreaterThanOrEqual(0);
      expect(apps.matchSuccessRate).toBeLessThanOrEqual(100);
    });

    it("should include the seeded SUBMITTED application in analytics data", async () => {
      const response = await request(app)
        .get("/api/v1/admin/analytics")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      const appData: any[] = response.body.data.applications.data;
      const seeded = appData.find((a: any) => a.id === testApplicationId);
      expect(seeded).toBeDefined();
      expect(seeded.status).toBe(ApplicationStatus.SUBMITTED);
      expect(seeded).toHaveProperty("university");
      expect(seeded).toHaveProperty("user");
      // matchScore field is included (may be null if not yet computed)
      expect(Object.prototype.hasOwnProperty.call(seeded, "matchScore")).toBe(true);
    });

    it("should filter applications by status via query param", async () => {
      const response = await request(app)
        .get(`/api/v1/admin/analytics?status=${ApplicationStatus.SUBMITTED}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      const appData: any[] = response.body.data.applications.data;
      // Every returned application must match the requested status
      appData.forEach((a: any) => {
        expect(a.status).toBe(ApplicationStatus.SUBMITTED);
      });
    });
  });

  // ─────────────────────────────────────────────────────
  // GET /admin/kpi
  // ─────────────────────────────────────────────────────
  describe("GET /api/v1/admin/kpi", () => {
    it("should return 401 when no token is provided", async () => {
      await request(app)
        .get("/api/v1/admin/kpi?timeframe=month")
        .expect(401);
    });

    it("should return 403 when a student token is used", async () => {
      await request(app)
        .get("/api/v1/admin/kpi?timeframe=month")
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(403);
    });

    it("should return 400 when timeframe is missing", async () => {
      const response = await request(app)
        .get("/api/v1/admin/kpi")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/timeframe/i);
    });

    it("should return 400 when custom timeframe is missing startDate or endDate", async () => {
      const response = await request(app)
        .get("/api/v1/admin/kpi?timeframe=custom&startDate=2026-01-01")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/date/i);
    });

    const timeframes = ["today", "week", "month", "year"] as const;
    timeframes.forEach((timeframe) => {
      it(`should return a valid KPI payload for timeframe="${timeframe}"`, async () => {
        const response = await request(app)
          .get(`/api/v1/admin/kpi?timeframe=${timeframe}`)
          .set("Authorization", `Bearer ${adminToken}`)
          .expect(200);

        const { data } = response.body;
        expect(response.body.success).toBe(true);

        // Funnel fields
        expect(data).toHaveProperty("signedUpUsers");
        expect(data).toHaveProperty("profiledUsers");
        expect(data).toHaveProperty("draftSubmitted");
        expect(data).toHaveProperty("finalMatches");
        expect(typeof data.signedUpUsers).toBe("number");
        expect(typeof data.finalMatches).toBe("number");

        // Match quality
        expect(data).toHaveProperty("averageMatchScore");
        expect(typeof data.averageMatchScore).toBe("number");

        // Status breakdown
        expect(data).toHaveProperty("applicationStatusBreakdown");
        expect(Array.isArray(data.applicationStatusBreakdown)).toBe(true);

        // Trend
        expect(data).toHaveProperty("applicationTrend");
        expect(Array.isArray(data.applicationTrend)).toBe(true);
        data.applicationTrend.forEach((row: any) => {
          expect(row).toHaveProperty("month");
          expect(row).toHaveProperty("submitted");
          expect(row).toHaveProperty("accepted");
          expect(typeof row.submitted).toBe("number");
          expect(typeof row.accepted).toBe("number");
        });

        // Country breakdown
        expect(data).toHaveProperty("applicationsByCountry");
        expect(Array.isArray(data.applicationsByCountry)).toBe(true);
        data.applicationsByCountry.forEach((row: any) => {
          expect(row).toHaveProperty("locationCountry");
          expect(row).toHaveProperty("count");
          expect(typeof row.count).toBe("number");
        });

        // Institution performance
        expect(data).toHaveProperty("institutionPerformance");
        expect(Array.isArray(data.institutionPerformance)).toBe(true);
        data.institutionPerformance.forEach((row: any) => {
          expect(row).toHaveProperty("university");
          expect(row.university).toHaveProperty("name");
          expect(row.university).toHaveProperty("locationCountry");
          expect(row).toHaveProperty("status");
          expect(row).toHaveProperty("count");
          expect(row).toHaveProperty("admissionRate");
          expect(row.admissionRate).toBeGreaterThanOrEqual(0);
          expect(row.admissionRate).toBeLessThanOrEqual(100);
        });

        // Partnerships
        expect(data).toHaveProperty("partneredUniversities");
        expect(typeof data.partneredUniversities).toBe("number");
      });
    });

    it("should return a valid KPI payload for custom timeframe", async () => {
      const response = await request(app)
        .get("/api/v1/admin/kpi?timeframe=custom&startDate=2020-01-01&endDate=2099-12-31")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty("totalApplicants");
      expect(typeof response.body.data.totalApplicants).toBe("number");
    });

    it("should include the seeded application in the YEAR KPI data", async () => {
      const response = await request(app)
        .get("/api/v1/admin/kpi?timeframe=year")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      const { data } = response.body;
      // The seeded SUBMITTED application must bump totalApplicants ≥ 1
      expect(data.totalApplicants).toBeGreaterThanOrEqual(1);
      // draftSubmitted counts SUBMITTED status
      expect(data.draftSubmitted).toBeGreaterThanOrEqual(1);

      // applicationsByCountry must include "Test Country" (seeded university)
      const testCountry = data.applicationsByCountry.find(
        (c: any) => c.locationCountry === "Test Country"
      );
      expect(testCountry).toBeDefined();
      expect(testCountry.count).toBeGreaterThanOrEqual(1);
    });

    it("admissionRate in institutionPerformance should be 0–100 and consistent per university", async () => {
      const response = await request(app)
        .get("/api/v1/admin/kpi?timeframe=year")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      const perf: any[] = response.body.data.institutionPerformance;
      // Group by university id and assert admissionRate is the same for all rows of that university
      const byUni = new Map<string, number[]>();
      perf.forEach((row) => {
        const id = row.university.id;
        if (!byUni.has(id)) byUni.set(id, []);
        byUni.get(id)!.push(row.admissionRate);
      });
      byUni.forEach((rates) => {
        const unique = new Set(rates);
        expect(unique.size).toBe(1); // all rows for the same uni share the same rate
      });
    });
  });

  // ─────────────────────────────────────────────────────
  // GET /matches/all  (getAllUniversityScores)
  // ─────────────────────────────────────────────────────
  describe("GET /api/v1/matches/all", () => {
    it("should return 401 when no token is provided", async () => {
      await request(app).get("/api/v1/matches/all").expect(401);
    });

    it("should return all university scores for a profiled student", async () => {
      const response = await request(app)
        .get("/api/v1/matches/all")
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);

      const first = response.body.data[0];
      expect(first).toHaveProperty("matchScore");
      expect(first).toHaveProperty("reasons");
      expect(typeof first.matchScore).toBe("number");
      expect(first.matchScore).toBeGreaterThanOrEqual(0);
      expect(first.matchScore).toBeLessThanOrEqual(100);
    });

    it("should persist match scores to the database after /matches/all is called", async () => {
      // Call the endpoint first to trigger persistence
      await request(app)
        .get("/api/v1/matches/all")
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(200);

      // Verify at least one score was persisted for this student
      const persisted = await prisma.universityMatchScore.findMany({
        where: { userId: studentUserId },
      });
      expect(persisted.length).toBeGreaterThan(0);
      persisted.forEach((score) => {
        expect(score.matchScore).toBeGreaterThanOrEqual(0);
        expect(score.matchScore).toBeLessThanOrEqual(100);
      });
    });

    it("should upsert (not duplicate) scores on repeated calls", async () => {
      await request(app)
        .get("/api/v1/matches/all")
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(200);

      const countBefore = await prisma.universityMatchScore.count({
        where: { userId: studentUserId },
      });

      // Second call — score count must remain the same (upserted, not duplicated)
      await request(app)
        .get("/api/v1/matches/all")
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(200);

      const countAfter = await prisma.universityMatchScore.count({
        where: { userId: studentUserId },
      });

      expect(countAfter).toBe(countBefore);
    });
  });

  // ─────────────────────────────────────────────────────
  // GET /matches — ensure score persistence on getUserMatches too
  // ─────────────────────────────────────────────────────
  describe("GET /api/v1/matches (score persistence)", () => {
    it("should persist match scores for the top matches after /matches is called", async () => {
      await request(app)
        .get("/api/v1/matches")
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(200);

      const persisted = await prisma.universityMatchScore.findMany({
        where: { userId: studentUserId },
      });
      expect(persisted.length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────
  // Admin Notifications & Real-Time Presence Tests
  // ─────────────────────────────────────────────────────
  describe("Admin Notifications & Active Admins", () => {
    let testNotificationId: string;

    beforeAll(async () => {
      // Seed a test notification for the admin
      const notif = await prisma.notification.create({
        data: {
          userId: adminUserId,
          title: "Test Notification",
          content: "This is a test notification content",
          type: "INFO",
        },
      });
      testNotificationId = notif.id;
    });

    afterAll(async () => {
      // Clean up notifications
      await prisma.notification.deleteMany({
        where: { userId: adminUserId },
      });
    });

    it("should get active admins listing with status", async () => {
      const response = await request(app)
        .get("/api/v1/admin/active-admins")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      const activeAdmin = response.body.data.find((a: any) => a.id === adminUserId);
      expect(activeAdmin).toBeDefined();
      expect(activeAdmin.email).toBe("admin_kpi_test@fairpath.com");
      expect(activeAdmin.status).toBeDefined();
    });

    it("should get admin notifications list", async () => {
      const response = await request(app)
        .get("/api/v1/admin/notifications")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      const notif = response.body.data.find((n: any) => n.id === testNotificationId);
      expect(notif).toBeDefined();
      expect(notif.read).toBe(false);
    });

    it("should mark a notification as read", async () => {
      const response = await request(app)
        .put(`/api/v1/admin/notifications/${testNotificationId}/read`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.read).toBe(true);

      const check = await prisma.notification.findUnique({
        where: { id: testNotificationId },
      });
      expect(check?.read).toBe(true);
    });

    it("should mark all notifications as read", async () => {
      // Create another unread notification
      await prisma.notification.create({
        data: {
          userId: adminUserId,
          title: "Second Notification",
          content: "Another notification",
          type: "INFO",
        },
      });

      const response = await request(app)
        .put("/api/v1/admin/notifications/read-all")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      const remainingUnread = await prisma.notification.count({
        where: { userId: adminUserId, read: false },
      });
      expect(remainingUnread).toBe(0);
    });
  });
});
