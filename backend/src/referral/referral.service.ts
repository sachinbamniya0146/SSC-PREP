import { grantOrExtendSubscription } from '../monetization/subscription.util';
import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes } from 'crypto';
import { ReferralConfigService } from './referral-config.service';
import { ReferralConfig, commissionPctFor, maskName, releaseAt, round2, welcomeDiscountFor } from './referral-config';

const RELEASE_EVERY_MS = 10 * 60_000;
type ApplyReason = 'EMPTY' | 'INVALID' | 'SELF' | 'ALREADY_REFERRED' | 'ALREADY_PURCHASED' | 'CIRCULAR' | 'DISABLED';

@Injectable()
export class ReferralService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReferralService.name);
  private timer?: NodeJS.Timeout;
  private releasing = false;

  constructor(
    private prisma: PrismaService,
    private config: ReferralConfigService,
  ) {}

  // ---- Background: move commission from "pending" to "withdrawable" once its hold window is over ----
  onModuleInit() {
    if (process.env.REFERRAL_RELEASER === 'off') return;
    setTimeout(() => void this.tick(), 30_000).unref?.();
    this.timer = setInterval(() => void this.tick(), RELEASE_EVERY_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.releasing) return;
    this.releasing = true;
    try {
      const n = await this.releaseDue();
      if (n > 0) this.logger.log(`[referral] released ${n} commission(s) from hold`);
    } catch (e) {
      this.logger.error(`[referral] release job failed: ${(e as Error)?.message}`);
    } finally {
      this.releasing = false;
    }
  }

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

  /** Normalise whatever the student typed / the share link carried: "  ab12cd34 " -> "AB12CD34". */
  private normalizeCode(code: string | undefined | null): string {
    return String(code ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /**
   * Apply a referral code at signup/registration (email OR Google signup) or later from the referral page.
   * Returns a reason when it is NOT applied so the UI can tell the student why, instead of silently doing nothing.
   * Rules: a student can only ever have ONE referrer, can't refer themself, can't form a referral loop
   * (A refers B, B refers A), and can't add a code after they already made a paid purchase.
   */
  async applyReferralCodeDetailed(
    rawCode: string,
    refereeId: string,
  ): Promise<{ applied: boolean; reason?: ApplyReason; message: string }> {
    const cfg = await this.config.get();
    const referrerCode = this.normalizeCode(rawCode);
    if (!referrerCode) return { applied: false, reason: 'EMPTY', message: 'Enter a referral code.' };
    if (!cfg.enabled) return { applied: false, reason: 'DISABLED', message: 'The referral programme is paused right now.' };

    const referrer = await this.prisma.user.findUnique({ where: { referralCode: referrerCode } });
    if (!referrer) return { applied: false, reason: 'INVALID', message: 'This referral code does not exist. Please check it and try again.' };
    if (referrer.id === refereeId) return { applied: false, reason: 'SELF', message: "You can't use your own referral code." };

    const referee = await this.prisma.user.findUnique({
      where: { id: refereeId },
      select: { id: true, referredByCode: true, referralCode: true },
    });
    if (!referee) return { applied: false, reason: 'INVALID', message: 'User not found.' };
    if (referee.referredByCode) {
      return referee.referredByCode === referrerCode
        ? { applied: true, message: 'This referral code is already applied to your account.' }
        : { applied: false, reason: 'ALREADY_REFERRED', message: 'A referral code is already applied to your account.' };
    }
    // A -> B and B -> A would let two accounts pay each other commission.
    if (referee.referralCode && referrer.referredByCode === referee.referralCode) {
      return { applied: false, reason: 'CIRCULAR', message: 'This person joined through your code, so their code cannot be used on your account.' };
    }
    const paid = await this.prisma.payment.count({ where: { userId: refereeId, status: 'SUCCESS', amountInr: { gt: 0 } } });
    if (paid > 0) {
      return { applied: false, reason: 'ALREADY_PURCHASED', message: 'Referral codes can only be added before your first purchase.' };
    }

    try {
      await this.prisma.$transaction([
        this.prisma.referral.create({ data: { referrerId: referrer.id, refereeId } }),
        this.prisma.user.update({ where: { id: refereeId }, data: { referredByCode: referrerCode } }),
      ]);
    } catch (e: any) {
      // P2002 = this exact (referrer, referee) pair was already tracked by a parallel request — that's fine.
      if (e?.code !== 'P2002') throw e;
    }
    const pct = cfg.refereeDiscountPct;
    const offer = pct > 0 ? ` You get ${pct}% off your first plan (up to ₹${cfg.refereeDiscountMaxInr}).` : '';
    return { applied: true, message: `Referral code applied — you were referred by ${referrer.fullName?.split(' ')[0] || 'a friend'}.${offer}` };
  }

  /** Boolean wrapper kept for the signup flows (a bad code must never block account creation). */
  async applyReferralCode(referrerCode: string, refereeId: string): Promise<boolean> {
    try {
      return (await this.applyReferralCodeDetailed(referrerCode, refereeId)).applied;
    } catch {
      return false;
    }
  }

  // ============================ Friend's welcome discount ============================

  /**
   * Is this student entitled to the "referred by a friend" discount? True only for a referred student who has not
   * yet bought a paid plan. (Chapter / mock / vocab purchases don't use it up.)
   */
  async welcomeEligibility(userId: string, cfgIn?: ReferralConfig): Promise<boolean> {
    const cfg = cfgIn ?? (await this.config.get());
    if (!cfg.enabled || cfg.refereeDiscountPct <= 0 || cfg.refereeDiscountMaxInr <= 0) return false;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { referredByCode: true } });
    if (!user?.referredByCode) return false;
    const link = await this.prisma.referral.findFirst({ where: { refereeId: userId }, select: { id: true } });
    if (!link) return false;
    const usedBefore = await this.prisma.payment.count({
      where: { userId, status: 'SUCCESS', amountInr: { gt: 0 }, metadataJson: { path: ['kind'], equals: 'PLAN' } },
    });
    return usedBefore === 0;
  }

  /** The discount (₹) this student gets on a plan whose selling price is `priceInr` (0 when not entitled). */
  async welcomeDiscount(userId: string, priceInr: number): Promise<{ discountInr: number; pct: number; maxInr: number }> {
    const cfg = await this.config.get();
    if (!(await this.welcomeEligibility(userId, cfg))) return { discountInr: 0, pct: cfg.refereeDiscountPct, maxInr: cfg.refereeDiscountMaxInr };
    return { discountInr: welcomeDiscountFor(priceInr, cfg), pct: cfg.refereeDiscountPct, maxInr: cfg.refereeDiscountMaxInr };
  }

  // ============================ Commission on a paid plan ============================

  /** Same device used by both accounts = most common fake-referral pattern. Returns a short reason or null. */
  private async detectFlag(referrerId: string, refereeId: string): Promise<string | null> {
    const mine = await this.prisma.deviceSession.findMany({ where: { userId: refereeId }, select: { deviceId: true }, take: 50 });
    const ids = Array.from(new Set(mine.map((d) => d.deviceId).filter(Boolean)));
    if (!ids.length) return null;
    const shared = await this.prisma.deviceSession.count({ where: { userId: referrerId, deviceId: { in: ids } } });
    return shared > 0 ? 'SAME_DEVICE: the referrer and the friend have logged in from the same device' : null;
  }

  /**
   * Called when a student pays for a PLAN. Only plan purchases earn commission (chapter / mock / vocab add-ons
   * and free activations don't), and the commission is taken on the amount the student really paid.
   * The commission waits `holdDays` (refund protection); a fraud flag makes it wait for an admin instead.
   *
   * Every step is idempotent: ReferralEarning.paymentId is unique, so verify + webhook + reconciler can all call
   * this for the same payment and only the first one credits.
   */
  async onPaidPurchase(userId: string, payment: { id: string; amountInr: number; kind?: string }): Promise<void> {
    if (payment.kind !== 'PLAN' || !(payment.amountInr > 0)) return;
    const cfg = await this.config.get();
    if (!cfg.enabled) return;

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { referredByCode: true } });
    if (!user?.referredByCode) return;
    const referrer = await this.prisma.user.findUnique({ where: { referralCode: user.referredByCode } });
    if (!referrer) return;
    const referral = await this.prisma.referral.findUnique({
      where: { referrerId_refereeId: { referrerId: referrer.id, refereeId: userId } },
    });
    if (!referral) return;

    // Already credited for this payment (second caller) -> nothing more to do.
    if (await this.prisma.referralEarning.findUnique({ where: { paymentId: payment.id }, select: { id: true } })) return;

    const wallet = await this.ensureWallet(referrer.id);
    const flag = referral.flagReason ?? (await this.detectFlag(referrer.id, userId));

    const paidBefore = await this.prisma.referral.count({ where: { referrerId: referrer.id, status: { in: ['PAIDED', 'REWARDED'] } } });
    const paidNow = paidBefore + (referral.status === 'PENDING' ? 1 : 0);
    const commissionPct = commissionPctFor(paidNow, cfg);
    const commissionInr = round2(payment.amountInr * (commissionPct / 100));
    const earns = commissionInr > 0 && !wallet.isSuspended && !referrer.isSuspended;

    const bump = {
      purchasesCount: { increment: 1 },
      status: referral.status === 'REWARDED' ? undefined : ('PAIDED' as const),
      ...(flag && !referral.flagReason ? { flagReason: flag } : {}),
    };

    if (!earns) {
      await this.prisma.referral.update({ where: { id: referral.id }, data: bump });
    } else {
      const now = new Date();
      const held = Boolean(flag); // waits for an admin
      const instant = !held && cfg.holdDays === 0;
      try {
        await this.prisma.$transaction([
          this.prisma.referralEarning.create({
            data: {
              referralId: referral.id,
              referrerId: referrer.id,
              refereeId: userId,
              paymentId: payment.id,
              purchaseAmountInr: payment.amountInr,
              commissionPct,
              commissionInr,
              status: instant ? 'AVAILABLE' : 'PENDING',
              availableAt: held ? null : releaseAt(now, cfg.holdDays),
              holdReason: held ? flag : null,
            },
          }),
          this.prisma.referralWallet.update({
            where: { userId: referrer.id },
            data: instant
              ? { balanceInr: { increment: commissionInr }, totalEarnedInr: { increment: commissionInr } }
              : { pendingInr: { increment: commissionInr }, totalEarnedInr: { increment: commissionInr } },
          }),
          this.prisma.referral.update({ where: { id: referral.id }, data: bump }),
        ]);
      } catch (e: any) {
        // P2002 on paymentId = a concurrent call already credited this payment. Safe to stop.
        if (e?.code === 'P2002') return;
        throw e;
      }
    }

    await this.grantMilestoneRewardsIfDue(referrer.id, referral.id, cfg);
  }

  // ============================ Hold -> release, reversal ============================

  private async releaseOne(earningId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const e = await tx.referralEarning.findUnique({ where: { id: earningId } });
      if (!e || e.status !== 'PENDING') return false;
      const claim = await tx.referralEarning.updateMany({ where: { id: earningId, status: 'PENDING' }, data: { status: 'AVAILABLE' } });
      if (claim.count !== 1) return false;
      await tx.referralWallet.update({
        where: { userId: e.referrerId },
        data: { pendingInr: { decrement: e.commissionInr }, balanceInr: { increment: e.commissionInr } },
      });
      return true;
    });
  }

  /** Releases every commission whose hold window is over (skips frozen wallets and ones waiting for an admin). */
  async releaseDue(onlyUserId?: string, limit = 200): Promise<number> {
    const rows = await this.prisma.referralEarning.findMany({
      where: {
        status: 'PENDING',
        availableAt: { lte: new Date() },
        ...(onlyUserId ? { referrerId: onlyUserId } : {}),
        referrer: { referralWallet: { is: { isSuspended: false } } },
      },
      select: { id: true },
      orderBy: { availableAt: 'asc' },
      take: limit,
    });
    let n = 0;
    for (const r of rows) if (await this.releaseOne(r.id)) n++;
    return n;
  }

  /** Admin: a flagged commission looked fine -> start (and finish) its release. */
  async approveHeldEarning(earningId: string): Promise<{ ok: true }> {
    const e = await this.prisma.referralEarning.findUnique({ where: { id: earningId } });
    if (!e) throw new NotFoundException('Commission not found');
    if (e.status !== 'PENDING') throw new BadRequestException(`This commission is already ${e.status.toLowerCase()}.`);
    await this.prisma.referralEarning.updateMany({
      where: { id: earningId, status: 'PENDING' },
      data: { availableAt: new Date(), holdReason: e.holdReason ? `${e.holdReason} (approved by admin)` : null },
    });
    await this.releaseOne(earningId);
    return { ok: true };
  }

  /**
   * Takes a commission back (refund, fraud). Pending money just disappears; money already released is deducted
   * from the withdrawable balance — which can go below zero, and then blocks withdrawals until new earnings cover it.
   * The friend's referral goes back to "signed up" when this was their only paid plan.
   */
  async reverseEarning(earningId: string, note: string): Promise<{ ok: true; reversed: boolean }> {
    const reason = String(note || '').trim().slice(0, 300) || 'Reversed';
    return this.prisma.$transaction(async (tx) => {
      const e = await tx.referralEarning.findUnique({ where: { id: earningId } });
      if (!e) throw new NotFoundException('Commission not found');
      if (e.status === 'REVERSED') return { ok: true as const, reversed: false };
      const claim = await tx.referralEarning.updateMany({
        where: { id: earningId, status: e.status },
        data: { status: 'REVERSED', reversedAt: new Date(), reversalNote: reason },
      });
      if (claim.count !== 1) return { ok: true as const, reversed: false };
      await tx.referralWallet.update({
        where: { userId: e.referrerId },
        data:
          e.status === 'PENDING'
            ? { pendingInr: { decrement: e.commissionInr }, totalEarnedInr: { decrement: e.commissionInr } }
            : { balanceInr: { decrement: e.commissionInr }, totalEarnedInr: { decrement: e.commissionInr } },
      });
      const ref = await tx.referral.update({ where: { id: e.referralId }, data: { purchasesCount: { decrement: 1 } } });
      if (ref.purchasesCount <= 0 && ref.status === 'PAIDED') {
        await tx.referral.update({ where: { id: e.referralId }, data: { status: 'PENDING', purchasesCount: 0 } });
      }
      return { ok: true as const, reversed: true };
    });
  }

  /** Payment refunded -> take the commission it earned back (no-op when it earned none). */
  async reverseForPayment(paymentId: string, note: string): Promise<boolean> {
    const e = await this.prisma.referralEarning.findUnique({ where: { paymentId }, select: { id: true } });
    if (!e) return false;
    return (await this.reverseEarning(e.id, note)).reversed;
  }

  private async grantMilestoneRewardsIfDue(referrerId: string, referralId: string, cfg: ReferralConfig): Promise<void> {
    const referrer = await this.prisma.user.findUnique({ where: { id: referrerId } });
    if (!referrer || referrer.isSuspended) return;

    const paidReferralsCount = await this.prisma.referral.count({
      where: { referrerId, status: { in: ['PAIDED', 'REWARDED'] } },
    });

    // -- free 30-day plan --
    if (!referrer.freeSubFromReferral && paidReferralsCount >= cfg.freeMonthAt) {
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
          // Appends 30 days after any running plan (never overwrites paid time).
          await grantOrExtendSubscription(this.prisma as any, { userId: referrerId, planId: plan.id, days: 30 });
        }
      }
    }

    // -- free 6-month upgrade (one-time; AuditLog is the claim flag) --
    if (paidReferralsCount >= cfg.freeUpgradeAt) {
      const alreadyGranted = await this.prisma.auditLog.findFirst({
        where: { userId: referrerId, action: 'REFERRAL_6MO_UPGRADE_GRANTED' },
      });
      if (!alreadyGranted) {
        const plan = await this.prisma.plan.findFirst({ where: { isActive: true }, orderBy: { priceInr: 'desc' } });
        if (plan) {
          await grantOrExtendSubscription(this.prisma as any, { userId: referrerId, planId: plan.id, months: 6 });
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

  /** Signup page: "Rahul invited you — 10% off your first plan". Public, so it only reveals a first name. */
  async previewCode(rawCode: string) {
    const cfg = await this.config.get();
    const code = this.normalizeCode(rawCode);
    if (!code || !cfg.enabled) return { valid: false };
    const u = await this.prisma.user.findUnique({ where: { referralCode: code }, select: { fullName: true, isSuspended: true } });
    if (!u || u.isSuspended) return { valid: false };
    return {
      valid: true,
      referrerFirstName: u.fullName?.trim().split(/\s+/)[0] || 'A friend',
      discountPct: cfg.refereeDiscountPct,
      discountMaxInr: cfg.refereeDiscountMaxInr,
    };
  }

  // ============================ Admin views ============================

  async adminOverview() {
    const [wallets, held, pendingCount, reversed, referralsTotal, referralsPaid, flagged, openWithdrawals] = await Promise.all([
      this.prisma.referralWallet.aggregate({ _sum: { balanceInr: true, pendingInr: true, totalEarnedInr: true, totalWithdrawnInr: true } }),
      this.prisma.referralEarning.count({ where: { status: 'PENDING', availableAt: null } }),
      this.prisma.referralEarning.count({ where: { status: 'PENDING' } }),
      this.prisma.referralEarning.count({ where: { status: 'REVERSED' } }),
      this.prisma.referral.count(),
      this.prisma.referral.count({ where: { status: { in: ['PAIDED', 'REWARDED'] } } }),
      this.prisma.referral.count({ where: { flagReason: { not: null } } }),
      this.prisma.withdrawalRequest.aggregate({ where: { status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } }, _sum: { amountInr: true }, _count: true }),
    ]);
    const s = wallets._sum;
    return {
      withdrawableInr: round2(s.balanceInr ?? 0),
      pendingInr: round2(s.pendingInr ?? 0),
      lifetimeEarnedInr: round2(s.totalEarnedInr ?? 0),
      paidOutInr: round2(s.totalWithdrawnInr ?? 0),
      openWithdrawalsInr: round2(openWithdrawals._sum.amountInr ?? 0),
      openWithdrawals: openWithdrawals._count,
      waitingForReview: held,
      pendingEarnings: pendingCount,
      reversedEarnings: reversed,
      referralsTotal,
      referralsPaid,
      flaggedReferrals: flagged,
      conversionPct: referralsTotal > 0 ? Math.round((referralsPaid / referralsTotal) * 1000) / 10 : 0,
    };
  }

  /** filter: review = flagged & waiting for an admin, pending = inside hold, available, reversed, all */
  async adminListEarnings(filter: string) {
    const where: any =
      filter === 'review' ? { status: 'PENDING', availableAt: null }
      : filter === 'pending' ? { status: 'PENDING' }
      : filter === 'available' ? { status: 'AVAILABLE' }
      : filter === 'reversed' ? { status: 'REVERSED' }
      : {};
    const rows = await this.prisma.referralEarning.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: {
        referrer: { select: { id: true, fullName: true, email: true } },
        referee: { select: { id: true, fullName: true, email: true } },
        payment: { select: { gatewayOrderId: true } },
      },
    });
    return rows.map((e) => ({
      id: e.id,
      referrer: e.referrer,
      referee: e.referee,
      orderId: e.payment.gatewayOrderId,
      purchaseAmountInr: e.purchaseAmountInr,
      commissionPct: e.commissionPct,
      commissionInr: e.commissionInr,
      status: e.status,
      availableAt: e.availableAt,
      holdReason: e.holdReason,
      reversalNote: e.reversalNote,
      createdAt: e.createdAt,
    }));
  }

  // ============================ What the student sees ============================

  /** Referral page data: code, rules, progress, wallet (withdrawable vs pending), friends. */
  async getStats(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    const code = user.referralCode ?? (await this.getOrCreateCode(userId));
    const cfg = await this.config.get();

    await this.releaseDue(userId).catch(() => 0); // a student never waits for the 10-minute job

    const [referrals, wallet, nextPending, openWithdrawals, payoutMethod] = await Promise.all([
      this.prisma.referral.findMany({
        where: { referrerId: userId },
        include: { referee: { select: { id: true, fullName: true, createdAt: true } } },
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
      this.ensureWallet(userId),
      this.prisma.referralEarning.findFirst({
        where: { referrerId: userId, status: 'PENDING', availableAt: { not: null } },
        orderBy: { availableAt: 'asc' },
        select: { availableAt: true, commissionInr: true },
      }),
      this.prisma.withdrawalRequest.count({ where: { userId, status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } } }),
      this.prisma.payoutMethod.findUnique({ where: { userId }, select: { id: true } }),
    ]);

    const paidCount = referrals.filter((r) => r.status !== 'PENDING').length;
    const totalPurchases = referrals.reduce((s, r) => s + r.purchasesCount, 0);
    const currentCommissionPct = commissionPctFor(paidCount, cfg);
    const balance = round2(wallet.balanceInr);

    let withdrawBlock: string | null = null;
    if (wallet.isSuspended) withdrawBlock = wallet.suspendedReason || 'Your referral earnings are paused by admin.';
    else if (paidCount < cfg.minPaidReferralsToWithdraw)
      withdrawBlock = `Withdrawals open after ${cfg.minPaidReferralsToWithdraw} friends have bought a plan (you have ${paidCount}).`;
    else if (balance < cfg.minWithdrawInr) withdrawBlock = `Minimum withdrawal is ₹${cfg.minWithdrawInr}.`;
    else if (openWithdrawals > 0) withdrawBlock = 'You already have a withdrawal in progress.';

    const base = (process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'https://sscprephub.in').replace(/\/$/, '');
    return {
      enabled: cfg.enabled,
      referralCode: code,
      shareLink: `${base}/signup?ref=${code}`,
      referredBy: user.referredByCode ?? null,
      rules: {
        refereeDiscountPct: cfg.refereeDiscountPct,
        refereeDiscountMaxInr: cfg.refereeDiscountMaxInr,
        lowTierPct: cfg.lowTierPct,
        highTierPct: cfg.highTierPct,
        highTierAfter: cfg.highTierAfter,
        holdDays: cfg.holdDays,
        minWithdrawInr: cfg.minWithdrawInr,
        minPaidReferralsToWithdraw: cfg.minPaidReferralsToWithdraw,
        freeMonthAt: cfg.freeMonthAt,
        freeUpgradeAt: cfg.freeUpgradeAt,
      },
      stats: {
        totalReferrals: referrals.length,
        paidReferrals: paidCount,
        totalPurchases,
        currentCommissionPct,
        friendsToNextTier: currentCommissionPct === cfg.lowTierPct && cfg.highTierPct > cfg.lowTierPct ? Math.max(0, cfg.highTierAfter - paidCount) : null,
        freeMonthClaimed: user.freeSubFromReferral,
        milestones: [
          { key: 'month', label: 'Free 30 days of Premium', at: cfg.freeMonthAt, done: user.freeSubFromReferral, progressPercent: Math.min(100, Math.round((paidCount / cfg.freeMonthAt) * 100)) },
          { key: 'upgrade', label: 'Free 6-month upgrade', at: cfg.freeUpgradeAt, done: paidCount >= cfg.freeUpgradeAt, progressPercent: Math.min(100, Math.round((paidCount / cfg.freeUpgradeAt) * 100)) },
        ],
      },
      wallet: {
        balanceInr: balance,
        pendingInr: Math.max(0, round2(wallet.pendingInr)),
        totalEarnedInr: round2(wallet.totalEarnedInr),
        totalWithdrawnInr: round2(wallet.totalWithdrawnInr),
        isSuspended: wallet.isSuspended,
        suspendedReason: wallet.suspendedReason,
        canWithdraw: withdrawBlock === null,
        withdrawBlockReason: withdrawBlock,
        hasPayoutMethod: Boolean(payoutMethod),
        nextRelease: nextPending?.availableAt ? { at: nextPending.availableAt, amountInr: round2(nextPending.commissionInr) } : null,
      },
      referrals: referrals.map((r) => ({
        id: r.id,
        name: maskName(r.referee.fullName),
        joinedAt: r.referee.createdAt,
        purchases: r.purchasesCount,
        status: r.status,
      })),
    };
  }

  /** Commission history for the logged-in student. */
  async getMyEarnings(userId: string) {
    const rows = await this.prisma.referralEarning.findMany({
      where: { referrerId: userId },
      include: { referee: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      name: maskName(r.referee.fullName),
      purchaseAmountInr: r.purchaseAmountInr,
      commissionPct: r.commissionPct,
      commissionInr: r.commissionInr,
      status: r.status,
      availableAt: r.status === 'PENDING' ? r.availableAt : null,
      // a held-for-review commission just says "under review" — the reason stays with admin
      underReview: r.status === 'PENDING' && r.availableAt === null,
      reversalNote: r.status === 'REVERSED' ? r.reversalNote : null,
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
   * User requests a withdrawal. Only RELEASED commission can be withdrawn (pending money is still inside its hold
   * window). The amount is deducted from the wallet IMMEDIATELY with an atomic conditional decrement, so two
   * simultaneous requests can never take more than the balance; it is refunded if admin rejects it or the payout fails.
   */
  async requestWithdrawal(userId: string, amountInr: number) {
    const cfg = await this.config.get();
    if (!Number.isFinite(amountInr) || amountInr <= 0) throw new BadRequestException('Enter a valid amount');
    const roundedAmount = round2(amountInr);
    if (roundedAmount < cfg.minWithdrawInr) throw new BadRequestException(`The minimum withdrawal is ₹${cfg.minWithdrawInr}.`);

    const wallet = await this.ensureWallet(userId);
    if (wallet.isSuspended) {
      throw new ForbiddenException(wallet.suspendedReason || 'Your referral earnings are currently suspended by admin');
    }
    await this.releaseDue(userId).catch(() => 0);

    const paidCount = await this.prisma.referral.count({
      where: { referrerId: userId, status: { in: ['PAIDED', 'REWARDED'] } },
    });
    if (paidCount < cfg.minPaidReferralsToWithdraw) {
      throw new BadRequestException(
        `You need at least ${cfg.minPaidReferralsToWithdraw} friends who bought a plan to withdraw. You currently have ${paidCount}.`,
      );
    }

    const payoutMethod = await this.prisma.payoutMethod.findUnique({ where: { userId } });
    if (!payoutMethod) {
      throw new BadRequestException('Add a UPI ID or bank account first before requesting a withdrawal');
    }

    const open = await this.prisma.withdrawalRequest.count({ where: { userId, status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } } });
    if (open > 0) throw new BadRequestException('You already have a withdrawal in progress. Wait for it to finish before requesting another.');

    const claim = await this.prisma.referralWallet.updateMany({
      where: { userId, balanceInr: { gte: roundedAmount }, isSuspended: false },
      data: { balanceInr: { decrement: roundedAmount } },
    });
    if (claim.count === 0) {
      throw new BadRequestException('Insufficient withdrawable balance. Commission becomes withdrawable after its hold period.');
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
