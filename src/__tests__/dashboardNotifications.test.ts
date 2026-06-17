import app from "../app.js";
import request from "supertest";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/config.js";
import { prisma, pool } from "../config/db.js";
import { redisClient } from "../config/redis.js";
import bcrypt from "bcryptjs";

const generateToken = (role: "STUDENT" | "ADMIN", email: string, id: string) =>
  jwt.sign({ id, email, role }, JWT_SECRET!);

describe("Dashboard and Notification Center Integration Tests", () => {
  let adminToken: string;
  let studentToken: string;
  let otherStudentToken: string;

  let adminUserId: string;
  let studentUserId: string;
  let otherStudentUserId: string;

  let testUniId: string;
  let testFavId: string;
  let testAppId: string;
  let testNotificationId: string;

  beforeAll(async () => {
    const hashedPassword = await bcrypt.hash("Test@1234", 10);

    // Clean any prior leftover test records
    await prisma.savedMatch.deleteMany({
      where: { user: { email: { in: ["dash_student@fairpath.com", "dash_other@fairpath.com"] } } }
    }).catch(() => {});

    await prisma.application.deleteMany({
      where: { user: { email: { in: ["dash_student@fairpath.com", "dash_other@fairpath.com"] } } }
    }).catch(() => {});

    await (prisma as any).notification.deleteMany({
      where: { type: { in: ["USER_REGISTERED", "USER_ONBOARDING_COMPLETED", "APPLICATION_SUBMITTED", "APPLICATION_STATUS_CHANGED", "UNIVERSITY_CREATED", "UNIVERSITY_UPDATED", "UNIVERSITY_DELETED", "CACHE_CLEARED"] } }
    }).catch(() => {});

    // Create unique test users
    const admin = await prisma.user.upsert({
      where: { email: "dash_admin@fairpath.com" },
      update: {},
      create: {
        email: "dash_admin@fairpath.com",
        firstName: "Dashboard Test",
        lastName: "Admin",
        passwordHash: hashedPassword,
        role: "ADMIN",
        isVerified: true,
      },
    });
    adminUserId = admin.id;
    adminToken = generateToken("ADMIN", admin.email, admin.id);

    const student = await prisma.user.upsert({
      where: { email: "dash_student@fairpath.com" },
      update: {},
      create: {
        email: "dash_student@fairpath.com",
        firstName: "Dashboard Test",
        lastName: "Student",
        passwordHash: hashedPassword,
        role: "STUDENT",
        isVerified: true,
      },
    });
    studentUserId = student.id;
    studentToken = generateToken("STUDENT", student.email, student.id);

    const otherStudent = await prisma.user.upsert({
      where: { email: "dash_other@fairpath.com" },
      update: {},
      create: {
        email: "dash_other@fairpath.com",
        firstName: "Other Test",
        lastName: "Student",
        passwordHash: hashedPassword,
        role: "STUDENT",
        isVerified: true,
      },
    });
    otherStudentUserId = otherStudent.id;
    otherStudentToken = generateToken("STUDENT", otherStudent.email, otherStudent.id);

    // Seed a university to use in favourites & applications tests
    const uni = await prisma.university.create({
      data: {
        name: "Dashboard Test University",
        slug: "dash-test-university",
        locationCity: "Brighton",
        locationCountry: "United Kingdom",
        rankingGlobal: 100,
        rankingNational: 10,
        tuitionMin: 10000,
        tuitionMax: 20000,
        setting: "SUBURBAN",
        type: "PUBLIC",
        acceptanceRate: 70.0,
        studentBodySize: 15000,
        description: "A university to test dashboard routes.",
        featuredImage: "https://example.com/dash-uni.jpg",
        departments: ["Science"],
        isFeatured: false,
        isPartner: false,
      },
    });
    testUniId = uni.id;

    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
  }, 30000);

  afterAll(async () => {
    // Tear down in order
    await prisma.savedMatch.deleteMany({
      where: { userId: { in: [studentUserId, otherStudentUserId].filter(Boolean) } },
    }).catch(() => {});

    await prisma.application.deleteMany({
      where: { userId: { in: [studentUserId, otherStudentUserId].filter(Boolean) } },
    }).catch(() => {});

    await prisma.university.deleteMany({
      where: { id: testUniId },
    }).catch(() => {});

    await (prisma as any).notification.deleteMany({
      where: {
        type: { in: ["USER_REGISTERED", "USER_ONBOARDING_COMPLETED", "APPLICATION_SUBMITTED", "APPLICATION_STATUS_CHANGED", "UNIVERSITY_CREATED", "UNIVERSITY_UPDATED", "UNIVERSITY_DELETED", "CACHE_CLEARED"] }
      }
    }).catch(() => {});

    await prisma.user.deleteMany({
      where: { id: { in: [adminUserId, studentUserId, otherStudentUserId].filter(Boolean) } },
    }).catch(() => {});

    await prisma.$disconnect();
    await pool.end();
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  }, 30000);

  // ─────────────────────────────────────────────────────
  // Student Dashboard Summary
  // ─────────────────────────────────────────────────────
  describe("GET /api/v1/dashboard/summary", () => {
    it("should return correct dashboard metrics for student user", async () => {
      const response = await request(app)
        .get("/api/v1/dashboard/summary")
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toHaveProperty("savedMatchesCount");
      expect(response.body.data).toHaveProperty("applicationsCount");
      expect(response.body.data).toHaveProperty("onboardingCompleted");
      expect(response.body.data.user.email).toContain("***"); // Ensure masked email
    });

    it("should reject summary check for unauthenticated user", async () => {
      await request(app)
        .get("/api/v1/dashboard/summary")
        .expect(401);
    });
  });

  // ─────────────────────────────────────────────────────
  // Favourites (Saved Matches)
  // ─────────────────────────────────────────────────────
  describe("Favourites Management", () => {
    it("should allow student to add a university to favourites", async () => {
      const response = await request(app)
        .post("/api/v1/favourites")
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          matchType: "UNIVERSITY",
          matchId: testUniId,
        })
        .expect(201);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toHaveProperty("id");
      testFavId = response.body.data.id;
    });

    it("should reject saving duplicates to favourites", async () => {
      await request(app)
        .post("/api/v1/favourites")
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          matchType: "UNIVERSITY",
          matchId: testUniId,
        })
        .expect(409);
    });

    it("should allow student to retrieve their favourites", async () => {
      const response = await request(app)
        .get("/api/v1/favourites")
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0].details.id).toBe(testUniId);
    });

    it("should prevent a user from deleting another user's favourite", async () => {
      await request(app)
        .delete(`/api/v1/favourites/${testFavId}`)
        .set("Authorization", `Bearer ${otherStudentToken}`)
        .expect(404); // Scoped to req.user.id, so not found
    });

    it("should allow student to delete their own favourite", async () => {
      await request(app)
        .delete(`/api/v1/favourites/${testFavId}`)
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(200);
    });
  });

  // ─────────────────────────────────────────────────────
  // Student & Admin Applications Flow
  // ─────────────────────────────────────────────────────
  describe("Applications Lifecycle", () => {
    it("should allow a student to submit an application", async () => {
      const response = await request(app)
        .post("/api/v1/applications")
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          universityId: testUniId,
          programId: "CS-101",
          deadline: new Date(Date.now() + 86400000 * 30).toISOString(),
        })
        .expect(201);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toHaveProperty("id");
      expect(response.body.data.status).toBe("SUBMITTED");
      testAppId = response.body.data.id;
    });

    it("should reject double applications to same university", async () => {
      await request(app)
        .post("/api/v1/applications")
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          universityId: testUniId,
          deadline: new Date().toISOString(),
        })
        .expect(409);
    });

    it("should return the application in the student's list", async () => {
      const response = await request(app)
        .get("/api/v1/applications")
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0].id).toBe(testAppId);
    });

    it("should allow an admin to retrieve student applications", async () => {
      const response = await request(app)
        .get("/api/v1/admin/applications")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("should reject admin actions from a student token", async () => {
      await request(app)
        .get("/api/v1/admin/applications")
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(403);
    });

    it("should allow an admin to transition application status to DEFERRED", async () => {
      const response = await request(app)
        .patch(`/api/v1/admin/applications/${testAppId}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "DEFERRED" })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe("DEFERRED");
    });
  });

  // ─────────────────────────────────────────────────────
  // Admin Notification Center & Analytics
  // ─────────────────────────────────────────────────────
  describe("Admin Notifications and Analytics", () => {
    it("should retrieve system notifications as an admin", async () => {
      const response = await request(app)
        .get("/api/v1/admin/notifications")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      
      // Keep track of one notification ID for markAsRead / delete tests
      testNotificationId = response.body.data[0].id;
    });

    it("should return the correct unread notifications count", async () => {
      const response = await request(app)
        .get("/api/v1/admin/notifications/unread-count")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data.count).toBeGreaterThan(0);
    });

    it("should mark a single notification as read", async () => {
      await request(app)
        .patch(`/api/v1/admin/notifications/${testNotificationId}/read`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
    });

    it("should mark all unread notifications as read", async () => {
      await request(app)
        .patch("/api/v1/admin/notifications/read-all")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
    });

    it("should delete a single notification", async () => {
      await request(app)
        .delete(`/api/v1/admin/notifications/${testNotificationId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
    });

    it("should return comprehensive KPI snapshot in GET /api/v1/admin/analytics", async () => {
      const response = await request(app)
        .get("/api/v1/admin/analytics")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toHaveProperty("users");
      expect(response.body.data).toHaveProperty("applications");
      expect(response.body.data).toHaveProperty("universities");
      expect(response.body.data).toHaveProperty("scholarships");
      expect(response.body.data.applications.byStatus).toHaveProperty("DEFERRED");
    });
  });

  // ─────────────────────────────────────────────────────
  // Admin Operations Dashboard
  // ─────────────────────────────────────────────────────
  describe("GET /api/v1/admin/operations", () => {
    it("should return operations overview and recent applications list for admin", async () => {
      const response = await request(app)
        .get("/api/v1/admin/operations")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toHaveProperty("overview");
      expect(response.body.data).toHaveProperty("recentApplications");

      const { overview, recentApplications } = response.body.data;
      expect(overview).toHaveProperty("totalStudents");
      expect(overview).toHaveProperty("activeApplications");
      expect(overview).toHaveProperty("matchSuccessRate");
      expect(overview).toHaveProperty("flaggedCases");

      expect(Array.isArray(recentApplications)).toBe(true);
      expect(recentApplications.length).toBeGreaterThan(0);
      expect(recentApplications[0]).toHaveProperty("id");
      expect(recentApplications[0]).toHaveProperty("studentName");
      expect(recentApplications[0]).toHaveProperty("targetedUniv");
      expect(recentApplications[0]).toHaveProperty("status");
      expect(recentApplications[0]).toHaveProperty("matchScore");
      expect(recentApplications[0]).toHaveProperty("date");
    });

    it("should reject operations request with 403 if user is not an admin", async () => {
      await request(app)
        .get("/api/v1/admin/operations")
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(403);
    });

    it("should reject operations request with 401 if token is missing", async () => {
      await request(app)
        .get("/api/v1/admin/operations")
        .expect(401);
    });

    it("should support filtering by status (READY, PENDING, NEEDS DOCUMENTS)", async () => {
      const response = await request(app)
        .get("/api/v1/admin/operations?status=READY")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      const apps = response.body.data.recentApplications;
      expect(Array.isArray(apps)).toBe(true);
      
      // Since it falls back to mockup data when empty, Elena Jenkins and David Park are READY.
      // Verify that all returned applications strictly match the filtered status
      for (const app of apps) {
        expect(app.status).toBe("READY");
      }
    });
  });

  // ─────────────────────────────────────────────────────
  // Admin KPIs & Performance Dashboard
  // ─────────────────────────────────────────────────────
  describe("GET /api/v1/admin/kpis", () => {
    it("should return correct operations KPIs structure for admin", async () => {
      const response = await request(app)
        .get("/api/v1/admin/kpis")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toHaveProperty("summary");
      expect(response.body.data).toHaveProperty("studentGrowth");
      expect(response.body.data).toHaveProperty("matchDistribution");
      expect(response.body.data).toHaveProperty("funnel");
      expect(response.body.data).toHaveProperty("performanceByInstitution");

      const { summary, studentGrowth, matchDistribution, funnel, performanceByInstitution } = response.body.data;

      // Summary KPIs
      expect(summary.totalApplicants).toHaveProperty("value");
      expect(summary.totalApplicants).toHaveProperty("trend");
      expect(summary.matchRate).toHaveProperty("value");
      expect(summary.matchRate).toHaveProperty("trend");
      expect(summary.partnerUniversities).toHaveProperty("value");
      expect(summary.partnerUniversities).toHaveProperty("trend");
      expect(summary.avgDecisionTime).toHaveProperty("value");
      expect(summary.avgDecisionTime).toHaveProperty("trend");

      // Growth charts
      expect(Array.isArray(studentGrowth.months)).toBe(true);
      expect(Array.isArray(studentGrowth.undergraduate)).toBe(true);
      expect(Array.isArray(studentGrowth.graduate)).toBe(true);

      // Match Distribution
      expect(Array.isArray(matchDistribution)).toBe(true);

      // Funnel
      expect(funnel).toHaveProperty("leadsGenerated");
      expect(funnel.profilesCreated).toHaveProperty("value");
      expect(funnel.profilesCreated).toHaveProperty("retention");
      expect(funnel.draftsSubmitted).toHaveProperty("value");
      expect(funnel.draftsSubmitted).toHaveProperty("retention");
      expect(funnel.finalMatches).toHaveProperty("value");
      expect(funnel.finalMatches).toHaveProperty("successRate");

      // Performance
      expect(Array.isArray(performanceByInstitution)).toBe(true);
    });

    it("should reject KPIs check for unauthenticated user", async () => {
      await request(app)
        .get("/api/v1/admin/kpis")
        .expect(401);
    });

    it("should reject KPIs check for student user", async () => {
      await request(app)
        .get("/api/v1/admin/kpis")
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(403);
    });
  });
});
