import winston from "winston";
import { NODE_ENV } from "../config/config.js";

// List of sensitive keys to scrub from logged objects/messages
const SENSITIVE_KEYS = [
  "password",
  "token",
  "secret",
  "authorization",
  "jwt",
  "cookie",
  "refreshToken",
  "accessToken",
  "creditCard",
  "cvv",
];

/**
 * Helper to recursively scrub sensitive properties from an object or string.
 */
const scrubSensitiveData = (data: any): any => {
  if (!data) return data;

  if (typeof data === "string") {
    let scrubbed = data;
    for (const key of SENSITIVE_KEYS) {
      // Create a regex to match JSON/URL-like assignments or direct mentions of sensitive keys
      const regex = new RegExp(`("${key}"\\s*:\\s*")[^"]+(")`, "gi");
      scrubbed = scrubbed.replace(regex, `$1[REDACTED]$2`);
    }
    return scrubbed;
  }

  if (typeof data === "object") {
    if (Array.isArray(data)) {
      return data.map(scrubSensitiveData);
    }

    const scrubbedObj: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (SENSITIVE_KEYS.some((sensitiveKey) => key.toLowerCase().includes(sensitiveKey.toLowerCase()))) {
        scrubbedObj[key] = "[REDACTED]";
      } else if (typeof value === "object") {
        scrubbedObj[key] = scrubSensitiveData(value);
      } else {
        scrubbedObj[key] = value;
      }
    }
    return scrubbedObj;
  }

  return data;
};

/**
 * Custom Winston format that scrubs sensitive data from log metadata and messages.
 */
const redactFormat = winston.format((info) => {
  if (info.message) {
    info.message = scrubSensitiveData(info.message);
  }
  
  // Scrub any extra metadata fields attached to the log
  const metadata = { ...info };
  delete (metadata as any).level;
  delete (metadata as any).message;
  delete (metadata as any).timestamp;
  
  for (const key of Object.keys(metadata)) {
    info[key] = scrubSensitiveData(metadata[key]);
  }
  
  return info;
});

// Configure Winston transports based on environment
const transports: winston.transport[] = [
  new winston.transports.Console({
    format: NODE_ENV === "production"
      ? winston.format.combine(
          winston.format.timestamp(),
          redactFormat(),
          winston.format.json()
        )
      : winston.format.combine(
          winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
          winston.format.colorize(),
          redactFormat(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
            return `[${timestamp}] ${level}: ${message}${metaStr}`;
          })
        ),
  }),
];

/**
 * Centralized Winston Logger
 */
export const logger = winston.createLogger({
  level: NODE_ENV === "production" ? "info" : "debug",
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.splat()
  ),
  transports,
});

export default logger;
