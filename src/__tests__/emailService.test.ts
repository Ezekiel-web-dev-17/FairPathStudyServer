/**
 * Email Service Unit Tests
 * -------------------------
 * Tests the helper functions in src/services/emailService.ts:
 * - HTML templates generators
 * - sendVerificationEmail
 * - sendResetPasswordEmail
 * - sendPasswordResetSuccessEmail
 * - sendOnboardingReminderEmail
 * - sendOnboardingDeletionWarningEmail
 * - sendOnboardingGoodbyeEmail
 */

import {
  generateVerificationHtml,
  sendVerificationEmail,
  sendResetPasswordEmail,
  sendPasswordResetSuccessEmail,
  sendOnboardingReminderEmail,
  sendOnboardingDeletionWarningEmail,
  sendOnboardingGoodbyeEmail,
} from '../services/emailService.js';

describe('Email Service Unit Tests', () => {
  const email = 'test_email_service@fairpath.com';
  const fullName = 'Test Email Student';
  const dummyLink = 'http://localhost:5000/api/v1/auth/verify?token=dummy';

  describe('HTML Template Compilers', () => {
    it('should generate email verification HTML content correctly', () => {
      const html = generateVerificationHtml(dummyLink);
      expect(html).toContain('Verify Your Email');
      expect(html).toContain(dummyLink);
      expect(html).toContain('Outfit');
    });
  });

  describe('Email Dispatch Helpers (Test Mode Bypasses Resend API)', () => {
    it('should compile and log verification email info successfully without throwing', async () => {
      await expect(
        sendVerificationEmail(email, 'verification-code-123')
      ).resolves.not.toThrow();
    });

    it('should compile and log reset password email info successfully without throwing', async () => {
      await expect(
        sendResetPasswordEmail(email, 'reset-token-value-abc')
      ).resolves.not.toThrow();
    });

    it('should compile and log reset password success email successfully without throwing', async () => {
      await expect(
        sendPasswordResetSuccessEmail(email)
      ).resolves.not.toThrow();
    });

    it('should compile and log onboarding reminder email info successfully without throwing', async () => {
      await expect(
        sendOnboardingReminderEmail(email, fullName, 85)
      ).resolves.not.toThrow();
    });

    it('should compile and log onboarding deletion warning email info successfully without throwing', async () => {
      await expect(
        sendOnboardingDeletionWarningEmail(email, fullName)
      ).resolves.not.toThrow();
    });

    it('should compile and log onboarding deactivation goodbye email info successfully without throwing', async () => {
      await expect(
        sendOnboardingGoodbyeEmail(email, fullName)
      ).resolves.not.toThrow();
    });
  });
});
