import logger from '../utils/logger.js';
import { PORT, NODE_ENV, BASE_URI, JWT_SECRET, RESEND_API_KEY } from '../config/config.js';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';

export const resend = new Resend(RESEND_API_KEY || 're_placeholder_key');

/**
 * Generates a highly premium, modern, responsive HTML email template for email verification.
 */
export const generateVerificationHtml = (verificationLink: string): string => {
  const currentYear = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email - FairPath Study</title>
  <style>
    body {
      font-family: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: #f4f5f7;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      table-layout: fixed;
      background-color: #f4f5f7;
      padding: 40px 0;
    }
    .container {
      max-width: 580px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
    }
    .header {
      background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
      padding: 40px 20px;
      text-align: center;
    }
    .header h1 {
      color: #ffffff;
      margin: 0;
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .content {
      padding: 40px 30px;
      color: #1f2937;
      line-height: 1.6;
    }
    .content p {
      font-size: 16px;
      margin: 0 0 20px 0;
    }
    .cta-container {
      text-align: center;
      margin: 35px 0;
    }
    .btn {
      display: inline-block;
      background-color: #4f46e5;
      color: #ffffff !important;
      text-decoration: none;
      padding: 14px 30px;
      font-size: 16px;
      font-weight: 600;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
      transition: all 0.2s ease;
    }
    .btn:hover {
      background-color: #4338ca;
      box-shadow: 0 6px 16px rgba(79, 70, 229, 0.4);
    }
    .warning-box {
      background-color: #fef3c7;
      border-left: 4px solid #d97706;
      padding: 15px;
      border-radius: 6px;
      margin-bottom: 25px;
    }
    .warning-box p {
      margin: 0;
      color: #92400e;
      font-size: 14px;
    }
    .footer {
      background-color: #fafafa;
      padding: 24px 20px;
      text-align: center;
      border-top: 1px solid #f3f4f6;
    }
    .footer p {
      margin: 0 0 8px 0;
      font-size: 13px;
      color: #6b7280;
    }
    .footer a {
      color: #4f46e5;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1>FairPath Study</h1>
      </div>
      <div class="content">
        <p>Hello,</p>
        <p>Thank you for signing up on FairPath Study! We are thrilled to welcome you to our academic discovery platform.</p>
        <p>To finalize your registration and start matching with universities and scholarships, please verify your email address by clicking the secure button below:</p>
        
        <div class="cta-container">
          <a href="${verificationLink}" class="btn" target="_blank">Verify Email Address</a>
        </div>

        <div class="warning-box">
          <p><strong>Note:</strong> This verification link is valid for the next 24 hours. After it expires, you will need to register again.</p>
        </div>

        <p>If the button doesn't work, copy and paste this URL into your browser:</p>
        <p style="word-break: break-all; font-size: 13px; color: #4f46e5;"><a href="${verificationLink}">${verificationLink}</a></p>

        <p>If you did not create a FairPath Study account, please disregard this email.</p>
        <p>Best regards,<br><strong>The FairPath Study Team</strong></p>
      </div>
      <div class="footer">
        <p>&copy; ${currentYear} FairPath Study. All rights reserved.</p>
        <p>Need support? Contact us at <a href="mailto:support@fairpath.com">support@fairpath.com</a></p>
      </div>
    </div>
  </div>
</body>
</html>`;
};

/**
 * Sends a verification email to the user.
 * In development, it logs the verification link to the console/logger.
 * In production, it uses the premium HTML template and logs delivery setup.
 */
export const sendVerificationEmail = async (email: string, code: string): Promise<void> => {
  const port = PORT || 5000;
  
  // In real production, change the domain name to the production URL:
  const isProduction = NODE_ENV === 'production';
  const baseUrl = isProduction ? BASE_URI : `http://localhost:${port}`;
  const verificationLink = `${baseUrl}/api/v1/auth/verify-email?code=${code}`;

  const htmlContent = generateVerificationHtml(verificationLink);

  logger.info(`[Email Service] Verification email initiated for ${email.replace(/^(\w{3}).*(@.+)$/, "$1****$2")}`);
  
  if (RESEND_API_KEY && RESEND_API_KEY !== 're_placeholder_key') {
    try {
      const { data, error } = await resend.emails.send({
        from: 'FairPath Study <onboarding@resend.dev>',
        to: [email],
        subject: 'Verify Your Email - FairPath Study',
        html: htmlContent,
      });

      if (error) {
        logger.error(`Resend verification email failed for ${email}:`, error);
      } else {
        logger.info(`Resend verification email delivered: ${data?.id}`);
      }
    } catch (err) {
      logger.error(`Resend verification email error for ${email}:`, err);
    }
  } else {
    logger.info(`Verification URL: ${verificationLink}`);
  }
};

/**
 * Sends a friendly onboarding reminder email (Stage 1).
 */
export const sendOnboardingReminderEmail = async (email: string, fullName: string, currentScore: number): Promise<void> => {
  const currentYear = new Date().getFullYear();
  const isProduction = NODE_ENV === 'production';
  const baseUrl = isProduction ? BASE_URI : `http://localhost:${PORT || 5000}`;
  
  const unsubscribeToken = jwt.sign({ email }, JWT_SECRET!);
  const unsubscribeLink = `${baseUrl}/api/v1/auth/unsubscribe?token=${unsubscribeToken}`;
  const onboardingLink = isProduction ? BASE_URI : `http://localhost:5173/onboarding`;

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Complete Your Profile - FairPath Study</title>
  <style>
    body { font-family: 'Inter', sans-serif; background-color: #f4f5f7; margin: 0; padding: 0; }
    .container { max-width: 580px; margin: 40px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05); }
    .header { background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 40px 20px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 26px; font-weight: 700; }
    .content { padding: 40px 30px; color: #1f2937; line-height: 1.6; }
    .score-container { background-color: #f3f4f6; border-radius: 8px; padding: 20px; text-align: center; margin: 25px 0; }
    .score-bar { background-color: #e5e7eb; height: 12px; border-radius: 6px; overflow: hidden; margin-top: 10px; }
    .score-fill { background-color: #4f46e5; height: 100%; border-radius: 6px; width: ${currentScore}%; }
    .cta-container { text-align: center; margin: 35px 0; }
    .btn { display: inline-block; background-color: #4f46e5; color: #ffffff !important; text-decoration: none; padding: 14px 30px; font-size: 16px; font-weight: 600; border-radius: 8px; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3); }
    .footer { background-color: #fafafa; padding: 24px 20px; text-align: center; border-top: 1px solid #f3f4f6; font-size: 13px; color: #6b7280; }
    .footer a { color: #4f46e5; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>FairPath Study</h1>
    </div>
    <div class="content">
      <p>Hi ${fullName.split(' ')[0] || 'there'},</p>
      <p>We noticed you started your onboarding but haven't finished setting up your study preferences yet.</p>
      
      <div class="score-container">
        <p style="margin: 0; font-weight: 600; font-size: 16px;">Your Profile Score: <strong>${currentScore}% Complete</strong></p>
        <div class="score-bar">
          <div class="score-fill"></div>
        </div>
      </div>

      <p>Finishing your profile is extremely fast and takes less than 2 minutes. Once complete, you will instantly unlock highly matched, personalized university and scholarship listings based on your GPA and budget!</p>
      
      <div class="cta-container">
        <a href="${onboardingLink}" class="btn" target="_blank">Complete My Profile</a>
      </div>

      <p>Best regards,<br><strong>The FairPath Study Team</strong></p>
    </div>
    <div class="footer">
      <p>&copy; ${currentYear} FairPath Study. All rights reserved.</p>
      <p>Want to stop receiving these? <a href="${unsubscribeLink}">Unsubscribe Instantly</a></p>
    </div>
  </div>
</body>
</html>`;

  logger.info(`[Email Service] Stage 1 reminder email compiled for ${email}`);
  if (RESEND_API_KEY && RESEND_API_KEY !== 're_placeholder_key') {
    try {
      const { data, error } = await resend.emails.send({
        from: 'FairPath Study <onboarding@resend.dev>',
        to: [email],
        subject: 'Complete Your Profile - FairPath Study',
        html: htmlContent,
      });

      if (error) {
        logger.error(`Resend reminder email failed for ${email}:`, error);
      } else {
        logger.info(`Resend reminder email delivered: ${data?.id}`);
      }
    } catch (err) {
      logger.error(`Resend reminder email error for ${email}:`, err);
    }
  } else {
    logger.info(`Reminder URL: ${onboardingLink}`);
    logger.info(`Unsubscribe URL: ${unsubscribeLink}`);
  }
};

/**
 * Sends a deactivation and deletion warning email (Stage 2).
 */
export const sendOnboardingDeletionWarningEmail = async (email: string, fullName: string): Promise<void> => {
  const currentYear = new Date().getFullYear();
  const isProduction = NODE_ENV === 'production';
  const baseUrl = isProduction ? BASE_URI : `http://localhost:${PORT || 5000}`;
  
  const unsubscribeToken = jwt.sign({ email }, JWT_SECRET!);
  const unsubscribeLink = `${baseUrl}/api/v1/auth/unsubscribe?token=${unsubscribeToken}`;
  const onboardingLink = isProduction ? BASE_URI : `http://localhost:5173/onboarding`;

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Security Alert: Account Pending Deactivated - FairPath Study</title>
  <style>
    body { font-family: 'Inter', sans-serif; background-color: #f4f5f7; margin: 0; padding: 0; }
    .container { max-width: 580px; margin: 40px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05); }
    .header { background: linear-gradient(135deg, #d97706 0%, #dc2626 100%); padding: 40px 20px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 26px; font-weight: 700; }
    .content { padding: 40px 30px; color: #1f2937; line-height: 1.6; }
    .warning-box { background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; border-radius: 6px; margin: 25px 0; color: #991b1b; }
    .cta-container { text-align: center; margin: 35px 0; }
    .btn { display: inline-block; background-color: #dc2626; color: #ffffff !important; text-decoration: none; padding: 14px 30px; font-size: 16px; font-weight: 600; border-radius: 8px; box-shadow: 0 4px 12px rgba(220, 38, 38, 0.3); }
    .footer { background-color: #fafafa; padding: 24px 20px; text-align: center; border-top: 1px solid #f3f4f6; font-size: 13px; color: #6b7280; }
    .footer a { color: #dc2626; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Account Pending Deactivated</h1>
    </div>
    <div class="content">
      <p>Dear ${fullName || 'Student'},</p>
      <p>We are writing to inform you that your inactive, incomplete FairPath Study registration is scheduled for deletion.</p>
      
      <div class="warning-box">
        <p style="margin: 0; font-weight: bold;">Important Policy Alert:</p>
        <p style="margin: 5px 0 0 0;">In compliance with GDPR data protection laws and to maintain database hygiene, accounts that remain uncompleted are deactivated and securely purged from our servers.</p>
      </div>

      <p><strong>Your account is scheduled for deletion in exactly 3 days.</strong></p>
      <p>If you would like to keep your account and discover matches, simply complete your onboarding steps by clicking the button below:</p>
      
      <div class="cta-container">
        <a href="${onboardingLink}" class="btn" target="_blank">Keep My Account Active</a>
      </div>

      <p>Best regards,<br><strong>The FairPath Study Team</strong></p>
    </div>
    <div class="footer">
      <p>&copy; ${currentYear} FairPath Study. All rights reserved.</p>
      <p>Stop receiving these? <a href="${unsubscribeLink}">Unsubscribe Instantly</a></p>
    </div>
  </div>
</body>
</html>`;

  logger.warn(`[Email Service] Stage 2 deletion warning email compiled for ${email}`);
  if (RESEND_API_KEY && RESEND_API_KEY !== 're_placeholder_key') {
    try {
      const { data, error } = await resend.emails.send({
        from: 'FairPath Study <onboarding@resend.dev>',
        to: [email],
        subject: 'Account Pending Deactivation - FairPath Study',
        html: htmlContent,
      });

      if (error) {
        logger.error(`Resend deletion warning email failed for ${email}:`, error);
      } else {
        logger.info(`Resend deletion warning email delivered: ${data?.id}`);
      }
    } catch (err) {
      logger.error(`Resend deletion warning email error for ${email}:`, err);
    }
  } else {
    logger.info(`Keep Active URL: ${onboardingLink}`);
    logger.info(`Unsubscribe URL: ${unsubscribeLink}`);
  }
};

/**
 * Sends a deactivation goodbye notification (Stage 3).
 */
export const sendOnboardingGoodbyeEmail = async (email: string, fullName: string): Promise<void> => {
  const currentYear = new Date().getFullYear();
  const isProduction = NODE_ENV === 'production';

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Account Deleted - FairPath Study</title>
  <style>
    body { font-family: 'Inter', sans-serif; background-color: #f4f5f7; margin: 0; padding: 0; }
    .container { max-width: 580px; margin: 40px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05); }
    .header { background: #4b5563; padding: 40px 20px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 26px; font-weight: 700; }
    .content { padding: 40px 30px; color: #1f2937; line-height: 1.6; }
    .footer { background-color: #fafafa; padding: 24px 20px; text-align: center; border-top: 1px solid #f3f4f6; font-size: 13px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Account Deactivated</h1>
    </div>
    <div class="content">
      <p>Dear ${fullName || 'Student'},</p>
      <p>In accordance with our user security policy and prior warnings, your inactive incomplete FairPath Study registration has been deactivated and securely deleted from our database.</p>
      
      <p>All of your data has been permanently and safely purged.</p>
      <p>Should you decide to explore international university and scholarship matches in the future, you are always welcome to return and create a new account.</p>

      <p>Best regards,<br><strong>The FairPath Study Team</strong></p>
    </div>
    <div class="footer">
      <p>&copy; ${currentYear} FairPath Study. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

  logger.info(`[Email Service] Stage 3 goodbye email compiled for ${email}`);
  if (RESEND_API_KEY && RESEND_API_KEY !== 're_placeholder_key') {
    try {
      const { data, error } = await resend.emails.send({
        from: 'FairPath Study <onboarding@resend.dev>',
        to: [email],
        subject: 'Account Deactivated - FairPath Study',
        html: htmlContent,
      });

      if (error) {
        logger.error(`Resend goodbye email failed for ${email}:`, error);
      } else {
        logger.info(`Resend goodbye email delivered: ${data?.id}`);
      }
    } catch (err) {
      logger.error(`Resend goodbye email error for ${email}:`, err);
    }
  }
};


