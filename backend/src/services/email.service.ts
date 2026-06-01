import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import { centralPool } from '../central-db.js';

export interface EmailConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure?: boolean;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  tenantId?: string | null;
}

export interface EmailResult {
  sent: boolean;
  messageId?: string;
  error?: string;
  reason?: string;
}

/**
 * Email Service - SMTP-based email sending
 *
 * Resolution order:
 * 1) Tenant-specific SMTP settings from DB (when tenantId is provided)
 * 2) Central SMTP settings from DB
 * 3) Environment variables fallback
 *
 * Environment variables fallback:
 * - SMTP_HOST: SMTP server hostname
 * - SMTP_PORT: SMTP server port (default: 587)
 * - SMTP_USER: SMTP username
 * - SMTP_PASS: SMTP password
 * - SMTP_FROM: From email address
 * - SMTP_SECURE: Use TLS (default: false for port 587, true for 465)
 * 
 * If SMTP is not configured, the service will log warnings and return
 * deterministic "not sent" responses without crashing the app.
 */
export class EmailService {
  private resolveEnvConfig(): EmailConfig | null {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM;

    if (!host || !user || !pass || !from) {
      return null;
    }

    const portNum = port ? parseInt(port, 10) : 587;
    const secure = process.env.SMTP_SECURE
      ? process.env.SMTP_SECURE === 'true'
      : portNum === 465;

    return {
      host,
      port: portNum,
      user,
      pass,
      from,
      secure,
    };
  }

  private async resolveStoredConfig(tenantId?: string | null): Promise<EmailConfig | null> {
    try {
      if (tenantId) {
        const tenantResult = await centralPool.query(
          `SELECT smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure
             FROM email_settings
            WHERE scope = 'tenant' AND tenant_id = $1
            LIMIT 1`,
          [tenantId]
        );
        if (tenantResult.rows.length > 0) {
          const row = tenantResult.rows[0];
          return {
            host: String(row.smtp_host),
            port: Number(row.smtp_port) || 587,
            user: String(row.smtp_user),
            pass: String(row.smtp_pass),
            from: String(row.smtp_from),
            secure: Boolean(row.smtp_secure),
          };
        }
      }

      const centralResult = await centralPool.query(
        `SELECT smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure
           FROM email_settings
          WHERE scope = 'central' AND tenant_id IS NULL
          LIMIT 1`
      );

      if (centralResult.rows.length > 0) {
        const row = centralResult.rows[0];
        return {
          host: String(row.smtp_host),
          port: Number(row.smtp_port) || 587,
          user: String(row.smtp_user),
          pass: String(row.smtp_pass),
          from: String(row.smtp_from),
          secure: Boolean(row.smtp_secure),
        };
      }
    } catch (error) {
      console.warn('[EmailService] Failed loading DB SMTP settings, falling back to env vars', error);
    }

    return null;
  }

  private async resolveConfig(tenantId?: string | null): Promise<EmailConfig | null> {
    const dbConfig = await this.resolveStoredConfig(tenantId);
    if (dbConfig) {
      return dbConfig;
    }
    return this.resolveEnvConfig();
  }

