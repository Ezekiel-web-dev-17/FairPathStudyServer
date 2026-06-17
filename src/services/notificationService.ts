/**
 * Notification Service
 * --------------------
 * Creates a persisted Notification record in the DB and simultaneously
 * broadcasts a real-time WebSocket event to all connected ADMIN clients.
 *
 * Security notes:
 * - metadata must NEVER contain passwords, tokens, or PII beyond display-safe identifiers.
 * - Notification creation failures are swallowed so they never break the originating action.
 */

import { NotificationType } from '@prisma/client';
import { prisma } from '../config/db.js';
import { webSocketService } from './websocketService.js';
import logger from '../utils/logger.js';

export interface NotificationPayload {
  type: NotificationType;
  title: string;
  body: string;
  /** Safe, non-sensitive contextual data (e.g. resource IDs, counts). Never include credentials. */
  metadata?: Record<string, unknown>;
}

/**
 * Creates a `Notification` DB row and broadcasts it via WebSocket to all ADMIN sessions.
 * Never throws — failures are logged but silently absorbed so calling code is never interrupted.
 */
export async function createAdminNotification(payload: NotificationPayload): Promise<void> {
  try {
    const notification = await (prisma as any).notification.create({
      data: {
        type: payload.type,
        title: payload.title,
        body: payload.body,
        metadata: payload.metadata as any,
        isRead: false,
      },
    });

    // Real-time broadcast to all ADMIN WebSocket connections
    webSocketService.broadcastToRole('ADMIN', 'notification:new', {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      metadata: notification.metadata,
      createdAt: notification.createdAt,
    });

    logger.info(`[NotificationService] Created notification: type=${payload.type}, id=${notification.id}`);
  } catch (error) {
    // Fail-safe: notification errors must never propagate to callers
    logger.error('[NotificationService] Failed to create notification: %o', error);
  }
}
