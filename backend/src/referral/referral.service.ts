import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes } from 'crypto';

const REFERRAL_REWARD_THRESHOLD = 10; // 10 PAID referrals = free subscription

@Injectable()
export class ReferralService {
  constructor(private prisma: PrismaService) {}

  /** Generate a unique referral code for a user (idempotent). */
  async getOrCreateCode(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (user.referralCode) return user.referralCode;

    // 8-char alphanumeric code, retry on collision
    for (let i = 0; i < 5; i++) {
      const code = randomBytes(4).toString('hex').toUpperCase();
      const exists = await this.prisma.user.findUnique({ where: { referralCode: code } });
      if (!exists) {
        await this.prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
        return code;
      }
    }
    throw new ConflictException('Could not allocate referral code, retry');
  }

  /** Apply a referral code at signup/registration. */
  async applyReferralCode(referrerCode: string, refereeId: string): Promise<boolean> {
    if (!referrerCode) return false;
    const referrer = await this.prisma.user.findUnique({ where: { referralCode: referrerCode } });
    if (!referrer) return false;
    if (referrer.id === refereeId) return false; // can't refer yourself

    const existing = await this.prisma.referral.findUnique({
      where: { referrerId_refereeId: { referrerId: referrer.id, refereeId: refereeId } },
    });
    if (existing) return true; // already tracked

    await this.prisma.referral.create({
      data: { referrerId: referrer.id, refereeId },
    });
    await this.prisma.user.update({
      where: { id: refereeId },
      data: { referredByCode: referrerCode },
    });
    return true;
  }

  /** Called when a referee makes a PAID purchase — only PAID counts toward reward. */
  async onPaidPurchase(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.referredByCode) return;
    const referrer = await this.prisma.user.findUnique({
      where: { referralCode: user.referredByCode },
    });
    if (!referrer) return;

    const referral = await this.prisma.referral.findUnique({
      where: { referrerId_refereeId: { referrerId: referrer.id, refereeId: userId } },
    });
    if (!referral) return;

    const updated = await this.prisma.referral.update({
      where: { id: referral.id },
      data: {
        purchasesCount: { increment: 1 },
        status: 'PAIDED',
      },
    });

    // Reward: 10 PAID referrals → grant free subscription
    if (updated.purchasesCount >= REFERRAL_REWARD_THRESHOLD && updated.status !== 'REWARDED') {
      await this.prisma.referral.update({
        where: { id: referral.id },
        data: { status: 'REWARDED', rewardedAt: new Date() },
      });
      await this.prisma.user.update({
        where: { id: referrer.id },
        data: { freeSubFromReferral: true },
      });
      // Create a free 30-day subscription
      const plan = await this.prisma.plan.findFirst({ where: { isActive: true } });
      if (plan) {
        const now = new Date();
        const ends = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
        await this.prisma.subscription.create({
          data: { userId: referrer.id, planId: plan.id, status: 'ACTIVE', startsAt: now, endsAt: ends },
        });
      }
    }
  }

  /** Referral dashboard stats: how many referred, how many purchased, reward progress. */
  async getStats(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    const code = user.referralCode ?? (await this.getOrCreateCode(userId));

    const referrals = await this.prisma.referral.findMany({
      where: { referrerId: userId },
      include: { referee: { select: { id: true, fullName: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const paidCount = referrals.filter((r) => r.status !== 'PENDING').length;
    const totalPurchases = referrals.reduce((s, r) => s + r.purchasesCount, 0);
    const progress = Math.min(100, Math.round((paidCount / REFERRAL_REWARD_THRESHOLD) * 100));

    return {
      referralCode: code,
      shareLink: `https://sscprephub.in/register?ref=${code}`,
      stats: {
        totalReferrals: referrals.length,
        paidReferrals: paidCount,
        totalPurchases,
        rewardThreshold: REFERRAL_REWARD_THRESHOLD,
        progressPercent: progress,
        rewarded: user.freeSubFromReferral,
      },
      referrals: referrals.map((r) => ({
        id: r.id,
        refereeName: r.referee.fullName,
        joinedAt: r.referee.createdAt,
        purchases: r.purchasesCount,
        status: r.status,
      })),
    };
  }
}
