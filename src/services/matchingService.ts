/**
 * Scholarship matching algorithm service.
 *
 * Computes a compatibility score (0–100) between a student profile
 * and a scholarship based on three weighted criteria:
 *   1. Academic Performance (GPA / Test Scores) — 40%
 *   2. Budget & Coverage Match — 30%
 *   3. Category / Major Alignment — 30%
 */

export interface StudentProfile {
  gpa: number;
  testScores: { sat?: number; act?: number; ielts?: number };
  desiredMajors: string[];
  destinations: string[];
}

export interface ScholarshipEntity {
  id: string;
  title: string;
  category: string;
  eligibilityCriteria: string;
  amountType: string;
  amountValue?: number;
}

export const calculateMatchScore = (
  student: StudentProfile,
  scholarship: ScholarshipEntity,
): number => {
  let score = 0;

  // 1. Academic Eligibility (40 pts max)
  if (scholarship.category.toLowerCase() === 'merit') {
    if (student.gpa >= 3.8) score += 40;
    else if (student.gpa >= 3.5) score += 30;
    else if (student.gpa >= 3.0) score += 15;
  } else {
    if (student.gpa >= 3.0) score += 30;
    else score += 15;
  }

  // 2. Budget / Coverage Match (30 pts max)
  if (scholarship.amountType === 'Full Tuition') {
    score += 30;
  } else if (scholarship.amountType === 'Range' || scholarship.amountType === 'Fixed') {
    const value = scholarship.amountValue || 0;
    if (value >= 10000) score += 30;
    else if (value >= 5000) score += 20;
    else score += 10;
  }

  // 3. Category / Major alignment (30 pts max)
  const matchesMajor = student.desiredMajors.some(
    (major) =>
      scholarship.title.toLowerCase().includes(major.toLowerCase()) ||
      scholarship.category.toLowerCase().includes(major.toLowerCase()),
  );
  if (matchesMajor) {
    score += 30;
  } else {
    score += 10; // generic interest overlap
  }

  return Math.min(score, 100);
};
