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
const MAX_ATTEMPTS = 5;

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

  /** Generate, persist and send a fresh OTP. Rate-limited to 1 per 60s. */
  async issue(email: string): Promise<{ sent: boolean; devOtp?: string }> {
    const normalized = email.toLowerCase().trim();
    const existing = await this.redis.ttl(this.key(normalized));
    if (existing > 50) {
      throw new BadRequestException(
        'OTP already sent recently. Please wait before requesting another.',
      );
    }

    const code = randomInt(100000, 1000000).toString();
    await this.redis.setex(this.key(normalized), OTP_TTL_SECONDS, code);
    await this.redis.del(this.attemptKey(normalized));

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
}
