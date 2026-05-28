import app from "../app.js";
import request from "supertest";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/config.js";
import { prisma, pool } from "../config/db.js";
import { redisClient } from "../config/redis.js";

// Helper to generate JWT tokens for authentication testing
const generateToken = (role: "STUDENT" | "ADMIN", email = "test@example.com", id = "test-id-123") => {
  return jwt.sign({ id, email, role }, JWT_SECRET!);
};

describe("Universities Integration Tests", () => {
  let adminToken: string;
  let studentToken: string;
  let testUniversityId: string;

  beforeAll(async () => {
    // Retrieve actual seeded user IDs to ensure database write actions like user profile updates succeed
    const seededAdmin = await prisma.user.findUnique({
      where: { email: "admin@fairpath.com" },
    });
    const seededStudent = await prisma.user.findUnique({
      where: { email: "student@fairpath.com" },
    });

    const adminId = seededAdmin ? seededAdmin.id : "admin-uuid";
    const studentId = seededStudent ? seededStudent.id : "student-uuid";

    adminToken = generateToken("ADMIN", "admin@fairpath.com", adminId);
    studentToken = generateToken("STUDENT", "student@fairpath.com", studentId);

    // Self-healing: clear any leftover test university with test slug from previous aborted runs
    await prisma.university.deleteMany({
      where: { slug: "antigravity-uni" },
    }).catch(() => {});
  });

  afterAll(async () => {
    // Clean up test data that might have been created
    if (testUniversityId) {
      try {
        await prisma.university.delete({
          where: { id: testUniversityId },
        }).catch(() => {});
      } catch (err) {}
    }

    // Disconnect connection pools and Redis to allow Jest to exit cleanly
    await prisma.$disconnect();
    await pool.end();
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  });

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
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
      expect(response.body.data[0].name).toContain("University of Oxford");
    });
  });

  describe("GET /api/v1/universities/featured", () => {
    it("should retrieve a list of featured universities", async () => {
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

  describe("GET /api/v1/universities/partners", () => {
    it("should retrieve partner universities with restricted fields", async () => {
      const response = await request(app)
        .get("/api/v1/universities/partners")
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);

      if (response.body.data.length > 0) {
        const firstUni = response.body.data[0];
        expect(firstUni).toHaveProperty("id");
        expect(firstUni).toHaveProperty("featuredImage");
        // Non-selected fields should not be returned
        expect(firstUni.name).toBeUndefined();
        expect(firstUni.slug).toBeUndefined();
      }
    });
  });

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

      // Retrieve from database to verify and capture ID
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
      
      // Clear variable so afterAll doesn't try to double-delete
      testUniversityId = "";
    });
  });
});
