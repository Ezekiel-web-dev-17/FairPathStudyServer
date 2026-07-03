import app from "../app.js";
import { prisma } from "../config/db.js";
import { redisClient } from "../config/redis.js";
import { runCleanupProcess } from "../scripts/cleanupInactiveUsers.js";

describe("Inactive User Cleanup Integration Tests", () => {
  const emailStage1 = "stage1_test@fairpath.com";
  const emailStage2 = "stage2_test@fairpath.com";
  const emailStage3 = "stage3_test@fairpath.com";
  
  let userId1: string;
  let userId2: string;
  let userId3: string;

  beforeAll(async () => {
    // 1. Self-healing cleanup
    await prisma.user.deleteMany({
      where: { email: { in: [emailStage1, emailStage2, emailStage3] } }
    }).catch(() => {});

    const now = new Date();

    // 2. Create Stage 1 Student (Created 16 days ago - inside [14, 21) window)
    const user1 = await prisma.user.create({
      data: {
        email: emailStage1,
        passwordHash: "dummyhash",
        role: "STUDENT",
        firstName: "StageOne",
        lastName: "User",
        isVerified: true,
        profileCompletionPercent: 40,
        marketingOptIn: true
      }
    });
    userId1 = user1.id;
    await prisma.user.update({
      where: { id: userId1 },
      data: { createdAt: new Date(now.getTime() - 16 * 24 * 60 * 60 * 1000) }
    });

    // 3. Create Stage 2 Student (Created 20 days ago - inside [17, 24) window)
    const user2 = await prisma.user.create({
      data: {
        email: emailStage2,
        passwordHash: "dummyhash",
        role: "STUDENT",
        firstName: "StageTwo",
        lastName: "User",
        isVerified: true,
        profileCompletionPercent: 70,
        marketingOptIn: true
      }
    });
    userId2 = user2.id;
    await prisma.user.update({
      where: { id: userId2 },
      data: { createdAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000) }
    });

    // 4. Create Stage 3 Student (Created 27 days ago - older than >= 25 day threshold)
    const user3 = await prisma.user.create({
      data: {
        email: emailStage3,
        passwordHash: "dummyhash",
        role: "STUDENT",
        firstName: "StageThree",
        lastName: "User",
        isVerified: true,
        profileCompletionPercent: 90,
        marketingOptIn: true
      }
    });
    userId3 = user3.id;
    await prisma.user.update({
      where: { id: userId3 },
      data: { createdAt: new Date(now.getTime() - 27 * 24 * 60 * 60 * 1000) }
    });
  });

  afterAll(async () => {
    // Final cleanup of remaining mock data
    await prisma.user.deleteMany({
      where: { email: { in: [emailStage1, emailStage2, emailStage3] } }
    }).catch(() => {});

    // Disconnect pools and Redis to allow Jest to exit cleanly
  });

  it("should successfully execute the cleanup process and apply time-windowed policies correctly", async () => {
    // Run the cleanup process
    await runCleanupProcess();

    // ── ASSERT STAGE 1: User still exists ──
    const user1 = await prisma.user.findUnique({
      where: { id: userId1 }
    });
    expect(user1).not.toBeNull();
    expect(user1!.email).toBe(emailStage1);

    // ── ASSERT STAGE 2: User still exists ──
    const user2 = await prisma.user.findUnique({
      where: { id: userId2 }
    });
    expect(user2).not.toBeNull();
    expect(user2!.email).toBe(emailStage2);

    // ── ASSERT STAGE 3: User was completely deleted ──
    const user3 = await prisma.user.findUnique({
      where: { id: userId3 }
    });
    expect(user3).toBeNull(); // Purged successfully!
  });
});
