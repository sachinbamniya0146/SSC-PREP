import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { randomBytes } from 'crypto';

const RESET_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

@Injectable()
export class PasswordResetService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  private key(email: string): string {
    return `reset:${email.toLowerCase().trim()}`;
  }

  async issue(email: string): Promise<{ sent: boolean; token?: string }> {
    const normalized = email.toLowerCase().trim();
    // Generate a random token (URL-safe, 32 bytes -> 43 chars in base64)
    const token = randomBytes(32).toString('base64url');
    // Store the token in Redis with expiry
    await this.redis.set(this.key(normalized), token, 'EX', RESET_TOKEN_TTL_SECONDS);
    // Always indicate that we sent the email (to avoid leaking whether the email exists)
    // In a real application, you would actually send an email here.
    // For now, we return the token so the auth service can use it to send the email.
    return { sent: true, token };
  }

  async verify(email: string, token: string): Promise<boolean> {
    const normalized = email.toLowerCase().trim();
    const stored = await this.redis.get(this.key(normalized));
    if (stored === null) {
      // Token not found or expired
      return false;
    }
    // Compare the tokens (constant-time comparison to avoid timing attacks)
    const match = this.constantTimeEquals(stored, token);
    if (match) {
      // Token is valid, delete it to make it single-use
      await this.redis.del(this.key(normalized));
    }
    return match;
  }

  // Constant-time comparison to prevent timing attacks
  private constantTimeEquals(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }
}