import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { MailService } from './mail.service';

const OTP_TTL_SECONDS = 10 * 60; // 10 min
const COOLDOWN_SECONDS = 60; // 60 seconds
const MAX_ATTEMPTS = 5;

/**
 * OtpService — Redis-backed email OTP with rate limiting (5 attempts) and
 * 10-minute expiry. OTP is stored as a SHA-256 hash; plaintext OTP is never persisted.
 * Resend cooldown: 60 seconds.
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

  /**
   * Generate, persist (as hash) and send a fresh OTP. Rate-limited to 1 per 60s.
   */
  async issue(email: string): Promise<{ sent: boolean; devOtp?: string }> {
    const normalized = email.toLowerCase().trim();
    const ttl = await this.redis.ttl(this.key(normalized));
    // If TTL exists and is greater than (OTP_TTL_SECONDS - COOLDOWN_SECONDS),
    // then less than COOLDOWN_SECONDS have passed since the last OTP.
    if (ttl !== -1 && ttl > OTP_TTL_SECONDS - COOLDOWN_SECONDS) {
      throw new BadRequestException(
        'OTP already sent recently. Please wait before requesting another.',
      );
    }

    const otp = randomInt(100000, 1000000).toString();
    const hash = createHash('sha256').update(otp).digest('hex');
    await this.redis.setex(this.key(normalized), OTP_TTL_SECONDS, hash);
    await this.redis.del(this.attemptKey(normalized));

    await this.mail.sendOtpEmail(normalized, otp);

    const devMode = this.config.get<string>('NODE_ENV') !== 'production';
    return {
      sent: true,
      ...(devMode && { devOtp: otp }),
    };
  }

  /**
   * Verify a code; consumes it on success, counts failures (max 5).
   */
  async verify(email: string, code: string): Promise<boolean> {
    const normalized = email.toLowerCase().trim();
    const attempts = await this.redis.incr(this.attemptKey(normalized));
    if (attempts === 1) {
      await this.redis.expire(this.attemptKey(normalized), OTP_TTL_SECONDS);
    }
    if (attempts > MAX_ATTEMPTS) {
      throw new BadRequestException('Too many OTP attempts. Request a new code.');
    }

    const hash = await this.redis.get(this.key(normalized));
    if (!hash) {
      // No OTP found or expired
      return false;
    }

    const computedHash = createHash('sha256').update(code.trim()).digest('hex');
    const ok = hash === computedHash;

    if (ok) {
      // Single-use: delete both hash and attempt counter on success.
      await this.redis.del(this.key(normalized));
      await this.redis.del(this.attemptKey(normalized));
    }
    return ok;
  }
}