  private createTransporter(config: EmailConfig): Transporter {
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
      pool: false,
      maxConnections: 1,
      socketTimeout: 10000,
      connectionTimeout: 10000,
    } as SMTPTransport.Options);
  }

  async isConfigured(tenantId?: string | null): Promise<boolean> {
    const config = await this.resolveConfig(tenantId);
    return Boolean(config);
  }

  /**
   * Send an email
   * @param options Email options (to, subject, text/html)
   * @returns EmailResult with sent status and details
   */
  async send(options: SendEmailOptions): Promise<EmailResult> {
    const config = await this.resolveConfig(options.tenantId);

    if (!config) {
      console.warn(`[EmailService] Cannot send email to ${options.to} - SMTP not configured`);
      return {
        sent: false,
        reason: 'SMTP not configured',
      };
    }

    try {
      const transporter = this.createTransporter(config);
      const info = await transporter.sendMail({
        from: config.from,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });

      console.log(`[EmailService] Email sent to ${options.to}: ${info.messageId}`);
      return {
        sent: true,
        messageId: info.messageId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[EmailService] Failed to send email to ${options.to}:`, errorMessage);
      return {
        sent: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Send provisioning welcome email
   */
  async sendProvisioningWelcome(options: {
    to: string;
    tenantName: string;
    subdomain: string;
    adminName?: string;
  }): Promise<EmailResult> {
    const { to, tenantName, subdomain, adminName = 'Admin' } = options;

    const subject = `Welcome to ${tenantName} - Your LMS is Ready!`;
    
    const text = `
Hello ${adminName},

Welcome to ${tenantName}!

Your Learning Management System has been successfully provisioned and is ready to use.

Tenant Details:
- Company Name: ${tenantName}
- Subdomain: ${subdomain}
- Access URL: https://${subdomain}.yourdomain.com

You can now log in with the credentials you provided during registration.

Getting Started:
1. Log in to your tenant dashboard
2. Complete your profile setup
3. Start creating courses and adding students

If you have any questions or need assistance, please don't hesitate to contact our support team.

Best regards,
The LMS Team
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Cairo, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 45%, #450a0a 100%); color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border: 1px solid #ddd; border-top: none; }
    .details { background: white; padding: 15px; margin: 20px 0; border-left: 4px solid #7f1d1d; }
    .details strong { display: inline-block; width: 140px; }
    .steps { background: white; padding: 20px; margin: 20px 0; }
    .steps ol { margin: 0; padding-left: 20px; }
    .steps li { margin: 10px 0; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
    .button { display: inline-block; background: #7f1d1d; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .button:hover { background: #991b1b; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Welcome to ${tenantName}!</h1>
    </div>
    <div class="content">
      <p>Hello ${adminName},</p>
      
      <p>Your Learning Management System has been successfully provisioned and is ready to use.</p>
      
      <div class="details">
        <p><strong>Company Name:</strong> ${tenantName}</p>
        <p><strong>Subdomain:</strong> ${subdomain}</p>
        <p><strong>Access URL:</strong> <a href="https://${subdomain}.yourdomain.com">https://${subdomain}.yourdomain.com</a></p>
      </div>
      
      <p>You can now log in with the credentials you provided during registration.</p>
      
      <div class="steps">
        <h3>Getting Started:</h3>
        <ol>
          <li>Log in to your tenant dashboard</li>
          <li>Complete your profile setup</li>
          <li>Start creating courses and adding students</li>
        </ol>
      </div>
      
      <center>
        <a href="https://${subdomain}.yourdomain.com" class="button">Access Your Dashboard</a>
      </center>
      
      <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
      
      <p>Best regards,<br>The LMS Team</p>
    </div>
    <div class="footer">
      <p>This is an automated message. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>
    `.trim();

    return this.send({ to, subject, text, html });
  }

  /**
   * Send password reset email
   */
  async sendPasswordReset(options: {
    to: string;
    resetLink: string;
    siteName?: string;
    expiresMinutes?: number;
    tenantId?: string | null;
    lang?: 'en' | 'ar';
  }): Promise<EmailResult> {
    const { to, resetLink, siteName = 'Betacademy', expiresMinutes = 60, tenantId = null, lang = 'en' } = options;
    
    const isArabic = lang === 'ar';
    const dir = isArabic ? 'rtl' : 'ltr';
    
    // Translations
    const t = {
      subject: isArabic ? `إعادة تعيين كلمة المرور في ${siteName}` : `Reset your ${siteName} password`,
      header: isArabic ? 'طلب إعادة تعيين كلمة المرور' : 'Password Reset Request',
      intro: isArabic
        ? `لقد طلبت إعادة تعيين كلمة المرور الخاصة بك في <strong>${siteName}</strong>.`
        : `You requested to reset your password for <strong>${siteName}</strong>.`,
      button: isArabic ? 'إعادة تعيين كلمة المرور' : 'Reset Password',
      expiresMsg: isArabic
        ? `تنتهي صلاحية هذا الرابط خلال <strong>${expiresMinutes} دقيقة</strong>.`
        : `This link expires in <strong>${expiresMinutes} minutes</strong>.`,
      ignoreMsg: isArabic
        ? 'إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذا البريد الإلكتروني.'
        : 'If you did not request this reset, please ignore this email.',
      altMsg: isArabic
        ? `إذا لم يعمل الزر، انسخ والصق عنوان URL هذا في متصفحك:<br>${resetLink}`
        : `If the button does not work, copy and paste this URL into your browser:<br>${resetLink}`,
      plainIntro: isArabic
        ? `لقد طلبت إعادة تعيين كلمة المرور في ${siteName}.`
        : `You requested a password reset for ${siteName}.`,
      plainUseLink: isArabic ? 'استخدم هذا الرابط لإعادة تعيين كلمة المرور:' : 'Use this link to reset your password:',
      plainExpires: isArabic
        ? `تنتهي صلاحية هذا الرابط خلال ${expiresMinutes} دقيقة.`
        : `This link will expire in ${expiresMinutes} minutes.`,
      plainIgnore: isArabic
        ? 'إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذا البريد الإلكتروني بأمان.'
        : 'If you did not request this reset, you can safely ignore this email.'
    };

    const subject = t.subject;

    const text = [
      t.plainIntro,
      '',
      t.plainUseLink,
      resetLink,
      '',
      t.plainExpires,
      t.plainIgnore
    ].join('\n');

    const html = `
<!DOCTYPE html>
<html dir="${dir}" lang="${lang}">
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: ${isArabic ? 'Cairo, Tajawal, ' : ''}Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 45%, #450a0a 100%); color: white; padding: 18px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 8px 8px; background: white; ${isArabic ? 'text-align: right;' : ''} }
    .button { display: inline-block; background: #7f1d1d; color: white !important; text-decoration: none; padding: 12px 22px; border-radius: 6px; font-weight: 700; }
    .button:hover { background: #991b1b; }
    .note { margin-top: 16px; font-size: 13px; color: #6b7280; }
    .alt { margin-top: 12px; font-size: 12px; color: #6b7280; word-break: break-all; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">${t.header}</h2>
    </div>
    <div class="content">
      <p>${t.intro}</p>
      <p style="text-align: center;">
        <a class="button" href="${resetLink}">${t.button}</a>
      </p>
      <p>${t.expiresMsg}</p>
      <p class="note">${t.ignoreMsg}</p>
      <p class="alt">${t.altMsg}</p>
    </div>
  </div>
</body>
</html>
    `.trim();

    return this.send({ to, subject, text, html, tenantId });
  }

  /**
   * Send payment failure notification
   */
  async sendPaymentFailure(options: {
    to: string;
    tenantName: string;
    amount: number;
    currency: string;
    invoiceNumber?: string;
    invoiceUrl?: string;
    nextAttemptDate?: string;
    attemptCount?: number;
  }): Promise<EmailResult> {
    const {
      to,
      tenantName,
      amount,
      currency,
      invoiceNumber,
      invoiceUrl,
      nextAttemptDate,
      attemptCount,
    } = options;

    const subject = `Payment Failed - Action Required for ${tenantName}`;
    
    const formattedAmount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount);

    const text = `
Hello,

We were unable to process your recent payment for ${tenantName}.

Payment Details:
- Amount: ${formattedAmount}
${invoiceNumber ? `- Invoice Number: ${invoiceNumber}` : ''}
${attemptCount ? `- Attempt: ${attemptCount}` : ''}
${nextAttemptDate ? `- Next Retry: ${nextAttemptDate}` : ''}

Please update your payment method to ensure uninterrupted service.

${invoiceUrl ? `View Invoice: ${invoiceUrl}` : ''}

If you have any questions or believe this is an error, please contact our support team immediately.

Important: If payment is not received, your account may be suspended.

Best regards,
The LMS Team
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Cairo, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #dc2626; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border: 1px solid #ddd; border-top: none; }
    .alert { background: #fee; border-left: 4px solid #dc2626; padding: 15px; margin: 20px 0; }
    .details { background: white; padding: 15px; margin: 20px 0; }
    .details p { margin: 8px 0; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
    .button { display: inline-block; background: #dc2626; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .warning { color: #dc2626; font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚠️ Payment Failed</h1>
    </div>
    <div class="content">
      <p>Hello,</p>
      
      <div class="alert">
        <p><strong>We were unable to process your recent payment for ${tenantName}.</strong></p>
      </div>
      
      <div class="details">
        <h3>Payment Details:</h3>
        <p><strong>Amount:</strong> ${formattedAmount}</p>
        ${invoiceNumber ? `<p><strong>Invoice Number:</strong> ${invoiceNumber}</p>` : ''}
        ${attemptCount ? `<p><strong>Attempt:</strong> ${attemptCount}</p>` : ''}
        ${nextAttemptDate ? `<p><strong>Next Retry:</strong> ${nextAttemptDate}</p>` : ''}
      </div>
      
      <p>Please update your payment method to ensure uninterrupted service.</p>
      
      ${invoiceUrl ? `
      <center>
        <a href="${invoiceUrl}" class="button">View & Pay Invoice</a>
      </center>
      ` : ''}
      
      <p>If you have any questions or believe this is an error, please contact our support team immediately.</p>
      
      <p class="warning">⚠️ Important: If payment is not received, your account may be suspended.</p>
      
      <p>Best regards,<br>The LMS Team</p>
    </div>
    <div class="footer">
      <p>This is an automated message. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>
    `.trim();

    return this.send({ to, subject, text, html });
  }

  /**
   * Verify SMTP connection
   * Useful for testing configuration
   */
  async verifyConnection(tenantId?: string | null): Promise<{ success: boolean; error?: string }> {
    const config = await this.resolveConfig(tenantId);
    if (!config) {
      return {
        success: false,
        error: 'SMTP not configured',
      };
    }

    try {
      const transporter = this.createTransporter(config);
      await transporter.verify();
      console.log('[EmailService] SMTP connection verified');
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[EmailService] SMTP verification failed:', errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}

// Singleton instance
export const emailService = new EmailService();
