import app from "../app.js";
import request from "supertest";
import { PORT } from "../config/config.js";
import { prisma } from "../config/db.js";
import { redisClient } from "../config/redis.js";

describe("ESM Import & Config Check", () => {
  afterAll(async () => {
    // Close database connection pool and Redis client to release event loop handles
  });

  it("should successfully import PORT and verify it is defined", () => {
    expect(PORT).toBeDefined();
    expect(Number(PORT)).toBe(5000);
  });

  it("should receive a successful response from the live server health endpoint", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);

    const data = response.body as { status: string; timestamp: string };
    expect(data).toHaveProperty("status", "ok");
    expect(data).toHaveProperty("timestamp");
    expect(new Date(data.timestamp).getTime()).not.toBeNaN();
  });
});
