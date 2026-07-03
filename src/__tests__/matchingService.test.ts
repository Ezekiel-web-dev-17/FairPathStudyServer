/**
 * Matching Service Unit Tests
 * ---------------------------
 * Pure unit tests for calculateMatchScore() in matchingService.ts.
 * No database or HTTP involved — runs entirely in-process.
 *
 * Score breakdown (see matchingService.ts):
 *   Academic (40 pts max) + Budget (30 pts max) + Major alignment (30 pts max)
 *   Capped at 100.
 */

import { calculateMatchScore, StudentProfile, ScholarshipEntity } from '../services/matchingService.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeScholarship = (overrides: Partial<ScholarshipEntity> = {}): ScholarshipEntity => ({
  id: 'sch-1',
  title: 'Generic Scholarship',
  category: 'need-based',
  eligibilityCriteria: 'Open to all',
  amountType: 'Fixed',
  amountValue: 3000,
  ...overrides,
});

const makeStudent = (overrides: Partial<StudentProfile> = {}): StudentProfile => ({
  gpa: 3.0,
  testScores: {},
  desiredMajors: ['Engineering'],
  destinations: ['United States'],
  ...overrides,
});

// ── Academic Scoring ──────────────────────────────────────────────────────────

describe('calculateMatchScore — Academic Scoring (Merit category)', () => {
  const meritScholarship = makeScholarship({ category: 'merit', amountType: 'Full Tuition' });

  it('should award 40 pts for GPA >= 3.8', () => {
    const score = calculateMatchScore(makeStudent({ gpa: 3.8 }), meritScholarship);
    // academic(40) + budget(30) + no major match(10) = 80
    expect(score).toBe(80);
  });

  it('should award 30 pts for GPA >= 3.5 and < 3.8', () => {
    const score = calculateMatchScore(makeStudent({ gpa: 3.6 }), meritScholarship);
    // academic(30) + budget(30) + no major match(10) = 70
    expect(score).toBe(70);
  });

  it('should award 15 pts for GPA >= 3.0 and < 3.5', () => {
    const score = calculateMatchScore(makeStudent({ gpa: 3.2 }), meritScholarship);
    // academic(15) + budget(30) + no major match(10) = 55
    expect(score).toBe(55);
  });

  it('should award 0 academic pts for GPA < 3.0 on a merit scholarship', () => {
    const score = calculateMatchScore(makeStudent({ gpa: 2.9 }), meritScholarship);
    // academic(0) + budget(30) + no major match(10) = 40
    expect(score).toBe(40);
  });
});

describe('calculateMatchScore — Academic Scoring (Non-merit category)', () => {
  const needScholarship = makeScholarship({ category: 'need-based', amountType: 'Full Tuition' });

  it('should award 30 pts for GPA >= 3.0 on a non-merit scholarship', () => {
    const score = calculateMatchScore(makeStudent({ gpa: 3.0 }), needScholarship);
    // academic(30) + budget(30) + no major match(10) = 70
    expect(score).toBe(70);
  });

  it('should award 15 pts for GPA < 3.0 on a non-merit scholarship', () => {
    const score = calculateMatchScore(makeStudent({ gpa: 2.5 }), needScholarship);
    // academic(15) + budget(30) + no major match(10) = 55
    expect(score).toBe(55);
  });
});

// ── Budget Scoring ────────────────────────────────────────────────────────────

describe('calculateMatchScore — Budget Scoring', () => {
  const student = makeStudent({ gpa: 3.8 }); // fixed academic = 40 (merit) or 30 (non-merit)

  it('should award 30 pts for Full Tuition coverage', () => {
    const score = calculateMatchScore(
      student,
      makeScholarship({ category: 'merit', amountType: 'Full Tuition' }),
    );
    // 40 + 30 + no-match(10) = 80
    expect(score).toBe(80);
  });

  it('should award 30 pts for Fixed amount >= 10000', () => {
    const score = calculateMatchScore(
      student,
      makeScholarship({ category: 'merit', amountType: 'Fixed', amountValue: 15000 }),
    );
    // 40 + 30 + no-match(10) = 80
    expect(score).toBe(80);
  });

  it('should award 20 pts for Fixed amount >= 5000 and < 10000', () => {
    const score = calculateMatchScore(
      student,
      makeScholarship({ category: 'merit', amountType: 'Fixed', amountValue: 7500 }),
    );
    // 40 + 20 + no-match(10) = 70
    expect(score).toBe(70);
  });

  it('should award 10 pts for Fixed amount < 5000', () => {
    const score = calculateMatchScore(
      student,
      makeScholarship({ category: 'merit', amountType: 'Fixed', amountValue: 2000 }),
    );
    // 40 + 10 + no-match(10) = 60
    expect(score).toBe(60);
  });

  it('should award 30 pts for Range amount >= 10000', () => {
    const score = calculateMatchScore(
      student,
      makeScholarship({ category: 'merit', amountType: 'Range', amountValue: 12000 }),
    );
    // 40 + 30 + no-match(10) = 80
    expect(score).toBe(80);
  });

  it('should award 0 budget pts for unknown amountType', () => {
    const score = calculateMatchScore(
      student,
      makeScholarship({ category: 'merit', amountType: 'Unknown', amountValue: 50000 }),
    );
    // 40 + 0 + no-match(10) = 50
    expect(score).toBe(50);
  });
});

