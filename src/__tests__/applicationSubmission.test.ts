/**
 * Application Submission Integration Tests (POST /applications)
 * -------------------------------------------------------------
 * Tests the student-facing createApplication endpoint, including:
 * - Successful submission
 * - Auth guards (401 / 403)
 * - Input validation (missing fields, bad deadline format, past deadline)
 * - Duplicate application prevention
 * - Non-existent university rejection
 *
 * Also tests the new status transitions added to updateApplicationStatus:
 * - VERIFIED, FLAGGED, NEEDS_DOCUMENT (previously absent from the allow-list)
 */

import app from '../app.js';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/config.js';
import { prisma } from '../config/db.js';
import { redisClient } from '../config/redis.js';
import bcrypt from 'bcryptjs';

const generateToken = (role: 'STUDENT' | 'ADMIN', email: string, id: string) =>
  jwt.sign({ id, email, role }, JWT_SECRET!);

const FUTURE_DEADLINE = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
const PAST_DEADLINE = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

describe('Application Submission — POST /api/v1/applications', () => {
  let studentToken: string;
  let otherStudentToken: string;
  let adminToken: string;

  let studentUserId: string;
  let otherStudentUserId: string;
  let adminUserId: string;

  let uniId: string;
  let createdAppId: string;

  beforeAll(async () => {
    const hashedPassword = await bcrypt.hash('Test@1234', 10);

    // Clean prior leftovers
    await prisma.application.deleteMany({
      where: {
        applicant: {
          email: {
            in: [
              'submit_student@fairpath.com',
              'submit_other@fairpath.com',
              'submit_admin@fairpath.com',
            ],
          },
        },
      },
    }).catch(() => {});

    await prisma.university.deleteMany({
      where: { slug: 'submit-test-uni' },
    }).catch(() => {});

    const student = await prisma.user.upsert({
      where: { email: 'submit_student@fairpath.com' },
      update: {},
      create: {
        email: 'submit_student@fairpath.com',
        firstName: 'Submit',
        lastName: 'Student',
        passwordHash: hashedPassword,
        role: 'STUDENT',
        isVerified: true,
      },
    });
    studentUserId = student.id;
    studentToken = generateToken('STUDENT', student.email, student.id);

    const otherStudent = await prisma.user.upsert({
      where: { email: 'submit_other@fairpath.com' },
      update: {},
      create: {
        email: 'submit_other@fairpath.com',
        firstName: 'Other',
        lastName: 'Student',
        passwordHash: hashedPassword,
        role: 'STUDENT',
        isVerified: true,
      },
    });
    otherStudentUserId = otherStudent.id;
    otherStudentToken = generateToken('STUDENT', otherStudent.email, otherStudent.id);

    const admin = await prisma.user.upsert({
      where: { email: 'submit_admin@fairpath.com' },
      update: {},
      create: {
        email: 'submit_admin@fairpath.com',
        firstName: 'Submit',
        lastName: 'Admin',
        passwordHash: hashedPassword,
        role: 'ADMIN',
        isVerified: true,
      },
    });
    adminUserId = admin.id;
    adminToken = generateToken('ADMIN', admin.email, admin.id);

    const uni = await prisma.university.create({
      data: {
        name: 'Submit Test University',
        slug: 'submit-test-uni',
        locationCity: 'Boston',
        locationCountry: 'United States',
        rankingGlobal: 50,
        rankingNational: 20,
        tuitionMin: 40000,
        tuitionMax: 55000,
        setting: 'URBAN',
        type: 'PRIVATE',
        acceptanceRate: 12.0,
        studentBodySize: 20000,
        description: 'A university for test submissions.',
        featuredImage: 'https://example.com/submit.jpg',
        departments: ['Engineering'],
      },
    });
    uniId = uni.id;

    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
  }, 30000);

  afterAll(async () => {
    await prisma.application.deleteMany({
      where: { universityId: uniId },
    }).catch(() => {});

    await prisma.university.deleteMany({
      where: { id: uniId },
    }).catch(() => {});

    await prisma.user.deleteMany({
      where: { id: { in: [studentUserId, otherStudentUserId, adminUserId] } },
    }).catch(() => {});
  }, 30000);

  // ── Auth Guards ──────────────────────────────────────────────────────────────

  it('should return 401 when no token is provided', async () => {
    await request(app)
      .post('/api/v1/applications')
      .send({ universityId: uniId, deadline: FUTURE_DEADLINE })
      .expect(401);
  });

  // ── Input Validation ─────────────────────────────────────────────────────────

  it('should return 400 when universityId is missing', async () => {
    const res = await request(app)
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ deadline: FUTURE_DEADLINE })
      .expect(400);

    expect(res.body).toHaveProperty('success', false);
    expect(res.body.error).toMatch(/universityId/i);
  });

  it('should return 400 when deadline is missing', async () => {
    const res = await request(app)
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ universityId: uniId })
      .expect(400);

    expect(res.body).toHaveProperty('success', false);
    expect(res.body.error).toMatch(/deadline/i);
  });

  it('should return 400 when deadline is not a valid date string', async () => {
    const res = await request(app)
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ universityId: uniId, deadline: 'not-a-date' })
      .expect(400);

    expect(res.body).toHaveProperty('success', false);
    expect(res.body.error).toMatch(/valid date/i);
  });

  it('should return 400 when deadline is in the past', async () => {
    const res = await request(app)
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ universityId: uniId, deadline: PAST_DEADLINE })
      .expect(400);

    expect(res.body).toHaveProperty('success', false);
    expect(res.body.error).toMatch(/future/i);
  });

  it('should return 404 when the university does not exist', async () => {
    const res = await request(app)
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ universityId: '00000000-0000-0000-0000-000000000000', deadline: FUTURE_DEADLINE })
      .expect(404);

    expect(res.body).toHaveProperty('success', false);
    expect(res.body.error).toMatch(/university not found/i);
  });

  // ── Successful Submission ────────────────────────────────────────────────────

  it('should successfully create an application for an authenticated student', async () => {
    const res = await request(app)
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        universityId: uniId,
        programId: 'MSc Software Engineering',
        deadline: FUTURE_DEADLINE,
      })
      .expect(201);

    expect(res.body).toHaveProperty('success', true);
    expect(res.body.message).toMatch(/submitted/i);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data).toHaveProperty('status', 'SUBMITTED');
    expect(res.body.data.university).toHaveProperty('name', 'Submit Test University');

    createdAppId = res.body.data.id;
  });

  it('should return 409 when a student applies to the same university twice', async () => {
    const res = await request(app)
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ universityId: uniId, deadline: FUTURE_DEADLINE })
      .expect(409);

    expect(res.body).toHaveProperty('success', false);
    expect(res.body.error).toMatch(/already applied/i);
  });

  it('should allow a different student to apply to the same university', async () => {
    const res = await request(app)
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${otherStudentToken}`)
      .send({ universityId: uniId, deadline: FUTURE_DEADLINE })
      .expect(201);

    expect(res.body).toHaveProperty('success', true);
    expect(res.body.data).toHaveProperty('status', 'SUBMITTED');
  });

  it('should appear in the student\'s application list after submission', async () => {
    const res = await request(app)
      .get('/api/v1/applications')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
    const ids = res.body.data.map((a: { id: string }) => a.id);
    expect(ids).toContain(createdAppId);
  });

  // ── Admin Status Transitions (new statuses) ──────────────────────────────────

  describe('Admin updateApplicationStatus — full enum coverage', () => {
    const newStatuses = ['VERIFIED', 'FLAGGED', 'NEEDS_DOCUMENT', 'ACCEPTED', 'REJECTED', 'DEFERRED', 'IN_REVIEW', 'SUBMITTED', 'DRAFT'] as const;

    for (const status of newStatuses) {
      it(`should allow admin to set application status to ${status}`, async () => {
        const res = await request(app)
          .patch(`/api/v1/admin/applications/${createdAppId}/status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status })
          .expect(200);

        expect(res.body).toHaveProperty('success', true);
        expect(res.body.data.status).toBe(status);
      });
    }

    it('should return 400 for an invalid status value', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/applications/${createdAppId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'TOTALLY_INVALID' })
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should return 404 when updating a non-existent application', async () => {
      const res = await request(app)
        .patch('/api/v1/admin/applications/00000000-0000-0000-0000-000000000000/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ACCEPTED' })
        .expect(404);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should return 403 when a student tries to update application status', async () => {
      await request(app)
        .patch(`/api/v1/admin/applications/${createdAppId}/status`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ status: 'ACCEPTED' })
        .expect(403);
    });

    it('should return 401 when no token is provided for status update', async () => {
      await request(app)
        .patch(`/api/v1/admin/applications/${createdAppId}/status`)
        .send({ status: 'ACCEPTED' })
        .expect(401);
    });
  });
});
