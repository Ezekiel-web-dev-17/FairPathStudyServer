import arcjet, { shield, fixedWindow, detectBot } from "@arcjet/node";
import { ARCJET_KEY, NODE_ENV } from "./config.js";

/**
 * Global Arcjet instance with layered security rules.
 * - shield: WAF protection against common attacks (SQLi, XSS)
 * - detectBot: blocks automated/scripted traffic
 * - fixedWindow: rate limit of 100 requests per 60 seconds per IP
 */
export const aj = arcjet({
  key: ARCJET_KEY!,
  rules: [
    shield({ mode: "LIVE" }),
    detectBot({
      mode: "LIVE",
      deny: NODE_ENV === "development"
        ? ["CATEGORY:AI"]
        : ["CATEGORY:AI", "CATEGORY:TOOL", "CATEGORY:PROGRAMMATIC"],
    }),
    fixedWindow({
      mode: "LIVE",
      window: "60s",
      max: 100,
    }),
  ],
});

/**
 * Stricter Arcjet instance for auth-sensitive endpoints.
 * Limits to 10 requests per 60 seconds to prevent brute-force attacks.
 * Uses ARCJET_KEY with fallback to ARCJET_KEY.
 */
export const authAj = arcjet({
  key: ARCJET_KEY!,
  rules: [
    shield({ mode: "LIVE" }),
    detectBot({
      mode: "LIVE",
      deny: ["CATEGORY:AI", "CATEGORY:TOOL", "CATEGORY:PROGRAMMATIC"],
    }),
    fixedWindow({
      mode: "LIVE",
      window: "60s",
      max: 10,
    }),
  ],
});
