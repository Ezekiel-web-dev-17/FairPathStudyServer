/**
 * Jest Global Teardown
 * --------------------
 * Runs once after ALL test suites have finished.
 * Responsible for closing singleton resources (Prisma, pg pool, Redis)
 * so that Jest can exit cleanly.
 *
 * Individual test files must NOT call prisma.$disconnect(), pool.end(), or
 * redisClient.quit() — doing so races against other parallel suites that
 * share the same singleton instances and causes "Cannot use pool after end"
 * and timeout errors.
 */

export default async function globalTeardown() {
  try {
    const { prisma, pool } = await import('./src/config/db.js');
    await prisma.$disconnect();
    await pool.end();
  } catch (_) {
    // Ignore — connections may already be closed
  }

  try {
    const { redisClient } = await import('./src/config/redis.js');
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  } catch (_) {
    // Ignore
  }
}
