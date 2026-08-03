import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * MailService — sends transactional email.
 * If SMTP_HOST is configured, uses nodemailer transport. Otherwise falls back
 * to console logging (development mode) — never silently drops mail.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly from: string;
  private readonly isSmtpConfigured: boolean;

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

  get isConfigured(): boolean {
    return this.isSmtpConfigured;
  }
}
