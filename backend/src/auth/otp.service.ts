import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { MailService } from './mail.service';

const OTP_TTL_SECONDS = 10 * 60; // 10 min
const MAX_ATTEMPTS = 5; // 5 attempts to verify OTP
const RESEND_COOLDOWN_SECONDS = 60; // 1 min cooldown
const HOURLY_LIMIT = 3; // max 3 OTPs per hour per email for forgot password
const HOURLY_WINDOW_SECONDS = 60 * 60; // 1 hour

/**
 * OtpService — Redis-backed email OTP with rate limiting (5 attempts) and
 * 10-minute expiry. Codes are numeric 6-digit, single-use.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  private key(email: string): string {
    return `otp:${email.toLowerCase().trim()}`;
  }

  private attemptKey(email: string): string {
    return `otp:attempts:${email.toLowerCase().trim()}`;
  }

  private hourlyCountKey(email: string): string {
    return `otp:hourly:${email.toLowerCase().trim()}`;
  }

  /** Generate, persist and send a fresh OTP. Rate-limited to 1 per 60s, max 3 per hour. */
  async issue(email: string, purpose: 'forgot' | 'login' = 'forgot'): Promise<{ sent: boolean; devOtp?: string }> {
    const normalized = email.toLowerCase().trim();
    
    // Check if email domain is allowed (no temp mail)
    if (!this.isAllowedDomain(normalized)) {
      throw new BadRequestException('Please use a valid email provider (Gmail, Yahoo, Outlook, etc.). Temporary/disposable emails are not allowed.');
    }

    // Check resend cooldown (60 seconds)
    const existingTtl = await this.redis.ttl(this.key(normalized));
    if (existingTtl > OTP_TTL_SECONDS - RESEND_COOLDOWN_SECONDS) {
      const waitTime = existingTtl - (OTP_TTL_SECONDS - RESEND_COOLDOWN_SECONDS);
      throw new BadRequestException(
        `OTP already sent recently. Please wait ${waitTime} seconds before requesting another.`,
      );
    }

    // Check hourly limit for forgot password
    if (purpose === 'forgot') {
      const hourlyCount = await this.redis.get(this.hourlyCountKey(normalized));
      if (hourlyCount && parseInt(hourlyCount, 10) >= HOURLY_LIMIT) {
        const ttl = await this.redis.ttl(this.hourlyCountKey(normalized));
        const waitMinutes = Math.ceil(ttl / 60);
        throw new BadRequestException(
          `Too many reset requests. Please wait ${waitMinutes} minute(s) before trying again. Maximum 3 reset OTPs per hour.`,
        );
      }
    }

    const code = randomInt(100000, 1000000).toString();
    await this.redis.setex(this.key(normalized), OTP_TTL_SECONDS, code);
    await this.redis.del(this.attemptKey(normalized));

    // Increment hourly counter for forgot password
    if (purpose === 'forgot') {
      const current = await this.redis.incr(this.hourlyCountKey(normalized));
      if (current === 1) {
        await this.redis.expire(this.hourlyCountKey(normalized), HOURLY_WINDOW_SECONDS);
      }
    }

    await this.mail.sendOtpEmail(normalized, code);

    const devMode = this.config.get<string>('NODE_ENV') !== 'production';
    return {
      sent: true,
      // Dev convenience only — never returned in production.
      ...(devMode && this.mail.isConfigured === false ? { devOtp: code } : {}),
    };
  }

  /** Verify a code; consumes it on success, counts failures (max 5). */
  async verify(email: string, code: string): Promise<boolean> {
    const normalized = email.toLowerCase().trim();
    const attempts = await this.redis.incr(this.attemptKey(normalized));
    if (attempts === 1) {
      await this.redis.expire(this.attemptKey(normalized), OTP_TTL_SECONDS);
    }
    if (attempts > MAX_ATTEMPTS) {
      throw new BadRequestException('Too many OTP attempts. Request a new code.');
    }

    const stored = await this.redis.get(this.key(normalized));
    if (!stored || stored !== code.trim()) {
      this.logger.warn(`OTP mismatch for ${normalized} (attempt ${attempts}/${MAX_ATTEMPTS})`);
      return false;
    }

    // Single-use: delete both code and attempt counter on success.
    await this.redis.del(this.key(normalized));
    await this.redis.del(this.attemptKey(normalized));
    return true;
  }

  /** Check if email domain is allowed (no temp/disposable emails) */
  private isAllowedDomain(email: string): boolean {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return false;

    // List of blocked disposable/temporary email domains
    const blockedDomains = [
      'tempmail.com', 'temp-mail.org', 'guerrillamail.com', '10minutemail.com',
      'mailinator.com', 'throwawaymail.com', 'yopmail.com', 'dispostable.com',
      'fakeinbox.com', 'trashmail.com', 'getnada.com', 'maildrop.cc',
      'sharklasers.com', 'grr.la', 'spamgourmet.com', 'mintemail.com',
      'tempmail.net', 'tempmail.io', 'tempmail.plus', 'inboxkitten.com',
      'fakemailgenerator.com', 'emailondeck.com', 'getairmail.com',
      'dropmail.me', 'boxmail.xyz', 'wuzupmail.net', 'tempr.email',
      'tempemail.co', 'bccto.me', 'chacuo.net', 'mailcatch.com',
      'fakemail.net', 'spam4.me', 'spambox.us', 'spamcannon.com',
      'spamcowboy.com', 'spamcrackers.com', 'spamgourmet.net',
      'spamhole.com', 'spaminator.de', 'spamkill.info', 'spaml.com',
      'spaml.de', 'spammer.com', 'spammers.dk', 'spambog.com',
      'spambog.de', 'spambog.ru', 'spambog.com', 'spamday.com',
      'spamex.com', 'spamfree24.com', 'spamfree24.de', 'spamfree24.eu',
      'spamfree24.net', 'spamfree24.org', 'spamgourmet.org',
      'spamherelots.com', 'spamhereplease.com', 'spamhere.org',
      'spamhole.com', 'spamkill.net', 'spammonitor.net', 'spamnesty.com',
      'spamspot.com', 'spamstack.net', 'spamthis.co', 'spamthisplease.com',
    ];

    if (blockedDomains.includes(domain)) {
      return false;
    }

    // Allow major providers
    const allowedDomains = [
      'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.co.uk',
      'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
      'icloud.com', 'me.com', 'mac.com',
      'protonmail.com', 'proton.me',
      'zoho.com', 'zohomail.com',
      'aol.com', 'aim.com',
      'mail.com', 'email.com',
      'gmx.com', 'gmx.de', 'gmx.net',
      'web.de', 't-online.de',
      'yandex.com', 'yandex.ru',
      'rediffmail.com', 'indiatimes.com',
      'company.com', 'organization.com', // common corporate patterns
    ];

    // Allow common corporate/educational domains
    const commonSuffixes = [
      '.edu', '.ac.in', '.gov.in', '.nic.in', '.org', '.net', '.co.in', '.in'
    ];

    // Check if exact match or subdomain of allowed
    if (allowedDomains.includes(domain)) return true;
    
    // Check common suffixes (educational, gov, org)
    for (const suffix of commonSuffixes) {
      if (domain.endsWith(suffix)) return true;
    }

    // Block suspicious patterns
    if (domain.includes('temp') || domain.includes('disposable') || domain.includes('throwaway') || domain.includes('fake') || domain.includes('trash') || domain.includes('spam')) {
      return false;
    }

    // Allow other domains by default (but not temp mail)
    return true;
  }
}
