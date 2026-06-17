/**
 * Notification Controller
 * -----------------------
 * Serves admin-facing notification center endpoints.
 *
 * All endpoints are protected by authenticateJWT + requireAdmin middleware.
 *
 * Security notes:
 * - Role is validated server-side by middleware before any DB access.
 * - Pagination inputs are clamped.
 * - Notification IDs are validated before any DB operation.
 * - SQL injection is prevented by Prisma ORM (parameterized queries only).
 */

import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../config/db.js';
import logger from '../utils/logger.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function getPagination(query: Record<string, unknown>) {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(query.limit ?? String(DEFAULT_LIMIT)), 10) || DEFAULT_LIMIT));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

// ── GET /admin/notifications ──────────────────────────────────────────────────
/**
 * Returns paginated notifications for admins, newest first.
 * Optional query: ?unreadOnly=true to filter unread only.
 */
export const getNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = getPagination(req.query as Record<string, unknown>);
    const unreadOnly = req.query.unreadOnly === 'true';

    const where = unreadOnly ? { isRead: false } : {};

    const [total, notifications] = await prisma.$transaction([
      (prisma as any).notification.count({ where }),
      (prisma as any).notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          metadata: true,
          isRead: true,
          createdAt: true,
        },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: notifications,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    logger.error('getNotifications error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── GET /admin/notifications/unread-count ─────────────────────────────────────
/**
 * Returns the count of unread notifications — used by the frontend badge indicator.
 */
export const getUnreadCount = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const count = await (prisma as any).notification.count({ where: { isRead: false } });
    res.status(200).json({ success: true, data: { count } });
  } catch (error) {
    logger.error('getUnreadCount error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── PATCH /admin/notifications/:id/read ──────────────────────────────────────
/**
 * Marks a single notification as read.
 */
export const markAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id || typeof id !== 'string') {
      res.status(400).json({ success: false, error: 'Invalid notification ID' });
      return;
    }

    const existing = await (prisma as any).notification.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Notification not found' });
      return;
    }

    await (prisma as any).notification.update({ where: { id }, data: { isRead: true } });
    res.status(200).json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    logger.error('markAsRead error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── PATCH /admin/notifications/read-all ──────────────────────────────────────
/**
 * Marks all unread notifications as read in a single operation.
 */
export const markAllRead = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await (prisma as any).notification.updateMany({
      where: { isRead: false },
      data: { isRead: true },
    });

    res.status(200).json({ success: true, message: `Marked ${result.count} notification(s) as read` });
  } catch (error) {
    logger.error('markAllRead error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── DELETE /admin/notifications/:id ──────────────────────────────────────────
/**
 * Hard-deletes a single notification record.
 */
export const deleteNotification = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id || typeof id !== 'string') {
      res.status(400).json({ success: false, error: 'Invalid notification ID' });
      return;
    }

    const existing = await (prisma as any).notification.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Notification not found' });
      return;
    }

    await (prisma as any).notification.delete({ where: { id } });
    logger.info(`[Notifications] Admin deleted notification: ${id}`);
    res.status(200).json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    logger.error('deleteNotification error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
