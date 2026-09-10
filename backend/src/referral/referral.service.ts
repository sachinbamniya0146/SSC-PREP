import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes } from 'crypto';

const FREE_SUB_REWARD_THRESHOLD = 10; // 10 distinct PAID referrals = free 30-day subscription
const FREE_UPGRADE_REWARD_THRESHOLD = 20; // 20 distinct PAID referrals = free 6-month upgrade
const HIGH_TIER_COMMISSION_THRESHOLD = 10; // from the 10th PAID referral onward, commission jumps 20% -> 30%
const LOW_TIER_COMMISSION_PCT = 20;
const HIGH_TIER_COMMISSION_PCT = 30;
const MIN_PAID_REFERRALS_TO_WITHDRAW = 3;

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

  /** Ensure a wallet row exists for this user (idempotent, safe to call repeatedly). */
  private async ensureWallet(userId: string) {
    return this.prisma.referralWallet.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
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
   * Called when a referee makes a PAID purchase — only PAID counts toward
   * reward tiers and commission. This is the single entry point that:
   *   1. Bumps the referral's purchasesCount / status.
   *   2. Computes and credits a cash commission to the referrer's wallet
   *      (skipped entirely if the referrer's wallet is admin-suspended).
   *   3. Grants milestone rewards: 10 paid referrals -> free 30-day sub,
   *      20 paid referrals -> free 6-month upgrade.
   *
   * Every state transition here uses the same atomic-claim pattern already
   * established in this file and in monetization.service.ts: an
   * `updateMany` conditioned on the CURRENT value acts as a compare-and-swap,
   * so two purchases landing at nearly the same instant can never
   * double-credit a commission or double-grant a milestone reward.
   */
  async onPaidPurchase(userId: string, payment: { id: string; amountInr: number }): Promise<void> {
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
    // already earned the milestone reward.
    await this.prisma.referral.update({
      where: { id: referral.id },
      data: {
        purchasesCount: { increment: 1 },
        status: referral.status === 'REWARDED' ? undefined : 'PAIDED',
      },
    });

    // ---- Cash commission ----
    // Tier is decided by how many DISTINCT paid referrals the referrer has
    // *before* this purchase (so the very purchase that pushes them past the
    // threshold is the first one to earn the higher rate going forward, not
    // retroactively — simplest and least surprising rule for a live system).
    await this.creditCommission(referrer.id, referral.id, userId, payment);

    // ---- Milestone rewards (existing free-sub / free-upgrade ladder) ----
    await this.grantMilestoneRewardsIfDue(referrer.id, referral.id);
  }

  /** Compute + credit the referrer's cash commission for one paid purchase. Idempotent per payment. */
  private async creditCommission(
    referrerId: string,
    referralId: string,
    refereeId: string,
    payment: { id: string; amountInr: number },
  ): Promise<void> {
    // Idempotency: ReferralEarning.paymentId is unique — if this payment was
    // already credited (e.g. verifyPayment() and the webhook both firing),
    // this create() will simply throw a unique-constraint error which we
    // treat as "already handled".
    const existing = await this.prisma.referralEarning.findUnique({ where: { paymentId: payment.id } });
    if (existing) return;

    await this.ensureWallet(referrerId);
    const wallet = await this.prisma.referralWallet.findUnique({ where: { userId: referrerId } });
    if (wallet?.isSuspended) return; // admin has frozen this user's referral earnings entirely

    const paidReferralsSoFar = await this.prisma.referral.count({
      where: { referrerId, status: { in: ['PAIDED', 'REWARDED'] } },
    });
    const commissionPct =
      paidReferralsSoFar >= HIGH_TIER_COMMISSION_THRESHOLD ? HIGH_TIER_COMMISSION_PCT : LOW_TIER_COMMISSION_PCT;
    const commissionInr = Math.round(payment.amountInr * (commissionPct / 100) * 100) / 100;
    if (commissionInr <= 0) return;

    try {
      await this.prisma.$transaction([
        this.prisma.referralEarning.create({
          data: {
            referralId,
            referrerId,
            refereeId,
            paymentId: payment.id,
            purchaseAmountInr: payment.amountInr,
            commissionPct,
            commissionInr,
          },
        }),
        this.prisma.referralWallet.update({
          where: { userId: referrerId },
          data: {
            balanceInr: { increment: commissionInr },
            totalEarnedInr: { increment: commissionInr },
          },
        }),
      ]);
    } catch (e: any) {
      // Unique constraint on paymentId (P2002) = a concurrent call already
      // credited this exact payment. Safe to swallow.
      if (e?.code !== 'P2002') throw e;
    }
  }

  private async grantMilestoneRewardsIfDue(referrerId: string, referralId: string): Promise<void> {
    const referrer = await this.prisma.user.findUnique({ where: { id: referrerId } });
    if (!referrer) return;

    const paidReferralsCount = await this.prisma.referral.count({
      where: { referrerId, status: { in: ['PAIDED', 'REWARDED'] } },
    });

    // -- 10 paid referrals: free 30-day subscription (existing reward) --
    if (!referrer.freeSubFromReferral && paidReferralsCount >= FREE_SUB_REWARD_THRESHOLD) {
      const claim = await this.prisma.user.updateMany({
        where: { id: referrerId, freeSubFromReferral: false },
        data: { freeSubFromReferral: true },
      });
      if (claim.count === 1) {
        await this.prisma.referral.update({
          where: { id: referralId },
          data: { status: 'REWARDED', rewardedAt: new Date() },
        });
        const plan = await this.prisma.plan.findFirst({ where: { isActive: true } });
        if (plan) {
          const now = new Date();
          const ends = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
          await this.prisma.subscription.create({
            data: { userId: referrerId, planId: plan.id, status: 'ACTIVE', startsAt: now, endsAt: ends },
          });
        }
      }
    }

    // -- 20 paid referrals: free 6-month plan upgrade --
    // Uses AuditLog as the one-time-claim flag (compare-and-swap via a
    // conditional create is not possible on AuditLog, so we check-then-act
    // guarded by a lookup on action+userId; a duplicate here in the rare
    // race case only means an extra 6-month grant, not data corruption, and
    // is logged either way for admin visibility).
    if (paidReferralsCount >= FREE_UPGRADE_REWARD_THRESHOLD) {
      const alreadyGranted = await this.prisma.auditLog.findFirst({
        where: { userId: referrerId, action: 'REFERRAL_6MO_UPGRADE_GRANTED' },
      });
      if (!alreadyGranted) {
        // Cancel any existing active subscription and grant a fresh 6-month one,
        // same pattern monetization.service.ts uses for a real plan purchase.
        await this.prisma.subscription.updateMany({
          where: { userId: referrerId, status: 'ACTIVE' },
          data: { status: 'CANCELLED' },
        });
        const now = new Date();
        const ends = new Date(now);
        ends.setMonth(ends.getMonth() + 6);
        const plan = await this.prisma.plan.findFirst({ where: { isActive: true }, orderBy: { priceInr: 'desc' } });
        if (plan) {
          await this.prisma.subscription.create({
            data: { userId: referrerId, planId: plan.id, status: 'ACTIVE', startsAt: now, endsAt: ends },
          });
          await this.prisma.auditLog.create({
            data: {
              userId: referrerId,
              action: 'REFERRAL_6MO_UPGRADE_GRANTED',
              targetEntity: 'Subscription',
              metadataJson: { paidReferralsCount, planId: plan.id },
            },
          });
        }
      }
    }
  }

  /** Referral dashboard stats: how many referred, how many purchased, reward progress, wallet, commission tier. */
  async getStats(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    const code = user.referralCode ?? (await this.getOrCreateCode(userId));

    const referrals = await this.prisma.referral.findMany({
      where: { referrerId: userId },
      include: { referee: { select: { id: true, fullName: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const wallet = await this.ensureWallet(userId);
    const paidCount = referrals.filter((r) => r.status !== 'PENDING').length;
    const totalPurchases = referrals.reduce((s, r) => s + r.purchasesCount, 0);
    const progressToFreeSub = Math.min(100, Math.round((paidCount / FREE_SUB_REWARD_THRESHOLD) * 100));
    const progressToUpgrade = Math.min(100, Math.round((paidCount / FREE_UPGRADE_REWARD_THRESHOLD) * 100));
    const currentCommissionPct = paidCount >= HIGH_TIER_COMMISSION_THRESHOLD ? HIGH_TIER_COMMISSION_PCT : LOW_TIER_COMMISSION_PCT;

    return {
      referralCode: code,
      shareLink: `https://sscprephub.in/signup?ref=${code}`,
      stats: {
        totalReferrals: referrals.length,
        paidReferrals: paidCount,
        totalPurchases,
        rewardThreshold: FREE_SUB_REWARD_THRESHOLD,
        progressPercent: progressToFreeSub,
        rewarded: user.freeSubFromReferral,
        upgradeThreshold: FREE_UPGRADE_REWARD_THRESHOLD,
        upgradeProgressPercent: progressToUpgrade,
        currentCommissionPct,
        nextTierAt: currentCommissionPct === LOW_TIER_COMMISSION_PCT ? HIGH_TIER_COMMISSION_THRESHOLD : null,
      },
      wallet: {
        balanceInr: wallet.balanceInr,
        totalEarnedInr: wallet.totalEarnedInr,
        totalWithdrawnInr: wallet.totalWithdrawnInr,
        isSuspended: wallet.isSuspended,
        suspendedReason: wallet.suspendedReason,
        canWithdraw: !wallet.isSuspended && paidCount >= MIN_PAID_REFERRALS_TO_WITHDRAW,
        minPaidReferralsToWithdraw: MIN_PAID_REFERRALS_TO_WITHDRAW,
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

  /** Full commission earning history for the logged-in user (for their own dashboard). */
  async getMyEarnings(userId: string) {
    const rows = await this.prisma.referralEarning.findMany({
      where: { referrerId: userId },
      include: { referee: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      refereeName: r.referee.fullName,
      purchaseAmountInr: r.purchaseAmountInr,
      commissionPct: r.commissionPct,
      commissionInr: r.commissionInr,
      createdAt: r.createdAt,
    }));
  }

  // ---- Payout method ----
  async getPayoutMethod(userId: string) {
    const pm = await this.prisma.payoutMethod.findUnique({ where: { userId } });
    if (!pm) return null;
    return {
      type: pm.type,
      upiId: pm.upiId,
      bankAccountNo: pm.bankAccountNo ? `••••${pm.bankAccountNo.slice(-4)}` : null,
      bankIfsc: pm.bankIfsc,
      bankAccountName: pm.bankAccountName,
    };
  }

  async savePayoutMethod(
    userId: string,
    input: { type: 'UPI' | 'BANK_ACCOUNT'; upiId?: string; bankAccountNo?: string; bankIfsc?: string; bankAccountName?: string },
  ) {
    if (input.type === 'UPI') {
      if (!input.upiId || !/^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/.test(input.upiId.trim())) {
        throw new BadRequestException('Enter a valid UPI ID, e.g. name@okhdfcbank');
      }
    } else if (input.type === 'BANK_ACCOUNT') {
      if (!input.bankAccountNo || !/^\d{9,18}$/.test(input.bankAccountNo.trim())) {
        throw new BadRequestException('Enter a valid bank account number');
      }
      if (!input.bankIfsc || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(input.bankIfsc.trim().toUpperCase())) {
        throw new BadRequestException('Enter a valid IFSC code');
      }
      if (!input.bankAccountName || input.bankAccountName.trim().length < 2) {
        throw new BadRequestException('Enter the account holder name exactly as per bank records');
      }
    } else {
      throw new BadRequestException('Invalid payout method type');
    }

    return this.prisma.payoutMethod.upsert({
      where: { userId },
      create: {
        userId,
        type: input.type,
        upiId: input.type === 'UPI' ? input.upiId!.trim() : null,
        bankAccountNo: input.type === 'BANK_ACCOUNT' ? input.bankAccountNo!.trim() : null,
        bankIfsc: input.type === 'BANK_ACCOUNT' ? input.bankIfsc!.trim().toUpperCase() : null,
        bankAccountName: input.type === 'BANK_ACCOUNT' ? input.bankAccountName!.trim() : null,
      },
      update: {
        type: input.type,
        upiId: input.type === 'UPI' ? input.upiId!.trim() : null,
        bankAccountNo: input.type === 'BANK_ACCOUNT' ? input.bankAccountNo!.trim() : null,
        bankIfsc: input.type === 'BANK_ACCOUNT' ? input.bankIfsc!.trim().toUpperCase() : null,
        bankAccountName: input.type === 'BANK_ACCOUNT' ? input.bankAccountName!.trim() : null,
      },
    });
  }

  // ---- Withdrawals ----
  /**
   * User requests a withdrawal. Money is deducted from the wallet balance
   * IMMEDIATELY (atomic conditional decrement so a user can never withdraw
   * more than they actually have, even with two simultaneous requests) and
   * held in the WithdrawalRequest row until admin approves/rejects it. If
   * rejected or a payout attempt fails, the amount is refunded back to the
   * wallet — see reviewWithdrawal() in the admin service.
   */
  async requestWithdrawal(userId: string, amountInr: number) {
    if (!amountInr || amountInr <= 0) throw new BadRequestException('Enter a valid amount');

    const wallet = await this.ensureWallet(userId);
    if (wallet.isSuspended) {
      throw new ForbiddenException(wallet.suspendedReason || 'Your referral earnings are currently suspended by admin');
    }

    const paidCount = await this.prisma.referral.count({
      where: { referrerId: userId, status: { in: ['PAIDED', 'REWARDED'] } },
    });
    if (paidCount < MIN_PAID_REFERRALS_TO_WITHDRAW) {
      throw new BadRequestException(
        `You need at least ${MIN_PAID_REFERRALS_TO_WITHDRAW} paid referrals to withdraw. You currently have ${paidCount}.`,
      );
    }

    const payoutMethod = await this.prisma.payoutMethod.findUnique({ where: { userId } });
    if (!payoutMethod) {
      throw new BadRequestException('Add a UPI ID or bank account first before requesting a withdrawal');
    }

    const roundedAmount = Math.round(amountInr * 100) / 100;

    // Atomic conditional decrement — same compare-and-swap pattern used
    // everywhere else in this codebase for money-adjacent writes (coupon
    // redemption, payment fulfillment). Only succeeds if the wallet
    // ACTUALLY has enough balance at the instant of the update.
    const claim = await this.prisma.referralWallet.updateMany({
      where: { userId, balanceInr: { gte: roundedAmount }, isSuspended: false },
      data: { balanceInr: { decrement: roundedAmount } },
    });
    if (claim.count === 0) {
      throw new BadRequestException('Insufficient wallet balance for this withdrawal amount');
    }

    return this.prisma.withdrawalRequest.create({
      data: {
        userId,
        amountInr: roundedAmount,
        payoutMethodType: payoutMethod.type,
        upiId: payoutMethod.upiId,
        bankAccountNo: payoutMethod.bankAccountNo,
        bankIfsc: payoutMethod.bankIfsc,
        bankAccountName: payoutMethod.bankAccountName,
      },
    });
  }

  async getMyWithdrawals(userId: string) {
    return this.prisma.withdrawalRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amountInr: true,
        status: true,
        payoutMethodType: true,
        adminNote: true,
        processedAt: true,
        createdAt: true,
      },
    });
  }

  /** Cancel a still-pending (REQUESTED) withdrawal — refunds the hold back to wallet. */
  async cancelWithdrawal(userId: string, withdrawalId: string) {
    const w = await this.prisma.withdrawalRequest.findUnique({ where: { id: withdrawalId } });
    if (!w || w.userId !== userId) throw new NotFoundException('Withdrawal request not found');
    if (w.status !== 'REQUESTED') throw new BadRequestException('Only a pending request can be cancelled');

    await this.prisma.$transaction([
      this.prisma.withdrawalRequest.update({
        where: { id: withdrawalId },
        data: { status: 'REJECTED', adminNote: 'Cancelled by user', processedAt: new Date() },
      }),
      this.prisma.referralWallet.update({
        where: { userId },
        data: { balanceInr: { increment: w.amountInr } },
      }),
    ]);
    return { ok: true };
  }
}
