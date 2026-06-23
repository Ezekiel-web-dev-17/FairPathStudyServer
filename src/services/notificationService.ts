import { prisma } from '../config/db.js';
import { webSocketService } from './websocketService.js';
import logger from '../utils/logger.js';

/**
 * Creates and persists a notification in the database,
 * and pushes it via WebSocket in real time if the recipient is connected.
 */
export const createNotification = async (
  userId: string,
  title: string,
  content: string,
  type: string = 'INFO'
) => {
  try {
    // 1. Persist notification in database
    const notification = await prisma.notification.create({
      data: {
        userId,
        title,
        content,
        type,
      },
    });

    // 2. Real-time dispatch via WebSocket if active connection exists
    webSocketService.sendMessageToUser(userId, 'new-notification', notification);

    return notification;
  } catch (error) {
    logger.error('Failed to create/send notification: %o', error);
    throw error;
  }
};

/**
 * Convenience helper to save and dispatch a notification to all administrators.
 */
export const notifyAllAdmins = async (
  title: string,
  content: string,
  type: string = 'INFO'
) => {
  try {
    // Query all users with ADMIN role
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true },
    });

    // Create notifications in parallel
    await Promise.all(
      admins.map((admin) => createNotification(admin.id, title, content, type))
    );
  } catch (error) {
    logger.error('Failed to notify all admins: %o', error);
  }
};

/**
 * Backwards-compatible helper matching legacy notificationService signature.
 */
export const createAdminNotification = async (params: {
  type: string;
  title: string;
  body: string;
  metadata?: Record<string, any>;
}) => {
  await notifyAllAdmins(params.title, params.body, params.type);
};
