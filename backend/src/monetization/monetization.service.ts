/* eslint-disable @typescript-eslint/no-explicit-any */
// P2 — monetization service: Cashfree orders, coupons, subscription plans, chapter purchases.
//
// GATEWAY MIGRATION (PayU → Cashfree): the previous PayU integration had a
// real security weakness — it shipped hardcoded fallback merchant
// credentials in source (`process.env.PAYU_MERCHANT_KEY || 'eUXkOt'` and a
// literal fallback salt), meant "just for local dev" but silently active in
// any environment where the env var was merely unset — including a
// misconfigured production deploy. This rewrite:
//   1. Never falls back to a baked-in secret. Missing credentials in
//      production throw at boot instead of silently running with a fake key.
//   2. Never sends the payment secret (or anything derived from it) to the
//      browser. PayU's flow built an HMAC hash client-visible and POSTed it
//      straight to PayU from the browser. Cashfree's flow keeps order
//      creation entirely server-to-server; the browser only ever receives a
//      short-lived, single-use `payment_session_id` opaque token.
//   3. Never trusts the browser's word on whether a payment succeeded.
//      verifyPayment() no longer reads a client-supplied status/hash — it
//      asks Cashfree's server directly ("Get Order") which state the order
//      is actually in, so a tampered redirect can't fake a success.
//   4. Webhook signature verification uses the exact algorithm Cashfree
//      documents (HMAC-SHA256 of `timestamp + rawBody`, base64-encoded,
//      compared with crypto.timingSafeEqual to avoid timing side-channels)
//      instead of the ad-hoc pipe-joined hash PayU used.
import { Injectable, BadRequestException, NotFoundException, Inject, forwardRef, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReferralService } from '../referral/referral.service';
import * as crypto from 'crypto';
import { istDateKey } from '../gamification/gamification.service';
import { computeRevisionState } from '../vocab/vocab-revision.util';
import { VOCAB_UNLOCK_ALL_PRICE_INR, VOCAB_WORD_UNLOCK_PRICE_INR, skipFeeForStreak } from '../vocab/vocab-messages';
import { grantOrExtendSubscription } from './subscription.util';
import { couponAmounts, couponProblem, planPricing } from './pricing.util';

interface CashfreeConfig {
  appId: string;
  secretKey: string;
  webhookSecret: string;
  apiVersion: string;
  baseUrl: string;
  env: 'TEST' | 'PRODUCTION';
}

