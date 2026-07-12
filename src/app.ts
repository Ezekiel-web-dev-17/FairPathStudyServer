import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import apiRoutes from "./routes/api.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { rateLimitMiddleware } from "./middleware/rateLimit.js";
import { NODE_ENV, SESSION_SECRET, COOKIE_MAX_AGE } from "./config/config.js";
import session from 'express-session';
import { RedisStore } from 'connect-redis';
import { redisClient } from './config/redis.js';

const app = express();

// ── Standard Middlewares ──
app.use(helmet());
app.use(
    cors({
        origin: "http://localhost:3000", // Customize for production
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true,
    }),
);
app.use(cookieParser());
app.use(express.json());

app.use(
    session({
        store: new RedisStore({ client: redisClient }),
        secret: SESSION_SECRET!, // Used to sign the cookie so users can't tamper with it
        resave: false, // Don't save session if unmodified
        saveUninitialized: false, // Don't create a session until something is stored
        name: 'session_id', // Changes default 'connect.sid' name to hide tech stack
        cookie: {
            secure: NODE_ENV === 'production', // true requires HTTPS
            httpOnly: true, // Blocks XSS
            sameSite: 'strict', // Blocks CSRF
            maxAge: Number(COOKIE_MAX_AGE)// 1 day in milliseconds
        }
    })
);

// Only log HTTP requests if we are NOT running tests
if (NODE_ENV === "development") {
    app.use(morgan("dev"));
} else if (NODE_ENV === "production") {
    app.use(morgan("combined"));
}

// ── Health Check (before rate limiting so monitoring isn't blocked) ──
app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date() });
});

// ── Arcjet Rate Limiting ──
app.use(rateLimitMiddleware);

// ── API Routes ──
app.use("/api/v1", apiRoutes);

// ── 404 & Error Handlers ──
app.use(notFoundHandler);
app.use(errorHandler);

export default app;