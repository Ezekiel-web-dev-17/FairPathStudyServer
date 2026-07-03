/**
 * Notification Service Unit Tests
 * --------------------------------
 * Tests the helper functions in src/services/notificationService.ts:
 * - createNotification: create, persist in DB, real-time dispatch via WebSocket
 * - notifyAllAdmins: query all users with role ADMIN and notify them in parallel
 * - createAdminNotification: conveniency helper matching legacy signature
 */

import { createNotification, notifyAllAdmins, createAdminNotification } from '../services/notificationService.js';
import { prisma } from '../config/db.js';
import { webSocketService } from '../services/websocketService.js';

describe('Notification Service Unit Tests', () => {
  let studentUserId: string;
  let adminUserId1: string;
  let adminUserId2: string;
  let originalSendMessageToUser: any;
  const mockSentMessages: any[] = [];

  beforeAll(async () => {
    // Mock webSocketService.sendMessageToUser
    originalSendMessageToUser = webSocketService.sendMessageToUser;
    webSocketService.sendMessageToUser = (userId: string, event: string, data: any) => {
      mockSentMessages.push({ userId, event, data });
      return true;
    };

    // Clean up prior test records
    await prisma.notification.deleteMany({
      where: {
        type: 'TEST_TYPE',
      },
    }).catch(() => {});

    await prisma.user.deleteMany({
      where: {
        email: { in: ['notif_student@test.com', 'notif_admin1@test.com', 'notif_admin2@test.com'] },
      },
    }).catch(() => {});

    // Create test users
    const student = await prisma.user.create({
      data: {
        email: 'notif_student@test.com',
        firstName: 'Notif',
        lastName: 'Student',
        passwordHash: 'dummy_hash',
        role: 'STUDENT',
      },
    });
    studentUserId = student.id;

    const admin1 = await prisma.user.create({
      data: {
        email: 'notif_admin1@test.com',
        firstName: 'Notif',
        lastName: 'Admin1',
        passwordHash: 'dummy_hash',
        role: 'ADMIN',
      },
    });
    adminUserId1 = admin1.id;

    const admin2 = await prisma.user.create({
      data: {
        email: 'notif_admin2@test.com',
        firstName: 'Notif',
        lastName: 'Admin2',
        passwordHash: 'dummy_hash',
        role: 'ADMIN',
      },
    });
    adminUserId2 = admin2.id;
  }, 30000);

  afterAll(async () => {
    // Restore mock
    webSocketService.sendMessageToUser = originalSendMessageToUser;

    // Clean up created records
    await prisma.notification.deleteMany({
      where: {
        userId: { in: [studentUserId, adminUserId1, adminUserId2] },
      },
    }).catch(() => {});

    await prisma.user.deleteMany({
      where: {
        id: { in: [studentUserId, adminUserId1, adminUserId2] },
      },
    }).catch(() => {});
  }, 30000);

  beforeEach(() => {
    mockSentMessages.length = 0;
  });

  describe('createNotification', () => {
    it('should persist a notification in DB and dispatch via WebSocket', async () => {
      const title = 'Application Update';
      const content = 'Your application has been received.';
      const type = 'TEST_TYPE';

      const notification = await createNotification(studentUserId, title, content, type);

      expect(notification).toHaveProperty('id');
      expect(notification.userId).toBe(studentUserId);
      expect(notification.title).toBe(title);
      expect(notification.content).toBe(content);
      expect(notification.type).toBe(type);

      // Verify DB persistence
      const dbNotification = await prisma.notification.findUnique({
        where: { id: notification.id },
      });
      expect(dbNotification).not.toBeNull();

      // Verify WebSocket dispatch
      expect(mockSentMessages.length).toBe(1);
      expect(mockSentMessages[0]).toEqual({
        userId: studentUserId,
        event: 'new-notification',
        data: expect.objectContaining({
          id: notification.id,
          title,
          content,
        }),
      });
    });
  });

  describe('notifyAllAdmins', () => {
    it('should notify all admins and persist notifications in parallel', async () => {
      const title = 'New User Registered';
      const content = 'A new student has joined FairPath.';
      const type = 'TEST_TYPE';

      await notifyAllAdmins(title, content, type);

      // Verify WebSocket dispatches for both admins
      const adminDispatches = mockSentMessages.filter(
        (m) => m.userId === adminUserId1 || m.userId === adminUserId2
      );
      expect(adminDispatches.length).toBe(2);

      // Verify database records exist for both admins
      const dbNotifications = await prisma.notification.findMany({
        where: {
          userId: { in: [adminUserId1, adminUserId2] },
          title,
          type,
        },
      });
      expect(dbNotifications.length).toBe(2);
    });
  });

  describe('createAdminNotification', () => {
    it('should wrap legacy parameters and dispatch to all admins', async () => {
      const params = {
        type: 'TEST_TYPE',
        title: 'Legacy Title',
        body: 'Legacy body message description',
      };

      await createAdminNotification(params);

      // Verify database records exist for both admins
      const dbNotifications = await prisma.notification.findMany({
        where: {
          userId: { in: [adminUserId1, adminUserId2] },
          title: params.title,
          content: params.body,
        },
      });
      expect(dbNotifications.length).toBe(2);
    });
  });
});
