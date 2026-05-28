import process from "node:process";
import { config } from "dotenv";

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

export const {
    PORT,
    DATABASE_URL,
    DB_URI,
    REDIS_URL,
    JWT_SECRET,
    JWT_REFRESH_SECRET,
    JWT_EXPIRES_IN,
    NODE_ENV,
    ARCJET_KEY,
    COOKIE_MAX_AGE,
    BASE_URI,
    EMAIL_HOST,
    EMAIL_PORT,
    EMAIL_USER,
    EMAIL_PASS,
    SESSION_SECRET,
} = process.env;