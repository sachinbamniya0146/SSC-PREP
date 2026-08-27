import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import * as jwt from 'jsonwebtoken';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { MailService } from './mail.service';
import { OtpService } from './otp.service';
import { ReferralService } from '../referral/referral.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthenticatedSession {
  user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    hintQuota?: number;
  };
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

export type Authenticated = AuthenticatedSession;

const ACCESS_TTL_SECONDS_DEFAULT = 15 * 60;

/**
 * AuthService — signup/login/refresh/logout, password reset OTP, Google OAuth,
 * and single-device session enforcement (1 WEB + 1 APP session max).
 */
@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly otp: OtpService,
    private readonly referralService: ReferralService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedAdmin();
  }

  /** Seed the admin account from env (idempotent). */
  private async seedAdmin(): Promise<void> {
    const email = this.config.get<string>('ADMIN_DEFAULT_EMAIL');
    const password = this.config.get<string>('ADMIN_DEFAULT_PASSWORD');
    if (!email || !password) return;

    const normalized = email.toLowerCase().trim();
    const existing = await this.prisma.user.findFirst({ where: { email: { equals: normalized, mode: 'insensitive' } } });
    if (existing) return;

    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.user.create({
      data: {
        email: normalized,
        fullName: 'Platform Admin',
        passwordHash,
        role: 'ADMIN',
        isEmailVerified: true,
      },
    });
    this.logger.log(`Seeded admin account: ${normalized}`);
  }

  // ---------------------------------------------------------------- signup

  async signup(
    email: string,
    password: string,
    fullName: string,
    phone: string,
    platform: 'WEB' | 'APP' = 'WEB',
    referralCode?: string,
  ): Promise<Authenticated> {
    const normalized = email.toLowerCase().trim();
    const normalizedPhone = phone.trim();
    
    // Check if email domain is allowed
    if (!this.isAllowedDomain(normalized)) {
      throw new ForbiddenException('Please use a valid email provider (Gmail, Yahoo, Outlook, etc.). Temporary/disposable emails are not allowed.');
    }
    
    const existing = await this.prisma.user.findFirst({ where: { email: { equals: normalized, mode: 'insensitive' } } });
    if (existing) throw new ConflictException('Email already registered');

    // Check if phone is already registered
    const existingPhone = await this.prisma.user.findFirst({ where: { phone: normalizedPhone } });
    if (existingPhone) throw new ConflictException('This mobile number is already registered');

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.prisma.user.create({
      data: { email: normalized, fullName, phone: normalizedPhone, passwordHash },
    });

    // Apply referral code if provided
    if (referralCode) {
      await this.referralService.applyReferralCode(referralCode, user.id);
    }

    return this.completeAuth(user, platform);
  }

  // ----------------------------------------------------------------- login

  async login(
    email: string,
    password: string,
    platform: 'WEB' | 'APP' = 'WEB',
    deviceId?: string,
    userAgent?: string,
  ): Promise<Authenticated> {
    const normalized = email.toLowerCase().trim();
    const user = await this.prisma.user.findFirst({ where: { email: { equals: normalized, mode: 'insensitive' } } });
    if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.completeAuth(user, platform, deviceId, userAgent);
  }

  // ------------------------------------------------------- password reset (OTP)

  /** Step 1: send a reset OTP to the user's email (account must exist). */
  async forgotPassword(email: string): Promise<{ sent: boolean; devOtp?: string }> {
    const normalized = email.toLowerCase().trim();
    const user = await this.prisma.user.findFirst({ where: { email: { equals: normalized, mode: 'insensitive' } } });
    if (!user) {
      // Do not leak which emails have accounts — same response either way.
      return { sent: true };
    }
    return this.otp.issue(normalized, 'forgot');
  }

  /** Step 2: verify OTP + set a new password. OTP is single-use. */
  async resetPassword(email: string, code: string, newPassword: string, confirmPassword: string): Promise<{ ok: true }> {
    const normalized = email.toLowerCase().trim();
    const user = await this.prisma.user.findFirst({ where: { email: { equals: normalized, mode: 'insensitive' } } });
    if (!user) throw new UnauthorizedException('User not found');

    if (newPassword !== confirmPassword) {
      throw new ConflictException('New password and confirm password do not match');
    }

    const ok = await this.otp.verify(normalized, code);
    if (!ok) throw new UnauthorizedException('Invalid or expired OTP');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
    return { ok: true };
  }

  // ------------------------------------------------------- password change (logged in)

  async changePassword(userId: string, currentPassword: string, newPassword: string, confirmPassword: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (currentPassword === newPassword) {
      throw new ConflictException('New password must be different from current password');
    }

    if (newPassword !== confirmPassword) {
      throw new ConflictException('New password and confirm password do not match');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    // Revoke all refresh tokens to force re-login
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    // Revoke all device sessions
    await this.prisma.deviceSession.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });

    return { ok: true };
  }

  // ------------------------------------------------------------------ Google

  async googleLogin(
    idToken: string,
    platform: 'WEB' | 'APP' = 'WEB',
  ): Promise<Authenticated> {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new ForbiddenException('Google login not configured on the server');
    }
    const client = new OAuth2Client(clientId, clientSecret);
    let ticket;
    try {
      ticket = await client.verifyIdToken({
        idToken,
        audience: clientId,
      });
    } catch {
      throw new UnauthorizedException('Invalid Google ID token');
    }
    const payload = ticket.getPayload();
    if (!payload?.email) {
      throw new UnauthorizedException('Google token missing email');
    }
    const email = payload.email.toLowerCase().trim();
    let user = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email,
          fullName: payload.name || email.split('@')[0] || 'User',
          passwordHash: 'oauth:' + randomBytes(24).toString('hex'),
          isEmailVerified: payload.email_verified === true,
          avatarUrl: payload.picture || null,
        },
      });
    }
    return this.completeAuth(user, platform);
  }

  // ------------------------------------------------------------------ refresh

  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: { sub: string; type: string; sid?: string; jwtid?: string };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (payload.type !== 'refresh' || !payload.sub || !payload.sid) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Verify the stored refresh token row is present & not revoked.
    const hash = createHash('sha256').update(refreshToken).digest('hex');
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!stored || stored.revokedAt) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }
    if (new Date(stored.expiresAt) < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // FIX Error #4: even if the refresh token row itself isn't revoked,
    // the DeviceSession it belongs to might have been deactivated by a
    // newer login elsewhere. Previously this was never checked here,
    // which is exactly how an old device could keep silently refreshing
    // forever after being "logged out" on paper.
    const session = await this.prisma.deviceSession.findUnique({
      where: { id: payload.sid },
    });
    if (!session || !session.isActive) {
      throw new UnauthorizedException('Session has been logged out');
    }

    // Rotation: revoke current, issue new pair bound to the same session.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException('User no longer exists');

    const pair = this.issueTokens(user.id, user.email, user.role, payload.sid);
    const newHash = createHash('sha256').update(pair.refreshToken).digest('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: newHash,
        expiresAt: this.refreshExpiryDate(),
        deviceSessionId: payload.sid,
      },
    });
    return pair;
  }

  // ------------------------------------------------------------------ logout

  /**
   * v2 §16 — entitlement summary for the client (upsell + gating hints).
   * Free tier: 10 daily quiz questions/day (1 quiz), 100 bookmarks, basic
   * analytics. Premium (ACTIVE subscription): everything unlimited.
   */
  async entitlements(userId: string) {
    const [user, bookmarkCount, todayQuiz] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { 
          role: true, 
          subscriptions: { 
            where: { status: 'ACTIVE' }, 
            select: { 
              planId: true, 
              status: true, 
              startsAt: true, 
              endsAt: true 
            }, 
            take: 1 
          } 
        },
      }),
      this.prisma.bookmark.count({ where: { userId } }),
      (async () => {
        const t = new Date();
        t.setHours(0, 0, 0, 0);
        const q = await this.prisma.dailyQuiz.findUnique({ where: { date: t } });
        if (!q) return null;
        const a = await this.prisma.dailyQuizAttempt.findUnique({
          where: { userId_dailyQuizId: { userId, dailyQuizId: q.id } },
          select: { id: true, score: true },
        });
        return a ? { taken: true, score: a.score } : { taken: false };
      })(),
    ]);

    const isPremium =
      user?.role === 'ADMIN' ||
      (user?.subscriptions?.[0] != null && new Date(user.subscriptions[0].endsAt) > new Date());

    const subscription = user?.subscriptions?.[0] ? {
      planId: user.subscriptions[0].planId,
      status: user.subscriptions[0].status,
      startsAt: user.subscriptions[0].startsAt,
      endsAt: user.subscriptions[0].endsAt,
    } : null;

    return {
      isPremium,
      plan: isPremium ? (user?.role === 'ADMIN' ? 'ADMIN' : 'PREMIUM') : 'FREE',
      subscription,
      bookmarks: { used: bookmarkCount, limit: isPremium ? null : 100 },
      dailyQuiz: todayQuiz ?? { taken: false },
      message: isPremium
        ? undefined
        : 'Upgrade to Premium for unlimited bookmarks, all mocks and deeper analytics.',
    };
  }

  async logout(refreshToken: string, sessionId?: string): Promise<void> {
    const hash = createHash('sha256').update(refreshToken).digest('hex');
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (sessionId) {
      await this.prisma.deviceSession.updateMany({
        where: { id: sessionId, isActive: true },
        data: { isActive: false },
      });
      const keys = await this.redis.keys(`session:*:${sessionId}`);
      if (keys.length) await this.redis.del(...keys);
    }
  }

  // ------------------------------------------------------------------ internals

  private async completeAuth(
    user: {
      id: string;
      email: string;
      fullName: string;
      role: string;
      hintQuota?: number;
    },
    platform: 'WEB' | 'APP',
    deviceId?: string,
    userAgent?: string,
  ): Promise<Authenticated> {
    // Single-device enforcement: revoke previous active session for this
    // user+platform, both in DB and Redis, then create the new one.
    const old = await this.prisma.deviceSession.findFirst({
      where: { userId: user.id, platform, isActive: true },
    });
    if (old) {
      // FIX Error #4: previously only DeviceSession.isActive was flipped to
      // false, but that flag was never actually checked anywhere, and the
      // old device's refresh token was never revoked - so the old device
      // kept working (access token until natural expiry, and could keep
      // refreshing forever) even after a new device logged in. Now we also
      // revoke every un-revoked refresh token tied to that old session.
      await this.prisma.$transaction([
        this.prisma.deviceSession.update({
          where: { id: old.id },
          data: { isActive: false },
        }),
        this.prisma.refreshToken.updateMany({
          where: { deviceSessionId: old.id, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);
      const oldKeys = await this.redis.keys(`user:${user.id}:*:${old.id}`);
      if (oldKeys.length) await this.redis.del(...oldKeys);
    }

    const session = await this.prisma.deviceSession.create({
      data: {
        userId: user.id,
        platform: platform as 'WEB' | 'APP',
        deviceId: deviceId || `dev-${Date.now()}`,
        userAgent: userAgent || null,
      },
    });

    // Redis session registry keyed by user+platform so expiry can be probed.
    await this.redis.setex(
      `user:${user.id}:${platform}:${session.id}`,
      ACCESS_TTL_SECONDS_DEFAULT,
      '1',
    );

    const pair = this.issueTokens(user.id, user.email, user.role, session.id);
    const tokenHash = createHash('sha256').update(pair.refreshToken).digest('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: this.refreshExpiryDate(),
        // FIX Error #4: link this refresh token to the session it belongs
        // to, so a future login on another device can revoke it precisely.
        deviceSessionId: session.id,
      },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        hintQuota: user.hintQuota ?? 3,
      },
      ...pair,
      sessionId: session.id,
    };
  }

  private issueTokens(
    userId: string,
    email: string,
    role: string,
    sid: string,
  ): TokenPair {
    const now = Math.floor(Date.now() / 1000);
    const accessSec = this.parseAccessSeconds(
      this.config.get<string>('JWT_ACCESS_EXPIRES_IN') || '15m',
      ACCESS_TTL_SECONDS_DEFAULT,
    );
    const accessSecret = this.config.get<string>('JWT_ACCESS_SECRET') || this.config.get<string>('JWT_SECRET') || '';
    const refreshSecret = this.config.get<string>('JWT_REFRESH_SECRET') as string;
    const base = {
      sub: userId,
      email,
      role,
      sid,
      iat: now,
    } as object;
    const accessToken = jwt.sign(
      { ...base, type: 'access' } as object,
      accessSecret,
      { expiresIn: accessSec } as jwt.SignOptions,
    );
    const refreshToken = jwt.sign(
      { ...base, type: 'refresh', jti: randomBytes(8).toString('hex') } as object,
      refreshSecret,
      {
        expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d',
      } as jwt.SignOptions,
    );
    return { accessToken, refreshToken };
  }

  private parseAccessSeconds(value: string, fallback: number): number {
    const m = /^(\d+)\s*([smhd]?)$/.exec(value.trim());
    if (!m) return fallback;
    const n = parseInt(m[1], 10);
    switch (m[2]) {
      case 's': return n;
      case 'm': return n * 60;
      case 'h': return n * 3600;
      case 'd': return n * 86400;
      default: return n;
    }
  }

  private refreshExpiryDate(): Date {
    const v = this.config.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d';
    const days = v.endsWith('d')
      ? parseInt(v, 10)
      : v.endsWith('w')
        ? parseInt(v, 10) * 7
        : v.endsWith('h')
          ? Math.floor(parseInt(v, 10) / 24)
          : 7;
    return new Date(Date.now() + days * 86400 * 1000);
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