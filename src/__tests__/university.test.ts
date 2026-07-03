import app from "../app.js";
import request from "supertest";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/config.js";
import { prisma } from "../config/db.js";
import { redisClient } from "../config/redis.js";
import bcrypt from "bcryptjs";

// ─────────────────────────────────────────────────────────
// Helper: generate JWT tokens for authentication testing
// ─────────────────────────────────────────────────────────
const generateToken = (role: "STUDENT" | "ADMIN", email: string, id: string) =>
  jwt.sign({ id, email, role }, JWT_SECRET!);

describe("Universities Integration Tests", () => {
  let adminToken: string;
  let studentToken: string;
  let testUniversityId: string;

  // IDs of users created by this test suite (cleaned up in afterAll)
  let adminUserId: string;
  let studentUserId: string;

  // IDs of universities seeded by this test suite
  let oxfordId: string;
  let partnerUniId: string;

  // ─────────────────────────────────────────────────────
  // beforeAll: seed all data this suite needs
  // ─────────────────────────────────────────────────────
  beforeAll(async () => {
    const hashedPassword = await bcrypt.hash("Test@1234", 10);

    // Create admin test user
    const admin = await prisma.user.upsert({
      where: { email: "uni_test_admin@fairpath.com" },
      update: {},
      create: {
        email: "uni_test_admin@fairpath.com",
        firstName: "Uni Test",
        lastName: "Admin",
        passwordHash: hashedPassword,
        role: "ADMIN",
      },
    });
    adminUserId = admin.id;
    adminToken = generateToken("ADMIN", admin.email, admin.id);

    // Create student test user
    const student = await prisma.user.upsert({
      where: { email: "uni_test_student@fairpath.com" },
      update: {},
      create: {
        email: "uni_test_student@fairpath.com",
        firstName: "Uni Test",
        lastName: "Student",
        passwordHash: hashedPassword,
        role: "STUDENT",
      },
    });
    studentUserId = student.id;
    studentToken = generateToken("STUDENT", student.email, student.id);

    // Seed a known university for name-filter tests
    const oxford = await prisma.university.upsert({
      where: { slug: "university-of-oxford-test" },
      update: {},
      create: {
        name: "University of Oxford",
        slug: "university-of-oxford-test",
        locationCity: "Oxford",
        locationCountry: "United Kingdom",
        rankingGlobal: 1,
        rankingNational: 1,
        tuitionMin: 15000,
        tuitionMax: 30000,
        setting: "URBAN",
        type: "PUBLIC",
        acceptanceRate: 17.5,
        studentBodySize: 24000,
        description: "One of the world's leading universities.",
        featuredImage: "https://example.com/oxford.jpg",
        departments: ["Law", "Medicine"],
        isFeatured: false,
        isPartner: false,
      },
    });
    oxfordId = oxford.id;

    // Seed a partner/featured university for /featured and /partners tests
    const partner = await prisma.university.upsert({
      where: { slug: "fairpath-partner-uni-test" },
      update: {},
      create: {
        name: "FairPath Partner University",
        slug: "fairpath-partner-uni-test",
        locationCity: "London",
        locationCountry: "United Kingdom",
        rankingGlobal: 50,
        rankingNational: 5,
        tuitionMin: 18000,
        tuitionMax: 25000,
        setting: "URBAN",
        type: "PRIVATE",
        acceptanceRate: 25.0,
        studentBodySize: 10000,
        description: "A proud FairPath partner.",
        featuredImage: "https://example.com/partner.jpg",
        departments: ["Business", "Engineering"],
        isFeatured: true,
        isPartner: true,
      },
    });
    partnerUniId = partner.id;

    // Self-healing: clear any leftover test university from a previous aborted run
    await prisma.university
      .deleteMany({ where: { slug: "antigravity-uni" } })
      .catch(() => {});
  }, 30000);

  // ─────────────────────────────────────────────────────
  // afterAll: tear down everything we created
  // ─────────────────────────────────────────────────────
  afterAll(async () => {
    // Clean up created university from POST test (if not already deleted)
    if (testUniversityId) {
      await prisma.university
        .delete({ where: { id: testUniversityId } })
        .catch(() => {});
    }
    // Clean up seed data created in beforeAll
    await prisma.university
      .deleteMany({ where: { id: { in: [oxfordId, partnerUniId].filter(Boolean) } } })
      .catch(() => {});
    await prisma.user
      .deleteMany({ where: { id: { in: [adminUserId, studentUserId].filter(Boolean) } } })
      .catch(() => {});

    // Close connection pools
  }, 30000);

  // ─────────────────────────────────────────────────────
  // GET /universities
  // ─────────────────────────────────────────────────────
  describe("GET /api/v1/universities", () => {
    it("should retrieve a paginated list of universities", async () => {
      const response = await request(app)
        .get("/api/v1/universities")
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body).toHaveProperty("pagination");
    });

    it("should filter universities by name successfully", async () => {
      const response = await request(app)
        .get("/api/v1/universities?name=University%20of%20Oxford")
        .expect(200);

      expect(response.body.success).toBe(true);
      // We seeded "University of Oxford" above, so at least 1 result is guaranteed
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
      expect(response.body.data[0].name).toContain("University of Oxford");
    });
  });

  // ─────────────────────────────────────────────────────
  // GET /universities/partners  (isPartner: true, isFeatured: true)
  // ─────────────────────────────────────────────────────
  describe("GET /api/v1/universities/partners", () => {
    it("should retrieve partner universities with id and featuredImage only", async () => {
      const response = await request(app)
        .get("/api/v1/universities/partners")
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);
      // We seeded a partner + featured university above
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);

      const firstUni = response.body.data[0];
      expect(firstUni).toHaveProperty("id");
      expect(firstUni).toHaveProperty("featuredImage");
      // getFeaturedUniversities uses select: { id, featuredImage } — name should NOT be present
      expect(firstUni.name).toBeUndefined();
      expect(firstUni.slug).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────
  // GET /universities/featured  (isPartner: true, all filters)
  // ─────────────────────────────────────────────────────
  describe("GET /api/v1/universities/featured", () => {
    it("should retrieve a list of partner universities", async () => {
      const response = await request(app)
        .get("/api/v1/universities/featured")
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);

      // All returned records must have isPartner = true
      response.body.data.forEach((uni: any) => {
        expect(uni.isPartner).toBe(true);
      });
    });
  });

  // ─────────────────────────────────────────────────────
  // POST /universities/
  // ─────────────────────────────────────────────────────
  describe("POST /api/v1/universities", () => {
    const validPayload = {
      name: "Test University of Antigravity",
      slug: "antigravity-uni",
      locationCity: "Milkyway",
      locationCountry: "Galaxy",
      rankingGlobal: 10,
      rankingNational: 1,
      tuitionMin: 15000,
      tuitionMax: 20000,
      setting: "URBAN",
      type: "PRIVATE",
      acceptanceRate: 8.5,
      studentBodySize: 5000,
      description: "A wonderful testing university.",
      featuredImage: "https://example.com/image.png",
      departments: ["Aerospace Engineering", "Cosmology"],
      isFeatured: false,
      isPartner: false,
    };

    it("should reject creation request with 401 if token is missing", async () => {
      const response = await request(app)
        .post("/api/v1/universities/")
        .send(validPayload)
        .expect(401);

      expect(response.body).toHaveProperty("error");
    });

    it("should reject creation request with 403 if user is not an admin", async () => {
      const response = await request(app)
        .post("/api/v1/universities/")
        .set("Authorization", `Bearer ${studentToken}`)
        .send(validPayload)
        .expect(403);

      expect(response.body).toHaveProperty("error");
    });

    it("should successfully create a new university when requested by admin", async () => {
      const response = await request(app)
        .post("/api/v1/universities/")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(validPayload)
        .expect(201);

      expect(response.body).toHaveProperty("message", "University created successfully");

      // Retrieve from DB to verify and capture ID for subsequent tests
      const createdUni = await prisma.university.findUnique({
        where: { slug: validPayload.slug },
      });
      expect(createdUni).not.toBeNull();
      expect(createdUni!.name).toBe(validPayload.name);
      testUniversityId = createdUni!.id;
    });

    it("should reject duplicate university creation with 400", async () => {
      const response = await request(app)
        .post("/api/v1/universities/")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(validPayload)
        .expect(400);

      expect(response.body).toHaveProperty("error", "University already exists");
    });
  });

  // ─────────────────────────────────────────────────────
  // PUT /universities/:id
  // ─────────────────────────────────────────────────────
  describe("PUT /api/v1/universities/:id", () => {
    it("should reject update request with 401 if token is missing", async () => {
      await request(app)
        .put(`/api/v1/universities/${testUniversityId}`)
        .send({ data: { name: "Updated Name" } })
        .expect(401);
    });

    it("should reject update request with 403 if user is not an admin", async () => {
      await request(app)
        .put(`/api/v1/universities/${testUniversityId}`)
        .set("Authorization", `Bearer ${studentToken}`)
        .send({ data: { name: "Updated Name" } })
        .expect(403);
    });

    it("should successfully update a university when requested by admin", async () => {
      const response = await request(app)
        .put(`/api/v1/universities/${testUniversityId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ data: { name: "Updated Name University" } })
        .expect(200);

      expect(response.body).toHaveProperty("message", "University updated successfully");

      const updatedUni = await prisma.university.findUnique({
        where: { id: testUniversityId },
      });
      expect(updatedUni!.name).toBe("Updated Name University");
    });
  });

  // ─────────────────────────────────────────────────────
  // GET /universities/:slug
  // ─────────────────────────────────────────────────────
  describe("GET /api/v1/universities/:slug", () => {
    it("should return university info when querying valid slug", async () => {
      const response = await request(app)
        .get("/api/v1/universities/antigravity-uni")
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toHaveProperty("slug", "antigravity-uni");
    });

    it("should return 404 for non-existent slug", async () => {
      const response = await request(app)
        .get("/api/v1/universities/non-existent-slug-123")
        .expect(404);

      expect(response.body).toHaveProperty("success", false);
      expect(response.body.error).toBe("University not found");
    });
  });

  // ─────────────────────────────────────────────────────
  // GET /matches
  // ─────────────────────────────────────────────────────
  describe("GET /api/v1/matches", () => {
    it("should reject request with 401 if token is missing", async () => {
      await request(app)
        .get("/api/v1/matches")
        .expect(401);
    });

    it("should return matching results based on user preferences", async () => {
      // Setup mock onboarding for student user
      await prisma.userOnboarding.upsert({
        where: { userId: studentUserId },
        update: {
          intendedMajor: "Computer Science",
          annualBudget: 60000,
          destinations: ["United States"],
          englishScore: "8.0",
        },
        create: {
          userId: studentUserId,
          fullName: "Alex Mercer",
          dob: new Date("2000-01-01"),
          currentCountry: "Canada",
          nationality: "Canadian",
          visaHistory: false,
          intendedMajor: "Computer Science",
          annualBudget: 60000,
          destinations: ["United States"],
          englishScore: "8.0",
          consent: true,
          isCompleted: true,
        }
      });

      const response = await request(app)
        .get("/api/v1/matches")
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0]).toHaveProperty("matchScore");
      expect(response.body.data[0]).toHaveProperty("reasons");
    });
  });

  // ─────────────────────────────────────────────────────
  // GET /admin/universities
  // ─────────────────────────────────────────────────────
  describe("GET /api/v1/admin/universities", () => {
    it("should reject request with 403 if user is not an admin", async () => {
      await request(app)
        .get("/api/v1/admin/universities")
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(403);
    });

    it("should return list of partners with application counts for admin", async () => {
      const response = await request(app)
        .get("/api/v1/admin/universities")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0]).toHaveProperty("applicationsCount");
      expect(response.body.data[0]).toHaveProperty("status");
    });
  });

  // ─────────────────────────────────────────────────────
  // DELETE /universities/:id
  // ─────────────────────────────────────────────────────
  describe("DELETE /api/v1/universities/:id", () => {
    it("should reject delete request with 401 if token is missing", async () => {
      await request(app)
        .delete(`/api/v1/universities/${testUniversityId}`)
        .expect(401);
    });

    it("should reject delete request with 403 if user is not an admin", async () => {
      await request(app)
        .delete(`/api/v1/universities/${testUniversityId}`)
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(403);
    });

    it("should successfully delete a university when requested by admin", async () => {
      const response = await request(app)
        .delete(`/api/v1/universities/${testUniversityId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("message", "University deleted successfully");

      const deletedUni = await prisma.university.findUnique({
        where: { id: testUniversityId },
      });
      expect(deletedUni).toBeNull();

      // Clear so afterAll doesn't try to double-delete
      testUniversityId = "";
    });
  });
});
