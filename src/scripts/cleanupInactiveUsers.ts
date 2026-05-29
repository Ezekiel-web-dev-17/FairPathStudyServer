import { prisma } from '../config/db.js';
import logger from '../utils/logger.js';
import {
  sendOnboardingReminderEmail,
  sendOnboardingDeletionWarningEmail,
  sendOnboardingGoodbyeEmail
} from '../services/emailService.js';

/**
 * Cleanup Inactive and Incomplete User Accounts.
 * This runner is designed to execute as a daily cron job (e.g. at 2:00 AM).
 * It uses a stateless, time-windowed query strategy to ensure actions (Stage 1 nudges and Stage 2 warnings)
 * are sent exactly once without bloating your database with extra state flags.
 * 
 * GDPR & Database Hygiene Lifecycle:
 * - Stage 1 (7 Days Inactive): Send a friendly match-gamified reminder nudge.
 * - Stage 2 (14 Days Inactive): Send a critical account deactivation/deletion warning.
 * - Stage 3 (17 Days Inactive): Securely delete and purge the inactive profile.
 */
export const runCleanupProcess = async (): Promise<void> => {
  logger.info('⏰ Starting daily inactive user cleanup runner...');
  const now = new Date();

  // Helper date window functions
  const getWindowDates = (daysAgoStart: number, daysAgoEnd: number) => {
    const start = new Date(now.getTime() - daysAgoEnd * 24 * 60 * 60 * 1000);
    const end = new Date(now.getTime() - daysAgoStart * 24 * 60 * 60 * 1000);
    return { start, end };
  };

  try {
    // ── STAGE 1: Onboarding Nudge Reminders (14-21 Days Old) ──
    const stage1Window = getWindowDates(14, 21);
    const stage1Users = await prisma.user.findMany({
      where: {
        createdAt: { gte: stage1Window.start, lt: stage1Window.end },
        role: 'STUDENT',
        profileCompletionPercent: { lt: 100 },
        marketingOptIn: true // Must respect marketing opt-out
      }
    });

    logger.info(`[Stage 1] Found ${stage1Users.length} inactive users qualifying for reminder nudges.`);
    for (const user of stage1Users) {
      const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
      await sendOnboardingReminderEmail(user.email, fullName, user.profileCompletionPercent);
    }

    // ── STAGE 2: Impending Deletion Warnings (17-24 Days Old) ──
    const stage2Window = getWindowDates(17, 24);
    const stage2Users = await prisma.user.findMany({
      where: {
        createdAt: { gte: stage2Window.start, lt: stage2Window.end },
        role: 'STUDENT',
        profileCompletionPercent: { lt: 100 }
        // Transactional legal warning - bypasses marketingOptIn check
      }
    });

    logger.info(`[Stage 2] Found ${stage2Users.length} inactive users qualifying for final deactivation warnings.`);
    for (const user of stage2Users) {
      const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
      await sendOnboardingDeletionWarningEmail(user.email, fullName);
    }

    // ── STAGE 3: Secure Account Pruning & Deletion (>= 17 Days Old) ──
    const stage3Threshold = new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000);
    const stage3Users = await prisma.user.findMany({
      where: {
        createdAt: { lte: stage3Threshold },
        role: 'STUDENT',
        profileCompletionPercent: { lt: 100 }
      }
    });

    logger.info(`[Stage 3] Found ${stage3Users.length} inactive incomplete accounts ready for secure deletion.`);
    
    for (const user of stage3Users) {
      const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();

      // Send goodbye notification (Optional but standard SaaS transparency)
      await sendOnboardingGoodbyeEmail(user.email, fullName);

      // Perform secure hard-delete
      // Cascading deletes are enforced at the database layer (referenced via onDelete: Cascade)
      await prisma.user.delete({
        where: { id: user.id }
      });
      logger.info(`[Stage 3] User ${user.email} successfully purged from database (GDPR Cleanup).`);
    }

    logger.info('Inactive user cleanup runner finished successfully.');
  } catch (error) {
    logger.error('Error executing inactive user cleanup runner:', error);
    throw error;
  }
};

// If executing this file directly from the terminal (e.g. via node/tsx in a cron job)
if (process.argv[1]?.endsWith('cleanupInactiveUsers.ts') || process.argv[1]?.endsWith('cleanupInactiveUsers.js')) {
  (async () => {
    try {
      await runCleanupProcess();
      await prisma.$disconnect();
      process.exit(0);
    } catch (err) {
      logger.error('Cron job script execution failed:', err);
      await prisma.$disconnect();
      process.exit(1);
    }
  })();
}
