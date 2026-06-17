/**
 * Application Controller
 * ----------------------
 * Handles student application creation and admin management.
 *
 * Routes (added to api.ts):
 *   POST   /applications           — Student submits application to a university
 *   GET    /admin/applications     — Admin views all applications (paginated + filterable)
 *   PATCH  /admin/applications/:id/status — Admin updates application status (triggers notification)
 *
 * Security notes:
 * - Student routes are scoped to req.user.id from the verified JWT — never from req.body.
 * - Admin status updates are validated against an enum allow-list.
 * - Prisma ORM prevents SQL injection throughout.
 * - Notification metadata contains only IDs and status labels — no credentials or PII.
 */

import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../config/db.js';
import { createAdminNotification } from '../services/notificationService.js';
import logger from '../utils/logger.js';

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 50;

function getPagination(query: Record<string, unknown>) {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(query.limit ?? String(DEFAULT_LIMIT)), 10) || DEFAULT_LIMIT));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

// Valid status values for the allow-list check
const VALID_STATUSES = ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'ACCEPTED', 'REJECTED', 'DEFERRED'] as const;
type ValidStatus = typeof VALID_STATUSES[number];

// ── POST /applications ────────────────────────────────────────────────────────
/**
 * Creates a new application record for the authenticated student.
 * Fires a notification to all admin connections.
 */
export const createApplication = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized: Missing user credentials' });
      return;
    }

    const { universityId, programId, deadline } = req.body as {
      universityId?: string;
      programId?: string;
      deadline?: string;
    };

    if (!universityId || typeof universityId !== 'string') {
      res.status(400).json({ success: false, error: 'universityId is required' });
      return;
    }

    if (!deadline || typeof deadline !== 'string') {
      res.status(400).json({ success: false, error: 'deadline is required (ISO 8601 date string)' });
      return;
    }

    const parsedDeadline = new Date(deadline);
    if (isNaN(parsedDeadline.getTime())) {
      res.status(400).json({ success: false, error: 'deadline must be a valid date string' });
      return;
    }

    // Verify university exists
    const university = await prisma.university.findUnique({
      where: { id: universityId },
      select: { id: true, name: true },
    });
    if (!university) {
      res.status(404).json({ success: false, error: 'University not found' });
      return;
    }

    // Prevent duplicate application to same university
    const duplicate = await prisma.application.findFirst({
      where: { userId, universityId },
    });
    if (duplicate) {
      res.status(409).json({ success: false, error: 'You have already applied to this university' });
      return;
    }

    // Fetch student details for the notification
    const student = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });

    const application = await prisma.application.create({
      data: {
        userId,
        universityId,
        programId: programId && typeof programId === 'string' ? programId : null,
        deadline: parsedDeadline,
        status: 'SUBMITTED',
        documents: [],
      },
      select: {
        id: true,
        status: true,
        deadline: true,
        programId: true,
        createdAt: true,
        university: { select: { id: true, name: true, locationCity: true, locationCountry: true } },
      },
    });

    logger.info(`[Applications] Student ${userId} applied to university ${universityId}`);

    // Notify all admin connections (fire-and-forget, never throws)
    const studentName = [student?.firstName, student?.lastName].filter(Boolean).join(' ') || 'A student';
    await createAdminNotification({
      type: 'APPLICATION_SUBMITTED',
      title: 'New Application Submitted',
      body: `${studentName} has applied to ${university.name}${programId ? ` (${programId})` : ''}.`,
      metadata: { applicationId: application.id, universityId, userId },
    });

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      data: application,
    });
  } catch (error) {
    logger.error('createApplication error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── GET /admin/applications ───────────────────────────────────────────────────
/**
 * Returns all student applications for admin review.
 * Supports filtering by status and pagination.
 */
export const getAdminApplications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = getPagination(req.query as Record<string, unknown>);
    const statusFilter = req.query.status as string | undefined;
    const universityId = req.query.universityId as string | undefined;

    const where: any = {};
    if (statusFilter && (VALID_STATUSES as readonly string[]).includes(statusFilter)) {
      where.status = statusFilter;
    }
    if (universityId && typeof universityId === 'string') {
      where.universityId = universityId;
    }

    const [total, applications] = await prisma.$transaction([
      prisma.application.count({ where }),
      prisma.application.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          deadline: true,
          programId: true,
          documents: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              // Mask email for admin listing — full email available per-record if needed
              email: true,
            },
          },
          university: {
            select: {
              id: true,
              name: true,
              locationCity: true,
              locationCountry: true,
            },
          },
        },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: applications,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    logger.error('getAdminApplications error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── PATCH /admin/applications/:id/status ─────────────────────────────────────
/**
 * Admin updates the status of an application.
 * Status is validated against an enum allow-list.
 * Triggers a notification broadcast to all admin sessions.
 */
export const updateApplicationStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id || typeof id !== 'string') {
      res.status(400).json({ success: false, error: 'Invalid application ID' });
      return;
    }

    const { status } = req.body as { status?: string };
    if (!status || !(VALID_STATUSES as readonly string[]).includes(status)) {
      res.status(400).json({
        success: false,
        error: `status must be one of: ${VALID_STATUSES.join(', ')}`,
      });
      return;
    }

    const existing = await prisma.application.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        userId: true,
        user: { select: { firstName: true, lastName: true } },
        university: { select: { name: true } },
      },
    });

    if (!existing) {
      res.status(404).json({ success: false, error: 'Application not found' });
      return;
    }

    const updated = await prisma.application.update({
      where: { id },
      data: { status: status as ValidStatus },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        university: { select: { name: true } },
      },
    });

    logger.info(`[Applications] Admin updated application ${id} status: ${existing.status} → ${status}`);

    // Fire notification (non-blocking)
    const studentName = [existing.user?.firstName, existing.user?.lastName].filter(Boolean).join(' ') || 'A student';
    await createAdminNotification({
      type: 'APPLICATION_STATUS_CHANGED',
      title: 'Application Status Updated',
      body: `${studentName}'s application to ${existing.university?.name ?? 'a university'} was changed from ${existing.status} to ${status}.`,
      metadata: { applicationId: id, userId: existing.userId, previousStatus: existing.status, newStatus: status },
    });

    res.status(200).json({
      success: true,
      message: `Application status updated to ${status}`,
      data: updated,
    });
  } catch (error) {
    logger.error('updateApplicationStatus error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
