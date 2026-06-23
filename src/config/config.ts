import process from "node:process";
import { config } from "dotenv";
import crypto from "node:crypto";

let envPath = ".env.development.local";
if (process.env.NODE_ENV === "production") {
    envPath = ".env.production.local";
} else if (process.env.NODE_ENV === "test") {
    envPath = ".env.test.local";
}

config({
    path: envPath,
    quiet: true,
});

const env = { ...process.env };

if (!env.JWT_SECRET) {
    if (env.NODE_ENV === "production") {
        throw new Error("CRITICAL: JWT_SECRET is required in production");
    } else {
        console.warn("WARNING: JWT_SECRET is not configured. Generating an ephemeral random secret.");
        env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
    }
}

if (!env.JWT_REFRESH_SECRET) {
    if (env.NODE_ENV === "production") {
        throw new Error("CRITICAL: JWT_REFRESH_SECRET is required in production");
    } else {
        console.warn("WARNING: JWT_REFRESH_SECRET is not configured. Generating an ephemeral random secret.");
        env.JWT_REFRESH_SECRET = crypto.randomBytes(32).toString("hex");
    }
}

export const {
    PORT,
    DATABASE_URL,
    DB_URI,
    REDIS_URL,
    JWT_SECRET = env.JWT_SECRET,
    JWT_REFRESH_SECRET = env.JWT_REFRESH_SECRET,
    JWT_EXPIRES_IN,
    JWT_REFRESH_EXPIRES_IN,
    NODE_ENV,
    ARCJET_KEY,
    COOKIE_MAX_AGE,
    BASE_URI,
    FRONTEND_URL,
    SESSION_SECRET,
    RESEND_API_KEY,
    RESEND_AUDIENCE_ID,
    CLEANUP_CRON,
} = env;