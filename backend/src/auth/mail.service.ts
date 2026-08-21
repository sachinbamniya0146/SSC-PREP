import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Resend } from 'resend';

/**
 * MailService — sends transactional email.
 * If SMTP_HOST is configured, uses nodemailer transport. Otherwise falls back
 * to console logging (development mode) — never silently drops mail.
 * Now also supports Resend as a primary email provider when API key is configured.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly from: string;
  private readonly isSmtpConfigured: boolean;
  private readonly resend: Resend | null;

  constructor(private readonly config: ConfigService) {
    this.from = this.config.get<string>('SMTP_FROM') || 'noreply@sscprephub.in';
    const host = this.config.get<string>('SMTP_HOST') || '';
    this.isSmtpConfigured = host.length > 0;
    if (this.isSmtpConfigured) {
      this.transporter = nodemailer.createTransport({
        host,
        port: this.config.get<number>('SMTP_PORT') || 587,
        secure: (this.config.get<number>('SMTP_PORT') || 587) === 465,
        auth: {
          user: this.config.get<string>('SMTP_USER') || '',
          pass: this.config.get<string>('SMTP_PASS') || '',
        },
      });
    } else {
      this.transporter = null;
    }
    // Initialize Resend if API key is provided
    const resendApiKey = this.config.get<string>('RESEND_API_KEY');
    if (resendApiKey) {
      this.resend = new Resend(resendApiKey);
      this.logger.log('Resend email service configured');
    } else {
      this.resend = null;
    }
  }

  async sendOtpEmail(to: string, otp: string): Promise<void> {
    const subject = 'SSC Prep Hub — Login OTP';
    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px">
        <h2 style="color:#1e293b;margin:0 0 8px">SSC Prep Hub</h2>
        <p style="color:#475569;font-size:15px">Your OTP for login is:</p>
        <p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#4f46e5;margin:12px 0">${otp}</p>
        <p style="color:#64748b;font-size:13px">Valid for 10 minutes. Do not share this code with anyone.</p>
      </div>`;

    if (this.resend) {
      await this.resend.emails.send({
        from: this.from,
        to,
        subject,
        html,
      });
      return;
    }

    if (this.transporter) {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        html,
      });
      return;
    }

    // Dev fallback — visible in logs, not silently dropped.
    this.logger.warn(
      `[DEV-MAIL] SMTP not configured; OTP for ${to} = ${otp}`,
    );
  }

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    const subject = 'SSC Prep Hub — Password Reset Request';
    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px">
        <h2 style="color:#1e293b;margin:0 0 8px">SSC Prep Hub</h2>
        <p style="color:#475569;font-size:15px">We received a request to reset your password. If you didn't make this request, you can safely ignore this email.</p>
        <p style="margin:24px 0">
          <a href="${resetUrl}" style="background-color:#4f46e5;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">
            Reset Password
          </a>
        </p>
        <p style="color:#64748b;font-size:13px">This link will expire in 30 minutes.</p>
        <p style="color:#64748b;font-size:13px">If the button above doesn't work, please copy and paste the link below into your browser:</p>
        <p style="word-break:break-all;color:#4f46e5;font-size:13px">${resetUrl}</p>
      </div>`;

    if (this.resend) {
      await this.resend.emails.send({
        from: this.from,
        to,
        subject,
        html,
      });
      return;
    }

    if (this.transporter) {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        html,
      });
      return;
    }

    // Dev fallback — visible in logs, not silently dropped.
    this.logger.warn(
      `[DEV-MAIL] SMTP not configured; Password reset for ${to} = ${resetUrl}`,
    );
  }

  get isConfigured(): boolean {
    return this.isSmtpConfigured || !!this.resend;
  }
}