// ── Major Alignment Scoring ───────────────────────────────────────────────────

describe('calculateMatchScore — Major Alignment Scoring', () => {
  const baseScholarship = makeScholarship({
    title: 'Engineering Excellence Award',
    category: 'merit',
    amountType: 'Full Tuition',
  });

  it('should award 30 pts when a desired major matches the scholarship title', () => {
    const score = calculateMatchScore(
      makeStudent({ gpa: 3.8, desiredMajors: ['Engineering'] }),
      baseScholarship,
    );
    // 40 + 30 + 30 = 100
    expect(score).toBe(100);
  });

  it('should award 30 pts when a desired major matches the scholarship category', () => {
    const categoryMatchScholarship = makeScholarship({
      title: 'Global Award',
      category: 'Engineering',
      amountType: 'Full Tuition',
    });
    const score = calculateMatchScore(
      makeStudent({ gpa: 3.8, desiredMajors: ['engineering'] }), // case-insensitive
      categoryMatchScholarship,
    );
    // category is 'Engineering' (non-merit) → academic(30) + budget(30) + major-match(30) = 90
    expect(score).toBe(90);
  });

  it('should award 10 pts (generic overlap) when no major matches', () => {
    const score = calculateMatchScore(
      makeStudent({ gpa: 3.8, desiredMajors: ['Medicine'] }),
      baseScholarship,
    );
    // 40 + 30 + 10 = 80
    expect(score).toBe(80);
  });

  it('should match any of the student\'s desired majors (OR logic)', () => {
    const score = calculateMatchScore(
      makeStudent({ gpa: 3.8, desiredMajors: ['Medicine', 'Engineering'] }),
      baseScholarship,
    );
    // Engineering matches title → major match = 30
    // 40 + 30 + 30 = 100
    expect(score).toBe(100);
  });
});

// ── Score Cap ─────────────────────────────────────────────────────────────────

describe('calculateMatchScore — Score Cap', () => {
  it('should cap the score at 100 even when all criteria are perfect', () => {
    const score = calculateMatchScore(
      makeStudent({ gpa: 4.0, desiredMajors: ['Engineering'] }),
      makeScholarship({
        title: 'Engineering Excellence Award',
        category: 'merit',
        amountType: 'Full Tuition',
      }),
    );
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBe(100);
  });
});

// ── Edge Cases ────────────────────────────────────────────────────────────────

describe('calculateMatchScore — Edge Cases', () => {
  it('should handle a student with zero GPA gracefully', () => {
    const score = calculateMatchScore(
      makeStudent({ gpa: 0 }),
      makeScholarship({ category: 'merit', amountType: 'Fixed', amountValue: 1000 }),
    );
    // academic(0) + budget(10) + no-match(10) = 20
    expect(score).toBe(20);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('should handle an empty desiredMajors array (no match, generic 10 pts)', () => {
    const score = calculateMatchScore(
      makeStudent({ gpa: 3.8, desiredMajors: [] }),
      makeScholarship({
        title: 'Engineering Award',
        category: 'merit',
        amountType: 'Full Tuition',
      }),
    );
    // 40 + 30 + 10 = 80
    expect(score).toBe(80);
  });

  it('should handle missing amountValue (defaults to 0) → 10 budget pts for Fixed', () => {
    const score = calculateMatchScore(
      makeStudent({ gpa: 3.8 }),
      makeScholarship({ category: 'merit', amountType: 'Fixed', amountValue: undefined }),
    );
    // 40 + 10 + no-match(10) = 60
    expect(score).toBe(60);
  });

  it('should be case-insensitive for the merit category check', () => {
    const scoreUpper = calculateMatchScore(
      makeStudent({ gpa: 3.9 }),
      makeScholarship({ category: 'MERIT', amountType: 'Full Tuition' }),
    );
    const scoreMixed = calculateMatchScore(
      makeStudent({ gpa: 3.9 }),
      makeScholarship({ category: 'Merit', amountType: 'Full Tuition' }),
    );
    expect(scoreUpper).toBe(scoreMixed);
  });
});
