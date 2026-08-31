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

  /**
   * Called when a referee makes a PAID purchase — only PAID counts toward reward.
   *
   * FIX #1 (wrong threshold, feature basically never worked): the reward is
   * documented — everywhere else in this file, in getStats() below, and in
   * the ReferralStatus comment in schema.prisma — as "10 DISTINCT referred
   * users who paid". The old code instead compared `purchasesCount` on this
   * ONE referral row (i.e. how many times THIS SAME referee re-purchased)
   * against the threshold. A referrer with 50 different paying friends would
   * never see a reward, since no single referee re-buys 10 times. Fixed to
   * count distinct referrals with status PAIDED/REWARDED for this referrer.
   *
   * FIX #2 (race → duplicate free subscriptions): reward-granting was a
   * classic "check status !== REWARDED, then later write REWARDED" pattern
   * with no atomicity. If a referrer's last two qualifying referees paid at
   * nearly the same moment, both requests could read the pre-reward state,
   * both pass the check, and both go on to create a free Subscription row —
   * double (or more) rewarding the same referrer. Fixed with the same
   * atomic-claim pattern used for coupon over-redemption in
   * monetization.service.ts: an `updateMany` conditioned on
   * `freeSubFromReferral: false` acts as a compare-and-swap — only the
   * request whose update actually flips the flag (count === 1) proceeds to
   * mark the referral REWARDED and create the subscription; any concurrent
   * loser sees count === 0 and backs off.
   */
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

    // Atomic per-referral counter bump. Never downgrade a referral that has
    // already been counted toward (or already earned) the reward.
    await this.prisma.referral.update({
      where: { id: referral.id },
      data: {
        purchasesCount: { increment: 1 },
        status: referral.status === 'REWARDED' ? undefined : 'PAIDED',
      },
    });

    if (referrer.freeSubFromReferral) return; // already rewarded, nothing to do

    // Reward rule is "N distinct paid referrals", not "N purchases from one
    // referee" — count how many of this referrer's referrals have ever gone
    // PAID or REWARDED.
    const paidReferralsCount = await this.prisma.referral.count({
      where: { referrerId: referrer.id, status: { in: ['PAIDED', 'REWARDED'] } },
    });
    if (paidReferralsCount < REFERRAL_REWARD_THRESHOLD) return;

    // Atomic claim: of any concurrent callers that reach here for the same
    // referrer, only the one whose updateMany actually flips false -> true
    // gets count === 1 and proceeds. Everyone else gets 0 and returns.
    const claim = await this.prisma.user.updateMany({
      where: { id: referrer.id, freeSubFromReferral: false },
      data: { freeSubFromReferral: true },
    });
    if (claim.count === 0) return;

    await this.prisma.referral.update({
      where: { id: referral.id },
      data: { status: 'REWARDED', rewardedAt: new Date() },
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
      // BUG FIX (audit round 3, signup-page item): this pointed to
      // /register, which is not a route anywhere in the frontend (the real
      // signup route is /signup) — every referral link ever shared 404'd.
      // Fixed to /signup?ref=CODE, which the signup page now reads on load.
      shareLink: `https://sscprephub.in/signup?ref=${code}`,
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
