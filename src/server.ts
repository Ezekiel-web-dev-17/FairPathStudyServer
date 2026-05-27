import app from "./app.js";
import { NODE_ENV, PORT } from "./config/config.js";
import { connectDB } from "./config/db.js";
import { connectRedis } from "./config/redis.js";
import logger from "./utils/logger.js";

// ── Server Bootstrap ──
const startServer = async () => {
  logger.info("Starting FairPath Study Backend Server...");

  // Connect to PostgreSQL and Redis
  await connectDB();
  await connectRedis();

  app.listen(PORT, () => {
    logger.info(
      `Server is running in ${NODE_ENV || "development"} mode on port ${PORT}`,
    );
  });
};

startServer().catch((err) => {
  logger.error("Failed to start server: %o", err);
});
