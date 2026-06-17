import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../config/db.js';
import logger from '../utils/logger.js';

interface UserOnboardingData {
  fullName?: string | null;
  dob?: Date | null;
  currentCountry?: string | null;
  nationality?: string | null;
  visaHistory?: boolean | null;
  degreeLevel?: string | null;
  intendedMajor?: string | null;
  gpa?: string | null;
  annualBudget?: any;
  financialAid?: string | null;
  destinations?: string[];
  englishTest?: string | null;
  englishScore?: string | null;
  academicTest?: string | null;
  academicScore?: string | null;
  extracurriculars?: string[];
  workExperience?: string | null;
  industry?: string | null;
  consent?: boolean;
  isCompleted?: boolean;
}

/**
 * Calculates a dynamic profile completion score based on verification and onboarding steps.
 * - Verification & Signup: 20%
 * - Step 1 (Personal details): 20%
 * - Step 2 (Academic & Budget details): 30%
 * - Step 3 (Testing & Professional details): 20%
 * - Step 4 (Consent & Completion): 10%
 */
export const calculateCompletionScore = (isVerified: boolean, onboarding: UserOnboardingData): number => {
  let score = 0;
  if (isVerified) score += 20;

  if (onboarding) {
    // Step 1: Personal Profile
    if (onboarding.fullName && onboarding.dob && onboarding.currentCountry && onboarding.nationality) {
      score += 20;
    }
    // Step 2: Academic & Budget
    if (onboarding.degreeLevel && onboarding.gpa && onboarding.annualBudget && onboarding.financialAid) {
      score += 30;
    }
    // Step 3: Testing & Professional details
    if (onboarding.englishTest || onboarding.academicTest || onboarding.workExperience || onboarding.industry) {
      score += 20;
    }
    // Step 4: Consent & Completion
    if (onboarding.consent) {
      score += 10;
    }
  }

  return score;
};

/**
 * GET /api/onboarding
 * Retrieves the saved onboarding progress for the logged-in user so they can resume.
 */
