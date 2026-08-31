import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

// .env.docker ships with SMTP_HOST already filled in (smtp.gmail.com) but
// SMTP_USER / SMTP_PASS left as these literal placeholders. If someone
// deploys without replacing them, the old code treated SMTP as "configured"
// (it only checked SMTP_HOST) and tried to authenticate to Gmail with fake
// credentials on every request — nodemailer threw, the whole
// /auth/password/forgot call crashed with an uncaught 500, and the frontend
// (which only advances to the OTP / new-password screen on a successful
// response) never moved past the "send OTP" step. That is the bug behind
// "OTP nahi aa raha, OTP/new-password field hi nahi khulta".
const PLACEHOLDER_USER = 'your-email@gmail.com';
const PLACEHOLDER_PASS = 'your-app-password';

/**
 * MailService — sends transactional email.
 * If SMTP_HOST/SMTP_USER/SMTP_PASS are all configured with real values, uses
 * a nodemailer transport. Otherwise (or if a real send attempt fails), falls
 * back to console logging — the reset flow keeps working end-to-end instead
 * of crashing the request.
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
    const port = this.config.get<number>('SMTP_PORT') || 587;
    const user = this.config.get<string>('SMTP_USER') || '';
    const pass = this.config.get<string>('SMTP_PASS') || '';

    const looksLikePlaceholder =
      !user || !pass || user === PLACEHOLDER_USER || pass === PLACEHOLDER_PASS;

    // FIX: require host + real (non-placeholder) user + pass before treating
    // SMTP as usable — previously this was `host.length > 0` alone.
    this.isSmtpConfigured = host.length > 0 && !looksLikePlaceholder;

    if (!host) {
      this.logger.warn('SMTP_HOST not set — OTP emails will be logged to the console (dev mode).');
    } else if (looksLikePlaceholder) {
      this.logger.warn(
        'SMTP_HOST is set but SMTP_USER/SMTP_PASS still look like the .env.docker placeholder ' +
          'values. Falling back to console-logged OTPs. Set a real Gmail address + 16-character ' +
          'App Password (or your provider\'s SMTP creds) in SMTP_USER/SMTP_PASS to send real emails.',
      );
    }

    this.transporter = this.isSmtpConfigured
      ? nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          auth: { user, pass },
        })
      : null;
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
      try {
        await this.transporter.sendMail({
          from: this.from,
          to,
          subject,
          html,
        });
        return;
      } catch (err) {
        // FIX: a real SMTP failure (bad creds, blocked port, network issue,
        // etc.) used to bubble straight up and crash the forgot-password
        // request with a 500. Log it clearly and fall back to console
        // logging so the reset flow still completes while SMTP gets fixed.
        this.logger.error(
          `Failed to send OTP email to ${to}: ${(err as Error).message}`,
        );
        this.logger.warn(`[DEV-MAIL] SMTP send failed; OTP for ${to} = ${otp}`);
        return;
      }
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