type OrderInput = {
  planId?: string;
  mockTemplateId?: string;
  chapterId?: string;
  vocabWordId?: string;
  vocabSubscription?: boolean;
  vocabUnlockAll?: boolean;
  vocabRevisionSkip?: boolean;
  couponCode?: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
// Chapter-PDF price used to be a bare `1` in two places (order + fulfilment).
const CHAPTER_PDF_PRICE_INR = Number(process.env.CHAPTER_PDF_PRICE_INR) > 0 ? Number(process.env.CHAPTER_PDF_PRICE_INR) : 1;
const RECONCILE_EVERY_MS = 5 * 60 * 1000;
const ORDER_TTL_MINUTES = 30;

@Injectable()
export class MonetizationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonetizationService.name);
  private cf: CashfreeConfig;
  private timer: NodeJS.Timeout | null = null;
  private reconciling = false;

  constructor(
    private prisma: PrismaService,
    // FIX Error #7: inject ReferralService so fulfill() can trigger the
    // referral reward. forwardRef() avoids a circular-dependency crash if
    // ReferralModule also imports MonetizationModule (or vice versa).
    @Inject(forwardRef(() => ReferralService))
    private referralService: ReferralService,
  ) {
    // Credentials are trimmed (a trailing newline copied from a dashboard /
    // .env file is the #1 cause of Cashfree's "authentication Failed").
    // CASHFREE_ENV must match the key type: TEST keys -> TEST, live keys ->
    // PRODUCTION. Missing credentials in production abort boot on purpose.
    const appId = (process.env.CASHFREE_APP_ID || '').trim();
    const secretKey = (process.env.CASHFREE_SECRET_KEY || '').trim();
    const env: 'TEST' | 'PRODUCTION' = (process.env.CASHFREE_ENV || '').trim().toUpperCase() === 'PRODUCTION' ? 'PRODUCTION' : 'TEST';

    if ((!appId || !secretKey) && process.env.NODE_ENV === 'production') {
      throw new Error(
        'CASHFREE_APP_ID and CASHFREE_SECRET_KEY must be set in production. Refusing to start with no real payment credentials.',
      );
    }
    if (!appId || !secretKey) {
      this.logger.warn(
        'CASHFREE_APP_ID / CASHFREE_SECRET_KEY not set — payment endpoints will fail until configured (this is only tolerated outside production).',
      );
    }

    this.cf = {
      appId,
      secretKey,
      webhookSecret: (process.env.CASHFREE_WEBHOOK_SECRET || secretKey).trim(),
      apiVersion: '2023-08-01',
      baseUrl: env === 'PRODUCTION' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com',
      env,
    };
  }

  // ---- Background upkeep: settle missed webhooks + expire lapsed plans ----
  onModuleInit() {
    if (process.env.PAYMENT_RECONCILER === 'off') return;
    // First run shortly after boot (catches payments that landed while the
    // server was down/redeploying), then every 5 minutes.
    setTimeout(() => void this.upkeep(), 20_000).unref?.();
    this.timer = setInterval(() => void this.upkeep(), RECONCILE_EVERY_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async upkeep() {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      await this.expireLapsedSubscriptions();
      await this.reconcilePendingPayments();
    } catch (e) {
      this.logger.error(`payment upkeep failed: ${(e as Error)?.message}`);
    } finally {
      this.reconciling = false;
    }
  }

  /** ACTIVE rows whose end date passed -> EXPIRED (keeps admin counts/reports honest). */
  async expireLapsedSubscriptions() {
    const r = await this.prisma.subscription.updateMany({
      where: { status: 'ACTIVE', endsAt: { lte: new Date() } },
      data: { status: 'EXPIRED' },
    });
    if (r.count > 0) this.logger.log(`Expired ${r.count} lapsed subscription(s)`);
    return r.count;
  }

  /**
   * Safety net for the case the browser never came back to /payment/success
   * (tab closed, phone died) AND the webhook was missed/misconfigured: ask
   * Cashfree about every PENDING payment from the last 48h and settle it.
   * Money was taken -> access is granted; order expired -> marked FAILED.
   */
  async reconcilePendingPayments() {
    if (!this.cf.appId || !this.cf.secretKey) return { checked: 0, fulfilled: 0 };
    const rows = await this.prisma.payment.findMany({
      where: {
        status: 'PENDING',
        gatewayOrderId: { startsWith: 'SSC_' },
        createdAt: { gte: new Date(Date.now() - 48 * 3600_000), lte: new Date(Date.now() - 2 * 60_000) },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    let fulfilled = 0;
    for (const p of rows) {
      try {
        const r = await this.settleFromGateway(p);
        if (r.state === 'PAID') fulfilled++;
      } catch (e) {
        this.logger.warn(`reconcile ${p.gatewayOrderId}: ${(e as Error)?.message}`);
      }
    }
    if (fulfilled > 0) this.logger.log(`Reconciler fulfilled ${fulfilled} payment(s) the webhook missed`);
    return { checked: rows.length, fulfilled };
  }

  // ---- Plans ----
  /**
   * Plans on sale, each with a `pricing` block computed server-side (running offer, struck-through
   * price, "you save", per-month). `priceInr` stays the REGULAR price for older clients; the amount
   * actually charged is `pricing.salePriceInr`.
   */
  async listPlans() {
    const rows = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { durationMonths: 'asc' }, { priceInr: 'asc' }],
    });
    const now = new Date();
    return rows.map((p) => ({ ...p, pricing: planPricing(p, now) }));
  }

  async mySubscription(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    // Same rule checkPremiumAccess() uses elsewhere: ADMIN is always premium.
    if (user?.role === 'ADMIN') return { active: true, admin: true };

    const now = new Date();
    const sub = await this.prisma.subscription.findFirst({
      where: { userId, status: 'ACTIVE', endsAt: { gt: now } },
      orderBy: { endsAt: 'desc' },
      include: { plan: true },
    });
    if (!sub) {
      // Close any lapsed ACTIVE rows lazily so the UI/admin never see "ACTIVE" past its end date.
      await this.prisma.subscription.updateMany({
        where: { userId, status: 'ACTIVE', endsAt: { lte: now } },
        data: { status: 'EXPIRED' },
      });
      const last = await this.prisma.subscription.findFirst({
        where: { userId },
        orderBy: { endsAt: 'desc' },
        include: { plan: true },
      });
      return { active: false, lastPlan: last?.plan ?? null, lastEndedAt: last?.endsAt ?? null };
    }
    const daysLeft = Math.max(0, Math.ceil((sub.endsAt.getTime() - now.getTime()) / 86_400_000));
    return {
      active: true,
      plan: sub.plan,
      startsAt: sub.startsAt,
      endsAt: sub.endsAt,
      daysLeft,
      expiringSoon: daysLeft <= 7,
    };
  }

  // ---- Coupons ----
  /**
   * Validates a coupon and returns the discount.
   *  - With `planId` the amount is the plan's CURRENT sale price computed here (the client's number is
   *    ignored); without it (legacy callers) `amountInr` is used and plan rules cannot be checked.
   *  - `userId` (when known) enforces the coupon's per-student limit (default 1).
   * All rules live in pricing.util.ts (couponProblem / couponAmounts) so checkout, order creation and the
   * admin screen can never disagree.
   */
  async validateCoupon(code: string, amountInr: number | undefined, userId?: string, planId?: string) {
    const normalized = String(code || '').trim().toUpperCase();
    if (!normalized) throw new BadRequestException('Enter a coupon code');

    let amount = Number(amountInr);
    let offerActive = false;
    let basePlanId: string | undefined;
    if (planId) {
      const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
      if (!plan || !plan.isActive) throw new BadRequestException('Plan not found');
      const pr = planPricing(plan);
      amount = pr.salePriceInr;
      offerActive = pr.offerActive;
      basePlanId = plan.id;
    }
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Invalid amount');

    const c = await this.prisma.coupon.findUnique({ where: { code: normalized } });
    if (!c) throw new NotFoundException('Invalid coupon code');

    let usedByUser = 0;
    if (userId && c.perUserLimit > 0) {
      usedByUser = await this.prisma.payment.count({
        where: { userId, status: 'SUCCESS', metadataJson: { path: ['couponCode'], equals: c.code } },
      });
    }
    const problem = couponProblem(c, { now: new Date(), amountInr: amount, planId: basePlanId, offerActive, usedByUser });
    if (problem) throw new BadRequestException(problem);

    const { discount, finalAmountInr } = couponAmounts(c, amount);
    return {
      code: c.code,
      description: c.description,
      discountPct: c.discountPct,
      discountInr: c.discountInr,
      maxDiscountInr: c.maxDiscountInr,
      amountInr: amount,
      discount,
      finalAmountInr,
    };
  }

  // ---- Cashfree API helper ----
  // Every server-to-server Cashfree call goes through here so credential
  // headers, timeout and error handling live in exactly one place.
  private async cfFetch(path: string, init: { method: 'GET' | 'POST'; body?: any }) {
    if (!this.cf.appId || !this.cf.secretKey) {
      throw new BadRequestException('Payments are not configured on this server yet (missing Cashfree credentials).');
    }
    let res: Response;
    try {
      res = await fetch(`${this.cf.baseUrl}${path}`, {
        method: init.method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-api-version': this.cf.apiVersion,
          'x-client-id': this.cf.appId,
          'x-client-secret': this.cf.secretKey,
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        // A hung gateway must not hang the request (and a DB connection) forever.
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      this.logger.error(`Cashfree ${init.method} ${path} network error: ${(e as Error)?.message}`);
      throw new BadRequestException('Payment gateway is not reachable right now. Please try again in a minute.');
    }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      this.logger.error(`Cashfree ${init.method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
      if (json?.type === 'authentication_error' || res.status === 401) {
        this.logger.error(
          `Cashfree rejected our credentials (env=${this.cf.env}, appId=${this.cf.appId ? this.cf.appId.slice(0, 6) + '…' : '(empty)'}). ` +
            `Check: (1) CASHFREE_APP_ID / CASHFREE_SECRET_KEY copied exactly (no space/newline), (2) CASHFREE_ENV matches the key type ` +
            `(TEST keys -> unset/"TEST", live keys -> "PRODUCTION"). Restart the backend after fixing .env.`,
        );
        throw new BadRequestException('Payment gateway rejected our server credentials. Please try again in a bit — our team has been notified.');
      }
      throw new BadRequestException(json?.message || `Cashfree request failed (${res.status})`);
    }
    return json;
  }

  // ---- Order creation ----
  async createOrder(userId: string, input: OrderInput) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, fullName: true, phone: true } });
    if (!user) throw new NotFoundException('User not found');

    const orderId = `SSC_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;

    // Amount is ALWAYS computed here, server-side, from rows looked up fresh
    // from the DB — the browser never influences what gets charged.
    let amountInr = 0;
    let productInfo = '';
    let planName: string | undefined;
    let chapterName: string | undefined;
    let mockTitle: string | undefined;
    let discount = 0;
    let originalAmountInr = 0;
    let metadata: Record<string, any> = { kind: '' };

    if (input.planId) {
      const plan = await this.prisma.plan.findUnique({ where: { id: input.planId } });
      if (!plan || !plan.isActive) throw new BadRequestException('Plan not found');
      // Price is decided HERE from the plan row: regular price, minus the running offer (if any),
      // minus the coupon (if any). The browser never sends an amount.
      const pricing = planPricing(plan);
      originalAmountInr = pricing.regularInr;
      const offerDiscount = pricing.offerDiscountInr;
      let couponCode: string | null = null;
      if (input.couponCode && input.couponCode.trim()) {
        const v = await this.validateCoupon(input.couponCode, undefined, userId, plan.id);
        amountInr = v.finalAmountInr;
        discount = v.discount;
        couponCode = v.code; // canonical (upper-case) code — fulfil() looks the coupon up by this
      } else {
        amountInr = pricing.salePriceInr;
      }
      productInfo = `SSC Prep Hub - ${plan.name}`;
      planName = plan.name;
      metadata = {
        kind: 'PLAN', planId: plan.id, planName: plan.name, durationMonths: plan.durationMonths,
        originalAmountInr, offerDiscount, offerPct: pricing.offerPct, discount, couponCode,
      };
    } else if (input.chapterId) {
      const chapter = await this.prisma.chapter.findUnique({ where: { id: input.chapterId } });
      if (!chapter) throw new BadRequestException('Chapter not found');
      const existing = await this.prisma.chapterPurchase.findUnique({
        where: { userId_chapterId: { userId, chapterId: input.chapterId } },
      });
      if (existing) throw new BadRequestException('Chapter already purchased');
      amountInr = CHAPTER_PDF_PRICE_INR;
      originalAmountInr = amountInr;
      productInfo = `SSC Prep Hub - Chapter PDF: ${chapter.name}`;
      chapterName = chapter.name;
      metadata = { kind: 'CHAPTER', chapterId: chapter.id, chapterName: chapter.name };
    } else if (input.mockTemplateId) {
      const tpl = await this.prisma.testTemplate.findUnique({ where: { id: input.mockTemplateId } });
      if (!tpl) throw new BadRequestException('Mock template not found');
      amountInr = tpl.isPremium ? (tpl.priceInr ?? 0) : 0;
      originalAmountInr = amountInr;
      productInfo = `SSC Prep Hub - Mock Test: ${tpl.title}`;
      mockTitle = tpl.title;
      metadata = { kind: 'MOCK', mockTemplateId: tpl.id, mockTitle: tpl.title };
    } else if (input.vocabWordId) {
      const word = await this.prisma.vocabWord.findUnique({ where: { id: input.vocabWordId } });
      if (!word) throw new BadRequestException('Word not found');
      const existing = await this.prisma.vocabWordProgress.findUnique({
        where: { userId_wordId: { userId, wordId: input.vocabWordId } },
      });
      if (existing?.masteredAt || existing?.forceUnlocked) {
        throw new BadRequestException('This word is already unlocked');
      }
      amountInr = VOCAB_WORD_UNLOCK_PRICE_INR;
      originalAmountInr = amountInr;
      productInfo = `SSC Prep Hub - Unlock Word: ${word.word}`;
      metadata = { kind: 'VOCAB_WORD', vocabWordId: word.id, vocabWord: word.word };
    } else if (input.vocabSubscription) {
      // ₹10 / 30 days. Renewing early extends from the current expiry.
      amountInr = 10;
      originalAmountInr = amountInr;
      productInfo = 'SSC Prep Hub - Vocabulary Mastery Monthly Subscription';
      metadata = { kind: 'VOCAB_SUBSCRIPTION' };
    } else if (input.vocabUnlockAll) {
      const state = await this.prisma.vocabUserState.findUnique({ where: { userId } });
      if (state?.allUnlockedAt) throw new BadRequestException('All words are already unlocked');
      amountInr = VOCAB_UNLOCK_ALL_PRICE_INR;
      originalAmountInr = amountInr;
      productInfo = 'SSC Prep Hub - Vocabulary: Unlock All Words';
      metadata = { kind: 'VOCAB_UNLOCK_ALL' };
    } else if (input.vocabRevisionSkip) {
      const st = await computeRevisionState(this.prisma, userId);
      if (st.doneToday) throw new BadRequestException('Today\'s revision is already done or skipped');
      if (!st.due) throw new BadRequestException('No revision is pending right now — there is nothing to skip');
      amountInr = skipFeeForStreak(st.skipStreak);
      originalAmountInr = amountInr;
      productInfo = `SSC Prep Hub - Vocabulary: skip today's revision (skip #${st.skipStreak + 1})`;
      metadata = { kind: 'VOCAB_REVISION_SKIP', dateKey: st.dateKey, skipNumber: st.skipStreak + 1 };
    } else {
      throw new BadRequestException('Provide planId, mockTemplateId, chapterId, vocabWordId, vocabSubscription, vocabUnlockAll or vocabRevisionSkip');
    }

    amountInr = round2(amountInr);

    if (amountInr <= 0) {
      // A 100%-off coupon on a PLAN is a legitimate "free activation": there is
      // nothing to charge, so skip the gateway and fulfil immediately. (Before,
      // this threw "item is free" and made 100% coupons unusable.)
      if (metadata.kind === 'PLAN' && metadata.couponCode) {
        const payment = await this.prisma.payment.create({
          data: { userId, gatewayOrderId: `FREE_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`, amountInr: 0, status: 'PENDING', metadataJson: metadata } as any,
        });
        await this.fulfill(payment, payment.gatewayOrderId);
        return { free: true, orderId: payment.gatewayOrderId, amountInr: 0, planName, discount };
      }
      throw new BadRequestException('This item is free — no payment order needed');
    }

    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const returnUrl = `${frontendUrl}/payment/success?order_id={order_id}`;
    // Cashfree rejects a relative / non-https notify_url, which used to make
    // order creation fail when BACKEND_PUBLIC_URL was unset. Only send it when
    // it is a real absolute URL; otherwise verify + the reconciler still settle.
    const rawNotify = process.env.CASHFREE_WEBHOOK_URL || (process.env.BACKEND_PUBLIC_URL ? `${process.env.BACKEND_PUBLIC_URL.replace(/\/+$/, '')}/api/v1/payments/webhook` : '');
    const notifyUrl = /^https:\/\//i.test(rawNotify) ? rawNotify : '';
    if (!notifyUrl) {
      this.logger.warn('No https CASHFREE_WEBHOOK_URL / BACKEND_PUBLIC_URL — creating order WITHOUT webhook (verify + reconciler will settle it).');
    }
    if (this.cf.env === 'PRODUCTION' && !/^https:\/\//i.test(frontendUrl)) {
      this.logger.error(`FRONTEND_URL (${frontendUrl}) is not https — Cashfree PRODUCTION will reject the return_url.`);
    }

    const customerPhone = (user.phone || '').replace(/\D/g, '').slice(-10);
    const order = await this.cfFetch('/pg/orders', {
      method: 'POST',
      body: {
        order_id: orderId,
        order_amount: amountInr,
        order_currency: 'INR',
        customer_details: {
          customer_id: userId,
          customer_name: user.fullName || 'User',
          customer_email: user.email,
          customer_phone: customerPhone.length === 10 ? customerPhone : '9999999999',
        },
        order_meta: {
          return_url: returnUrl,
          ...(notifyUrl ? { notify_url: notifyUrl } : {}),
        },
        order_expiry_time: new Date(Date.now() + ORDER_TTL_MINUTES * 60_000).toISOString(),
        order_note: productInfo.slice(0, 200),
      },
    });

    if (!order.payment_session_id) {
      throw new BadRequestException('Cashfree did not return a payment session — please try again');
    }

    await this.prisma.payment.create({
      data: { userId, gatewayOrderId: orderId, amountInr, status: 'PENDING', metadataJson: metadata } as any,
    });

    return {
      orderId,
      paymentSessionId: order.payment_session_id,
      amountInr,
      originalAmountInr,
      cashfreeEnv: this.cf.env,
      planName,
      chapterName,
      mockTitle,
      discount,
    };
  }

  /** One-click renewal of the plan the user last had (used by the "Renew" button). */
  async renewOrder(userId: string, couponCode?: string) {
    const last = await this.prisma.subscription.findFirst({
      where: { userId },
      orderBy: { endsAt: 'desc' },
      include: { plan: true },
    });
    if (!last) throw new BadRequestException('No previous plan found — please choose a plan.');
    if (!last.plan?.isActive) throw new BadRequestException('Your previous plan is no longer on sale — please choose a plan.');
    return this.createOrder(userId, { planId: last.planId, couponCode });
  }

  /**
   * Asks Cashfree for the authoritative state of one of OUR orders and
   * settles the local Payment row accordingly. Shared by the browser verify
   * call and the background reconciler so both behave identically.
   */
  private async settleFromGateway(payment: any): Promise<{ state: 'PAID' | 'PENDING' | 'FAILED'; status?: string }> {
    const order = await this.cfFetch(`/pg/orders/${encodeURIComponent(payment.gatewayOrderId)}`, { method: 'GET' });
    const orderStatus = String(order.order_status || '').toUpperCase(); // PAID | ACTIVE | EXPIRED | TERMINATED | ...

    if (orderStatus === 'ACTIVE') return { state: 'PENDING', status: orderStatus };

    if (orderStatus !== 'PAID') {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: { not: 'SUCCESS' } },
        data: { status: 'FAILED' },
      });
      return { state: 'FAILED', status: orderStatus };
    }

    // Defence in depth: the order we created must have been for exactly the
    // amount we expect. Never grant access for a mismatched amount.
    const paid = Number(order.order_amount);
    if (Number.isFinite(paid) && Math.abs(paid - payment.amountInr) > 0.01) {
      this.logger.error(`Amount mismatch on ${payment.gatewayOrderId}: gateway=${paid} expected=${payment.amountInr} — NOT fulfilling.`);
      throw new BadRequestException('Payment amount mismatch — please contact support with your order id.');
    }

    let cfPaymentId = payment.gatewayOrderId;
    try {
      const payments = await this.cfFetch(`/pg/orders/${encodeURIComponent(payment.gatewayOrderId)}/payments`, { method: 'GET' });
      const successful = Array.isArray(payments) ? payments.find((p: any) => p.payment_status === 'SUCCESS') : null;
      if (successful?.cf_payment_id) cfPaymentId = String(successful.cf_payment_id);
    } catch (e) {
      this.logger.warn(`Could not fetch payment list for ${payment.gatewayOrderId}; using order-level PAID: ${e}`);
    }

    await this.fulfill(payment, cfPaymentId);
    return { state: 'PAID', status: orderStatus };
  }

  // Verify + capture payment. Called by the frontend right after the user
  // lands back on /payment/success. It only uses the frontend-supplied
  // orderId to know WHICH order to check, then asks Cashfree's server.
  async verifyPayment(userId: string, input: { orderId: string }) {
    if (!input?.orderId || typeof input.orderId !== 'string') throw new BadRequestException('orderId is required');
    const payment = await this.prisma.payment.findUnique({ where: { gatewayOrderId: input.orderId } });
    if (!payment) throw new NotFoundException('Order not found');
    if (payment.userId !== userId) throw new BadRequestException('Order belongs to another user');
    if (payment.status === 'SUCCESS') return { ok: true, duplicate: true, kind: (payment.metadataJson as any)?.kind ?? null };

    const r = await this.settleFromGateway(payment);
    if (r.state === 'PENDING') return { ok: false, pending: true, message: 'Payment is still processing' };
    if (r.state === 'FAILED') throw new BadRequestException(`Payment ${(r.status || 'failed').toLowerCase()}`);
    return { ok: true, kind: (payment.metadataJson as any)?.kind ?? null };
  }

  // Cashfree webhook — the reliable path; verifyPayment() is the optimistic
  // one for when the user is watching the browser. fulfil() is idempotent so
  // both (and the reconciler) can fire for the same order.
  async handleWebhook(rawBody: Buffer, signature: string | undefined, timestamp: string | undefined, parsedBody: any) {
    if (!signature || !timestamp) {
      return { ok: true, ignored: true, reason: 'missing_signature_headers' };
    }
    if (!this.cf.webhookSecret) {
      this.logger.error('Cashfree webhook received but no webhook secret is configured — rejecting.');
      return { ok: true, ignored: true, reason: 'webhook_not_configured' };
    }

    // base64(HMAC-SHA256(secret, timestamp + rawBody)) over the EXACT bytes received.
    const expected = crypto.createHmac('sha256', this.cf.webhookSecret).update(timestamp + rawBody.toString('utf-8')).digest('base64');
    const expectedBuf = Buffer.from(expected);
    const gotBuf = Buffer.from(signature);
    const validSignature = expectedBuf.length === gotBuf.length && crypto.timingSafeEqual(expectedBuf, gotBuf);
    if (!validSignature) {
      this.logger.warn('Cashfree webhook signature mismatch — ignoring (possible spoofed request).');
      return { ok: true, ignored: true, reason: 'invalid_signature' };
    }

    const orderId = parsedBody?.data?.order?.order_id;
    const paymentStatus = parsedBody?.data?.payment?.payment_status; // SUCCESS | FAILED | USER_DROPPED | ...
    const cfPaymentId = parsedBody?.data?.payment?.cf_payment_id;
    const eventType = parsedBody?.type; // PAYMENT_SUCCESS_WEBHOOK | PAYMENT_FAILED_WEBHOOK | PAYMENT_USER_DROPPED_WEBHOOK

    if (!orderId) return { ok: true, ignored: true, reason: 'no_order_id' };

    const payment = await this.prisma.payment.findUnique({ where: { gatewayOrderId: orderId } });
    if (!payment) return { ok: true, ignored: true, reason: 'unknown_order' };
    if (payment.status === 'SUCCESS') return { ok: true, duplicate: true };

    if (eventType === 'PAYMENT_SUCCESS_WEBHOOK' && paymentStatus === 'SUCCESS') {
      const paidAmount = Number(parsedBody?.data?.payment?.payment_amount ?? parsedBody?.data?.order?.order_amount);
      if (Number.isFinite(paidAmount) && Math.abs(paidAmount - payment.amountInr) > 0.01) {
        this.logger.error(`Webhook amount mismatch on ${orderId}: got ${paidAmount}, expected ${payment.amountInr} — NOT fulfilling.`);
        return { ok: true, ignored: true, reason: 'amount_mismatch' };
      }
      // If this throws the HTTP response is a 5xx, so Cashfree retries the
      // webhook — a transient DB error no longer leaves a paid order unfulfilled.
      await this.fulfill(payment, String(cfPaymentId || orderId));
      return { ok: true, fulfilled: true, kind: (payment.metadataJson as any)?.kind ?? null };
    }

    if (eventType === 'PAYMENT_FAILED_WEBHOOK' || eventType === 'PAYMENT_USER_DROPPED_WEBHOOK') {
      // Not final: the same order can still be retried and paid, and a later
      // success webhook / verify will fulfil it (fulfil claims `status != SUCCESS`).
      await this.prisma.payment.updateMany({
        where: { gatewayOrderId: orderId, status: { not: 'SUCCESS' } },
        data: { status: 'FAILED' },
      });
      return { ok: true, failed: true };
    }

    return { ok: true, ignored: true, reason: 'unhandled_event_type' };
  }

  /**
   * Referral commission is a side effect of a payment. A referral error must
   * never turn an already-granted purchase into a failed API call.
   */
  private async safeReferral(userId: string, payment: { id: string; amountInr: number }): Promise<void> {
    if (!(payment.amountInr > 0)) return; // free activation earns no commission
    try {
      await this.referralService.onPaidPurchase(userId, { id: payment.id, amountInr: payment.amountInr });
    } catch (e) {
      this.logger.error(`[referral] onPaidPurchase failed for payment ${payment.id}: ${(e as Error)?.message}`);
    }
  }

  /**
   * Shared fulfilment: Payment PENDING -> Subscription / ChapterPurchase / MockAccess / Vocab.
   *
   * ATOMIC: the "claim" (status -> SUCCESS) and every grant happen inside ONE
   * database transaction. Previously the claim was committed first and the
   * grants ran afterwards, so any error in between (missing plan row, DB blip)
   * left a payment marked SUCCESS with NOTHING granted — and since status was
   * already SUCCESS, no retry could ever repair it. Now a failure rolls the
   * claim back too, the payment stays PENDING, and the webhook retry /
   * reconciler fulfils it properly.
   *
   * The conditional UPDATE (`status != SUCCESS`) is still what makes a
   * browser-verify + webhook race safe: exactly one caller sees count === 1.
   */
  private async fulfill(payment: any, gatewayPaymentId: string) {
    const meta = (payment.metadataJson as any) || {};

    const done = await this.prisma.$transaction(
      async (tx) => {
        const claim = await tx.payment.updateMany({
          where: { id: payment.id, status: { not: 'SUCCESS' } },
          data: {
            gatewayPaymentId,
            status: 'SUCCESS',
            invoiceUrl: `${(process.env.FRONTEND_URL || 'https://sscprephub.in').replace(/\/+$/, '')}/invoice/${payment.id}`,
          },
        });
        if (claim.count === 0) return false; // the other path already fulfilled it

        await this.grant(tx, payment, meta);
        await this.consumeCoupon(tx, payment, meta);

        await tx.auditLog.create({
          data: {
            userId: payment.userId,
            action: 'INVOICE_GENERATED',
            targetEntity: 'Payment',
            entityId: payment.id,
            metadataJson: { kind: meta.kind, planId: meta.planId, amountInr: payment.amountInr, couponCode: meta.couponCode ?? null },
          },
        });
        return true;
      },
      { timeout: 20_000, maxWait: 10_000 },
    );

    if (done) await this.safeReferral(payment.userId, payment);
  }

  /** Grants what the payment bought. Runs inside fulfil()'s transaction. */
  private async grant(tx: Prisma.TransactionClient, payment: any, meta: any) {
    const userId: string = payment.userId;

    switch (meta.kind) {
      case 'PLAN': {
        const plan = await tx.plan.findUnique({ where: { id: meta.planId } });
        if (!plan) throw new BadRequestException('Plan missing'); // rolls everything back
        const g = await grantOrExtendSubscription(tx as any, { userId, planId: plan.id, months: plan.durationMonths });
        await tx.payment.update({ where: { id: payment.id }, data: { subscriptionId: g.subscription.id } });
        return;
      }
      case 'CHAPTER':
        await tx.chapterPurchase.upsert({
          where: { userId_chapterId: { userId, chapterId: meta.chapterId } },
          create: { userId, chapterId: meta.chapterId, amountInr: payment.amountInr, status: 'SUCCESS' },
          update: { status: 'SUCCESS' },
        });
        return;
      case 'MOCK':
        await tx.mockAccess.upsert({
          where: { userId_testTemplateId: { userId, testTemplateId: meta.mockTemplateId } },
          create: { userId, testTemplateId: meta.mockTemplateId, paidPacksPurchased: 1 },
          update: { paidPacksPurchased: { increment: 1 } },
        });
        return;
      case 'VOCAB_WORD':
        await tx.vocabWordPurchase.upsert({
          where: { userId_wordId: { userId, wordId: meta.vocabWordId } },
          create: { userId, wordId: meta.vocabWordId, amountInr: payment.amountInr, status: 'SUCCESS' },
          update: { status: 'SUCCESS' },
        });
        await tx.vocabWordProgress.upsert({
          where: { userId_wordId: { userId, wordId: meta.vocabWordId } },
          create: { userId, wordId: meta.vocabWordId, forceUnlocked: true },
          update: { forceUnlocked: true },
        });
        return;
      case 'VOCAB_UNLOCK_ALL':
        await tx.vocabUserState.upsert({
          where: { userId },
          create: { userId, allUnlockedAt: new Date() },
          update: { allUnlockedAt: new Date() },
        });
        return;
      case 'VOCAB_REVISION_SKIP': {
        const dateKey = meta.dateKey || istDateKey(new Date());
        const already = await tx.vocabRevisionSession.findFirst({ where: { userId, dateKey, status: 'SKIPPED' }, select: { id: true } });
        if (already) return;
        const now = new Date();
        await tx.vocabRevisionSession.create({
          data: { userId, dateKey, status: 'SKIPPED', wordIds: [], questionIds: [], skipFeeInr: payment.amountInr, expiresAt: now, completedAt: now },
        });
        await tx.vocabUserState.upsert({
          where: { userId },
          create: { userId, skipStreak: 1, lastSkipDateKey: dateKey, totalSkipPaidInr: payment.amountInr },
          update: { skipStreak: { increment: 1 }, lastSkipDateKey: dateKey, totalSkipPaidInr: { increment: payment.amountInr } },
        });
        return;
      }
      case 'VOCAB_SUBSCRIPTION': {
        const existing = await tx.vocabSubscription.findUnique({ where: { userId } });
        const base = existing && existing.expiresAt > new Date() ? existing.expiresAt : new Date();
        const expiresAt = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);
        await tx.vocabSubscription.upsert({
          where: { userId },
          create: { userId, expiresAt, amountInr: payment.amountInr, status: 'SUCCESS' },
          update: { expiresAt, amountInr: payment.amountInr, status: 'SUCCESS' },
        });
        return;
      }
      default:
        // Unknown kind: fail loudly (rolls back) instead of silently taking money for nothing.
        throw new BadRequestException(`Unknown payment kind "${meta.kind}" on payment ${payment.id}`);
    }
  }

  /**
   * maxUses is only checked at order time, so two concurrent orders can both
   * pass. Re-check atomically here; the purchase stays valid (already paid)
   * but an over-redemption is logged for the admin.
   */
  private async consumeCoupon(tx: Prisma.TransactionClient, payment: any, meta: any) {
    if (!meta.couponCode) return;
    const code = String(meta.couponCode).trim().toUpperCase();
    const coupon = await tx.coupon.findUnique({ where: { code } });
    if (!coupon) return;
    const claim = await tx.coupon.updateMany({
      where: { code, OR: [{ maxUses: { lte: 0 } }, { usesCount: { lt: coupon.maxUses } }] },
      data: { usesCount: { increment: 1 } },
    });
    if (claim.count === 0) {
      await tx.auditLog.create({
        data: {
          userId: payment.userId,
          action: 'COUPON_OVER_REDEEMED',
          targetEntity: 'Coupon',
          entityId: coupon.id,
          metadataJson: { code, maxUses: coupon.maxUses, paymentId: payment.id },
        },
      });
    }
  }

  // ---- Chapter purchases ----
  async myChapterPurchases(userId: string) {
    const rows = await this.prisma.chapterPurchase.findMany({
      where: { userId, status: 'SUCCESS' },
      include: { chapter: { select: { id: true, name: true } } },
    });
    return rows.map((r) => ({ chapterId: r.chapterId, chapterName: r.chapter?.name, amountInr: r.amountInr, purchasedAt: r.createdAt }));
  }

  // ---- Payment history + invoices ----
  private describe(meta: any): string {
    switch (meta?.kind) {
      case 'PLAN': return meta.planName || 'Premium plan';
      case 'CHAPTER': return `Chapter PDF${meta.chapterName ? `: ${meta.chapterName}` : ''}`;
      case 'MOCK': return `Mock test${meta.mockTitle ? `: ${meta.mockTitle}` : ''}`;
      case 'VOCAB_WORD': return `Vocabulary word unlock${meta.vocabWord ? `: ${meta.vocabWord}` : ''}`;
      case 'VOCAB_UNLOCK_ALL': return 'Vocabulary: unlock all words';
      case 'VOCAB_SUBSCRIPTION': return 'Vocabulary monthly subscription';
      case 'VOCAB_REVISION_SKIP': return 'Vocabulary revision skip';
      default: return 'SSC Prep Hub purchase';
    }
  }

  async paymentHistory(userId: string) {
    const rows = await this.prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((p) => {
      const m = (p.metadataJson as any) || {};
      return {
        id: p.id,
        orderId: p.gatewayOrderId,
        title: this.describe(m),
        kind: m.kind ?? null,
        amountInr: p.amountInr,
        // total saved = running offer + coupon (couponDiscount alone is kept for the "Coupon X (− ₹Y)" line)
        discount: (m.discount ?? 0) + (m.offerDiscount ?? 0),
        couponDiscount: m.discount ?? 0,
        offerDiscount: m.offerDiscount ?? 0,
        couponCode: m.couponCode ?? null,
        status: p.status,
        createdAt: p.createdAt,
        canInvoice: p.status === 'SUCCESS',
      };
    });
  }

  async invoice(userId: string, paymentId: string) {
    const p = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { user: { select: { fullName: true, email: true, phone: true } }, subscription: { include: { plan: true } } },
    });
    if (!p || p.userId !== userId) throw new NotFoundException('Invoice not found');
    if (p.status !== 'SUCCESS') throw new BadRequestException('Invoice is available only for successful payments');
    const m = (p.metadataJson as any) || {};
    const d = p.createdAt;
    return {
      invoiceNo: `INV-${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}-${p.id.slice(0, 8).toUpperCase()}`,
      date: d,
      orderId: p.gatewayOrderId,
      transactionId: p.gatewayPaymentId,
      customer: { name: p.user.fullName, email: p.user.email, phone: p.user.phone },
      item: this.describe(m),
      kind: m.kind ?? null,
      listPriceInr: m.originalAmountInr ?? p.amountInr + (m.discount ?? 0),
      // discountInr = coupon part (older invoices); offerDiscountInr = running-offer part (new)
      discountInr: m.discount ?? 0,
      offerDiscountInr: m.offerDiscount ?? 0,
      offerPct: m.offerPct ?? null,
      couponCode: m.couponCode ?? null,
      paidInr: p.amountInr,
      validFrom: p.subscription?.startsAt ?? null,
      validUntil: p.subscription?.endsAt ?? null,
      seller: 'SSC Prep Hub',
    };
  }

  // ---- Auto-pay ----
  // Honest status: true recurring debit needs Cashfree Subscriptions (UPI
  // AutoPay / eMandate) which is not integrated. The old endpoints only wrote
  // an audit-log row while telling the user "will renew automatically" — and
  // nothing ever renewed. They now say so; one-click renewal is /payments/renew.
  async enableAutoPay(_userId: string, _subscriptionId: string) {
    throw new BadRequestException('Auto-renew is not available yet. Use "Renew now" to extend your plan in one click — your remaining days are always kept.');
  }

  async disableAutoPay(_userId: string, _subscriptionId: string) {
    return { ok: true, message: 'Auto-renew is not enabled for your account.' };
  }
}