export const getOnboarding = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: Missing user credentials' });
      return;
    }

    const onboarding = await prisma.userOnboarding.findUnique({
      where: { userId }
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { profileCompletionPercent: true }
    });

    res.status(200).json({
      success: true,
      data: onboarding || null,
      profileCompletionPercent: user?.profileCompletionPercent || 0
    });
  } catch (error) {
    logger.error('Error fetching onboarding:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * POST /api/onboarding
 * Handles both partial saves (drafts) and final submissions using an Upsert pattern.
 */
export const saveOnboarding = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: Missing user credentials' });
      return;
    }

    // Extract fields and check if the user is performing a final submit vs. a draft save
    const { isSubmit, ...onboardingData } = req.body;

    // Convert date string to Date object safely if provided
    let formattedDob: Date | undefined;
    if (onboardingData.dob) {
      formattedDob = new Date(onboardingData.dob);
      if (isNaN(formattedDob.getTime())) {
        res.status(400).json({ error: 'Invalid date format for Date of Birth' });
        return;
      }
    }

    // Clean and convert visaHistory from string "yes"/"no" or boolean to boolean
    let visaHistoryBool: boolean | undefined = undefined;
    if (onboardingData.visaHistory === 'yes' || onboardingData.visaHistory === true) {
      visaHistoryBool = true;
    } else if (onboardingData.visaHistory === 'no' || onboardingData.visaHistory === false) {
      visaHistoryBool = false;
    }

    // Sanitize and parse annualBudget safely
    let sanitizedBudget: string | undefined = undefined;
    if (onboardingData.annualBudget) {
      sanitizedBudget = onboardingData.annualBudget.toString().replace(/[^0-9.]/g, '');
    }

    // Prepare matching Prisma fields
    const dataToSave: UserOnboardingData = {
      fullName: onboardingData.fullName,
      dob: formattedDob,
      currentCountry: onboardingData.currentCountry,
      nationality: onboardingData.nationality,
      visaHistory: visaHistoryBool,
      degreeLevel: onboardingData.degreeLevel,
      intendedMajor: onboardingData.intendedMajor,
      gpa: onboardingData.gpa,
      annualBudget: sanitizedBudget,
      financialAid: onboardingData.financialAid,
      destinations: onboardingData.destinations,
      englishTest: onboardingData.englishTest,
      englishScore: onboardingData.englishScore,
      academicTest: onboardingData.academicTest,
      academicScore: onboardingData.academicScore,
      extracurriculars: onboardingData.extracurriculars,
      workExperience: onboardingData.workExperience,
      industry: onboardingData.industry,
      consent: onboardingData.consent,
    };

    // If this is a final submission, validate that ALL required onboarding fields are present
    if (isSubmit) {
      const requiredFields = [
        'fullName',
        'dob',
        'currentCountry',
        'nationality',
        'visaHistory',
      ];

      const missingFields = requiredFields.filter((field) => {
        const val = (dataToSave as any)[field];
        return val === undefined || val === null || val === '';
      });

      if (missingFields.length > 0) {
        res.status(400).json({
          success: false,
          error: `Cannot submit: Missing required fields for final onboarding: ${missingFields.join(', ')}`,
        });
        return;
      }
    }

    let userOnboarding;

    if (isSubmit) {
      if (!dataToSave.consent) {
        res.status(400).json({
          success: false,
          error: 'Consent is required to finalize onboarding.',
        });
        return;
      }

      const nameParts = (dataToSave.fullName || '').trim().split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ');

      const academicData = {
        gpa: dataToSave.gpa,
        degreeLevel: dataToSave.degreeLevel,
        englishTest: dataToSave.englishTest,
        englishScore: dataToSave.englishScore,
        academicTest: dataToSave.academicTest,
        academicScore: dataToSave.academicScore,
      };

      const preferences = {
        budgetMax: dataToSave.annualBudget ? dataToSave.annualBudget.toString() : undefined,
        desiredMajors: dataToSave.intendedMajor ? [dataToSave.intendedMajor] : [],
        financialAid: dataToSave.financialAid,
      };

      // Atomic transaction: save onboarding and transition the user profile
      userOnboarding = await prisma.$transaction(async (tx) => {
        const onboarding = await tx.userOnboarding.upsert({
          where: { userId },
          update: {
            ...dataToSave,
            isCompleted: true,
          },
          create: {
            userId,
            ...dataToSave,
            isCompleted: true,
          },
        });

        await tx.user.update({
          where: { id: userId },
          data: {
            firstName: firstName || undefined,
            lastName: lastName || undefined,
            countryOfOrigin: dataToSave.currentCountry,
            targetDestinations: dataToSave.destinations,
            academicData: academicData,
            preferences: preferences,
            profileCompletionPercent: 100,
          },
        });

        return onboarding;
      });
    } else {
      // Just save the draft
      userOnboarding = await prisma.userOnboarding.upsert({
        where: { userId },
        update: {
          ...dataToSave,
        },
        create: {
          userId,
          ...dataToSave,
          isCompleted: false,
        },
      });

      // Get user verification state to calculate score
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isVerified: true }
      });

      const draftScore = calculateCompletionScore(user?.isVerified || false, userOnboarding);

      // Save draft profileCompletionPercent back to the User model
      await prisma.user.update({
        where: { id: userId },
        data: {
          profileCompletionPercent: draftScore
        }
      });
    }

    // Retrieve final score for response
    const updatedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { profileCompletionPercent: true }
    });

    res.status(200).json({
      success: true,
      message: isSubmit ? 'Onboarding completed successfully' : 'Draft saved successfully',
      data: userOnboarding,
      profileCompletionPercent: updatedUser?.profileCompletionPercent || 0
    });
  } catch (error) {
    logger.error('Error saving onboarding:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
