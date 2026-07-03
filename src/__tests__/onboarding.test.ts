import app from "../app.js";
import request from "supertest";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/config.js";
import { prisma } from "../config/db.js";
import { redisClient } from "../config/redis.js";
import { response } from "express";

// Helper to generate JWT tokens for authentication testing
const generateToken = (role: "STUDENT" | "ADMIN", email = "test@example.com", id = "test-id-123") => {
  return jwt.sign({ id, email, role }, JWT_SECRET!);
};

describe("User Onboarding Integration Tests", () => {
  let studentToken: string;
  let studentId: string;
  const testEmail = "onboard_test@fairpath.com";

  beforeAll(async () => {
    // 1. Create a test student who is verified and ready for onboarding
    const testUser = await prisma.user.upsert({
      where: { email: testEmail },
      update: {},
      create: {
        email: testEmail,
        passwordHash: "dummyhash",
        role: "STUDENT",
        firstName: "OriginalFirst",
        lastName: "OriginalLast",
        isVerified: true,
        profileCompletionPercent: 20, // 20% for email verification complete
      },
    });

    studentId = testUser.id;
    studentToken = generateToken("STUDENT", testEmail, studentId);

    // 2. Clean up any leftover onboarding data for this test user from previous runs
    await prisma.userOnboarding.deleteMany({
      where: { userId: studentId },
    }).catch(() => {});
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.userOnboarding.deleteMany({
      where: { userId: studentId },
    }).catch(() => {});

    await prisma.user.deleteMany({
      where: { email: testEmail },
    }).catch(() => {});

    // Disconnect connection pools and Redis to allow Jest to exit cleanly
  });

  describe("GET /api/v1/onboarding", () => {
    it("should return null onboarding data if the user has not started onboarding yet", async () => {
      const response = await request(app)
        .get("/api/v1/onboarding")
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toBeNull();
      // Test user is verified, so should start with 20% profile completion score
      expect(response.body.profileCompletionPercent).toBe(20);
    });
  });

  describe("POST /api/v1/onboarding (Step 1: Personal Profile)", () => {
    it("should successfully save Step 1 draft progress (missing other step fields)", async () => {
      const step1Payload = {
        fullName: "Ezekiel Test User",
        dob: "2000-01-01",
        currentCountry: "Nigeria",
        nationality: "Nigerian",
        visaHistory: false,
      };

      const response = await request(app)
        .post("/api/v1/onboarding")
        .set("Authorization", `Bearer ${studentToken}`)
        .send(step1Payload)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.message).toBe("Draft saved successfully");
      expect(response.body.data).toHaveProperty("isCompleted", false);
      expect(response.body.data.fullName).toBe("Ezekiel Test User");
      expect(response.body.data.currentCountry).toBe("Nigeria");
      // Verification (20%) + Step 1 (20%) = 40%
      expect(response.body.profileCompletionPercent).toBe(40);

      // Verify other steps are left NULL/default as expected in draft mode
      expect(response.body.data.degreeLevel).toBeNull();
      expect(response.body.data.annualBudget).toBeNull();
    });
  });

  /*
   * =========================================================================
   * YOUR TURN: Step 2 & Step 3 Onboarding Draft Saving Tests
   * We have left these two steps for you to practice and write your own tests.
   * =========================================================================
   * 
   * TODO: Implement the tests below to verify step-by-step progress updating:
   * 
   * STEP 2 DRAFT TEST:
   * - Test description: "should update and save Step 2 draft budget & academic level, retaining Step 1 fields in DB"
   * - Action: POST `/api/v1/onboarding` with new fields (e.g. degreeLevel: "Bachelor's", gpa: "3.9", annualBudget: 40000, destinations: ["US", "Canada"])
   * - Assertion: Check that degreeLevel updates, while the Step 1 fullName remains "Ezekiel Test User" in the database.
   * 
   * STEP 3 DRAFT TEST:
   * - Test description: "should update and save Step 3 professional/testing data, keeping prior steps untouched"
   * - Action: POST `/api/v1/onboarding` with test details (e.g. englishTest: "IELTS", englishScore: "8.0", extracurriculars: ["Debate Team"])
   * - Assertion: Check that English scores are updated in DB, and other fields like annualBudget and fullName are preserved.
   */

  describe(`POST '/api/v1/onboarding' with new fields (e.g. degreeLevel: "Bachelor's", gpa: "3.9", annualBudget: 40000, destinations: ["US", "Canada"])`, () => {
    it(`"should update and save Step 2 draft budget & academic level, retaining Step 1 fields in DB"`, async () => {
      const step2Payload = {
        degreeLevel: "100",
        intendedMajor: "Electrical Engineering",
        gpa: "4.53",
        annualBudget: "22000",
        financialAid: "Yes",
        destinations: ["Anywhere"]
      }

      const response = await request(app)
        .post("/api/v1/onboarding")
        .set("Authorization", `Bearer ${studentToken}`)
        .send(step2Payload)
        .expect(200);

      expect(response.body.data.degreeLevel).not.toBe("degreeLevel");
      expect(response.body.data.fullName).toBe("Ezekiel Test User");
      // Verification (20%) + Step 1 (20%) + Step 2 (30%) = 70%
      expect(response.body.profileCompletionPercent).toBe(70);
    })
  })

  describe(`POST '/api/v1/onboarding' with new fields (e.g. englishTest: "IELTS", englishScore: "8.0", extracurriculars: ["Debate Team"])`, () => {
    it(`"should update and save Step 3 professional/testing data, keeping prior steps untouched"`, async () => {
      const someStep3Payload= {
        englishTest: "IELTS",
        englishScore: "8.5",
        academicTest: "GRE",
        academicScore: "325",
      }

      const response = await request(app)
        .post("/api/v1/onboarding")
        .set("Authorization", `Bearer ${studentToken}`)
        .send(someStep3Payload)
        .expect(200);

      expect(response.body.data.englishScore).toBe("8.5");
      expect(response.body.data.fullName).toBe("Ezekiel Test User");
      expect(response.body.data.annualBudget).toBe("22000");
      // Verification (20%) + Step 1 (20%) + Step 2 (30%) + Step 3 (20%) = 90%
      expect(response.body.profileCompletionPercent).toBe(90);
    })
  })

  describe("POST /api/v1/onboarding (Validation & Submission)", () => {
    it("should reject final submission if any of the required steps/fields are missing", async () => {
      // Sending a submission request, but missing a required field (visaHistory)
      const incompleteSubmissionPayload = {
        isSubmit: true,
        fullName: "Ezekiel Test User",
        dob: "2000-01-01",
        currentCountry: "Nigeria",
        nationality: "Nigerian",
        // Missing visaHistory — a required field
      };

      const response = await request(app)
        .post("/api/v1/onboarding")
        .set("Authorization", `Bearer ${studentToken}`)
        .send(incompleteSubmissionPayload)
        .expect(400);

      expect(response.body).toHaveProperty("success", false);
      expect(response.body.error).toContain("Cannot submit: Missing required fields");
    });

    it("should successfully finalize onboarding and transition user profile when complete", async () => {
      const completeSubmissionPayload = {
        isSubmit: true,
        fullName: "Ezekiel Completed User",
        dob: "2000-01-01",
        currentCountry: "Nigeria",
        nationality: "Nigerian",
        visaHistory: false,
        degreeLevel: "Master's",
        intendedMajor: "Computer Science",
        gpa: "3.95",
        annualBudget: 50000,
        financialAid: "Yes",
        destinations: ["United States", "Canada"],
        englishTest: "IELTS",
        englishScore: "8.5",
        academicTest: "GRE",
        academicScore: "325",
        extracurriculars: ["Robotics Club"],
        workExperience: "2 years",
        industry: "Software Engineering",
        consent: true,
      };

      const response = await request(app)
        .post("/api/v1/onboarding")
        .set("Authorization", `Bearer ${studentToken}`)
        .send(completeSubmissionPayload)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.message).toBe("Onboarding completed successfully");
      expect(response.body.data.isCompleted).toBe(true);

      // Verify the transition logic triggered the update on the core User record
      const updatedUser = await prisma.user.findUnique({
        where: { id: studentId },
      });

      expect(updatedUser).not.toBeNull();
      // Names should be split
      expect(updatedUser!.firstName).toBe("Ezekiel");
      expect(updatedUser!.lastName).toBe("Completed User");
      // Completion status
      expect(updatedUser!.profileCompletionPercent).toBe(100);
      expect(updatedUser!.countryOfOrigin).toBe("Nigeria");
      expect(updatedUser!.targetDestinations).toEqual(["United States", "Canada"]);

      // Verify structured JSON columns
      const academicData = updatedUser!.academicData as any;
      expect(academicData.gpa).toBe("3.95");
      expect(academicData.degreeLevel).toBe("Master's");
      expect(academicData.englishScore).toBe("8.5");

      const preferences = updatedUser!.preferences as any;
      expect(preferences.budgetMax).toBe("50000");
      expect(preferences.desiredMajors).toEqual(["Computer Science"]);
    });
  });
});
