import logger from '../utils/logger.js';
import { PORT, NODE_ENV, BASE_URI } from '../config/config.js';

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
  
  if (isProduction) {
    logger.info(`[Email Service] Production email template compiled successfully for ${email.replace(/^(\w{3}).*(@.+)$/, "$1****$2")}`);
    // TODO(security): Integrate production SMTP client / Nodemailer / AWS SES / Resend API using htmlContent
  } else {
    logger.info(`Verification URL: ${verificationLink}`);
  }
};

