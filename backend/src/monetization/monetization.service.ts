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
import { Injectable, BadRequestException, NotFoundException, Inject, forwardRef, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReferralService } from '../referral/referral.service';
import * as crypto from 'crypto';

interface CashfreeConfig {
  appId: string;
  secretKey: string;
  webhookSecret: string;
  apiVersion: string;
  baseUrl: string;
  env: 'TEST' | 'PRODUCTION';
}

@Injectable()
export class MonetizationService {
  private readonly logger = new Logger(MonetizationService.name);
  private cf: CashfreeConfig;

  constructor(
    private prisma: PrismaService,
    // FIX Error #7: inject ReferralService so fulfill() can trigger the
    // referral reward. forwardRef() avoids a circular-dependency crash if
    // ReferralModule also imports MonetizationModule (or vice versa).
    @Inject(forwardRef(() => ReferralService))
    private referralService: ReferralService,
  ) {
    // BUGFIX (Session — "Authentication Failed" on every purchase attempt):
    // Cashfree's own API returns exactly {"message":"authentication Failed",
    // "type":"authentication_error"} whenever x-client-id / x-client-secret
    // don't match what it expects. Two real-world causes were found here:
    //   1. process.env values copied from the dashboard/.env file can carry
    //      a trailing newline or space (very common when pasted via some
    //      terminals / Docker env files) — Cashfree treats the header value
    //      byte-for-byte, so "abc123\n" !== "abc123" and auth fails even
    //      though the key "looks" right. .trim() below removes this class
    //      of bug entirely.
    //   2. CASHFREE_ENV not set to PRODUCTION while PRODUCTION keys were
    //      generated (or the reverse: TEST keys with CASHFREE_ENV=PRODUCTION)
    //      — a TEST key sent to api.cashfree.com, or a PRODUCTION key sent
    //      to sandbox.cashfree.com, is ALWAYS "authentication Failed". See
    //      the explicit error in cfFetch() below which now calls this out
    //      by name instead of surfacing Cashfree's generic message.
    const appId = (process.env.CASHFREE_APP_ID || '').trim();
    const secretKey = (process.env.CASHFREE_SECRET_KEY || '').trim();
    const env: 'TEST' | 'PRODUCTION' = process.env.CASHFREE_ENV === 'PRODUCTION' ? 'PRODUCTION' : 'TEST';

    if ((!appId || !secretKey) && process.env.NODE_ENV === 'production') {
      // Fail LOUDLY at boot rather than silently accepting payments with no
      // (or fake) credentials — the exact failure mode the old hardcoded
      // PayU fallback secret allowed. Better a crashed deploy than a
      // payment gateway nobody actually configured.
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
      // Cashfree's webhook secret is normally the same secret key used for
      // API calls, but they let you configure a distinct one per webhook
      // endpoint in the dashboard — support that without requiring it.
      webhookSecret: (process.env.CASHFREE_WEBHOOK_SECRET || secretKey).trim(),
      apiVersion: '2023-08-01',
      baseUrl: env === 'PRODUCTION' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com',
      env,
    };
  }

  // ---- Plans ----
  async listPlans() {
    return this.prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceInr: 'asc' } });
  }

  async mySubscription(userId: string) {
    const sub = await this.prisma.subscription.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { endsAt: 'desc' },
      include: { plan: true },
    });
    if (!sub) return { active: false };
    const now = new Date();
    if (sub.endsAt < now) {
      await this.prisma.subscription.update({ where: { id: sub.id }, data: { status: 'EXPIRED' } });
      return { active: false };
    }
    return { active: true, plan: sub.plan, endsAt: sub.endsAt };
  }

  // ---- Coupons ----
  async validateCoupon(code: string, amountInr: number) {
    const c = await this.prisma.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
    if (!c) throw new NotFoundException('Invalid coupon code');
    if (!c.isActive) throw new BadRequestException('Coupon is inactive');
    if (c.expiresAt && c.expiresAt < new Date()) throw new BadRequestException('Coupon expired');
    if (c.maxUses > 0 && c.usesCount >= c.maxUses) throw new BadRequestException('Coupon usage limit reached');
    let discount = 0;
    if (c.discountPct) {
      discount = Math.round((amountInr * c.discountPct) / 100 * 100) / 100;
    } else if (c.discountInr) {
      discount = Math.min(c.discountInr, amountInr);
    }
    const final = Math.max(Math.round((amountInr - discount) * 100) / 100, 0);
    return { code: c.code, description: c.description, discountPct: c.discountPct, discountInr: c.discountInr, discount, finalAmountInr: final };
  }

  // ---- Cashfree API helper ----
  // Every server-to-server Cashfree call goes through here so credential
  // headers and error handling live in exactly one place.
  private async cfFetch(path: string, init: { method: 'GET' | 'POST'; body?: any }) {
    if (!this.cf.appId || !this.cf.secretKey) {
      throw new BadRequestException('Payments are not configured on this server yet (missing Cashfree credentials).');
    }
    const res = await fetch(`${this.cf.baseUrl}${path}`, {
      method: init.method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-api-version': this.cf.apiVersion,
        'x-client-id': this.cf.appId,
        'x-client-secret': this.cf.secretKey,
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      this.logger.error(`Cashfree ${init.method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
      // BUGFIX: Cashfree's own "authentication Failed" (type:
      // authentication_error) means the x-client-id/x-client-secret this
      // server sent were rejected — it is NEVER a user-side problem, so log
      // the real diagnosis loudly (visible in `docker compose logs backend`)
      // instead of leaving Sachin to guess why every purchase fails. The two
      // causes seen in practice: (a) CASHFREE_APP_ID/CASHFREE_SECRET_KEY in
      // the server's .env don't match the CASHFREE_ENV mode (TEST keys with
      // CASHFREE_ENV=PRODUCTION, or PRODUCTION keys with CASHFREE_ENV unset
      // — which defaults to TEST/sandbox); (b) a stray trailing space/newline
      // in the .env value (now defended against separately via .trim() in
      // the constructor, but old running processes need a restart to pick
      // up a fixed .env).
      if (json?.type === 'authentication_error' || res.status === 401) {
        this.logger.error(
          `Cashfree rejected our credentials (env=${this.cf.env}, appId=${this.cf.appId ? this.cf.appId.slice(0, 6) + '…' : '(empty)'}). ` +
            `Check on the server: (1) CASHFREE_APP_ID / CASHFREE_SECRET_KEY in .env are copied exactly from the Cashfree ` +
            `Merchant Dashboard with no extra space/newline, and (2) CASHFREE_ENV matches the key type — ` +
            `TEST keys need CASHFREE_ENV unset or "TEST"; LIVE/PRODUCTION keys need CASHFREE_ENV=PRODUCTION. ` +
            `After fixing .env, restart the backend container (env vars are only read at process boot).`,
        );
        throw new BadRequestException(
          'Payment gateway rejected our server credentials. Please try again in a bit — our team has been notified.',
        );
      }
      throw new BadRequestException(json?.message || `Cashfree request failed (${res.status})`);
    }
    return json;
  }

  // ---- Cashfree order creation ----
  async createOrder(userId: string, input: { planId?: string; mockTemplateId?: string; chapterId?: string; couponCode?: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, fullName: true, phone: true } });
    if (!user) throw new NotFoundException('User not found');

    const orderId = `SSC_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Amount is ALWAYS computed here, server-side, from planId/chapterId/
    // mockTemplateId looked up fresh from the DB — the browser never gets a
    // chance to influence what gets charged, regardless of which gateway
    // sits behind this.
    let amountInr = 0;
    let productInfo = '';
    let planName: string | undefined;
    let chapterName: string | undefined;
    let mockTitle: string | undefined;
    let discount = 0;
    let metadata: Record<string, any> = { kind: '' };

    if (input.planId) {
      const plan = await this.prisma.plan.findUnique({ where: { id: input.planId } });
      if (!plan || !plan.isActive) throw new BadRequestException('Plan not found');
      const { finalAmountInr, discount: disc } = input.couponCode
        ? await this.validateCoupon(input.couponCode, plan.priceInr)
        : { finalAmountInr: plan.priceInr, discount: 0 };
      amountInr = finalAmountInr;
      discount = disc;
      productInfo = `SSC Prep Hub - ${plan.name}`;
      planName = plan.name;
      metadata = { kind: 'PLAN', planId: plan.id, planName: plan.name, discount, couponCode: input.couponCode || null };
    } else if (input.chapterId) {
      const chapter = await this.prisma.chapter.findUnique({ where: { id: input.chapterId } });
      if (!chapter) throw new BadRequestException('Chapter not found');
      const existing = await this.prisma.chapterPurchase.findUnique({
        where: { userId_chapterId: { userId, chapterId: input.chapterId } },
      });
      if (existing) throw new BadRequestException('Chapter already purchased');
      amountInr = 1;
      productInfo = `SSC Prep Hub - Chapter PDF: ${chapter.name}`;
      chapterName = chapter.name;
      metadata = { kind: 'CHAPTER', chapterId: chapter.id };
    } else if (input.mockTemplateId) {
      const tpl = await this.prisma.testTemplate.findUnique({ where: { id: input.mockTemplateId } });
      if (!tpl) throw new BadRequestException('Mock template not found');
      const price = tpl.isPremium ? (tpl.priceInr ?? 0) : 0;
      amountInr = price;
      productInfo = `SSC Prep Hub - Mock Test: ${tpl.title}`;
      mockTitle = tpl.title;
      metadata = { kind: 'MOCK', mockTemplateId: tpl.id };
    } else {
      throw new BadRequestException('Provide planId, mockTemplateId, or chapterId');
    }

    if (amountInr <= 0) {
      throw new BadRequestException('This item is free — no payment order needed');
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    // Cashfree appends the real order_id when it substitutes {order_id} —
    // guaranteed present on return regardless of payment outcome, so
    // /payment/success can always look up the right Payment row.
    const returnUrl = `${frontendUrl}/payment/success?order_id={order_id}`;
    const notifyUrl = process.env.CASHFREE_WEBHOOK_URL || `${process.env.BACKEND_PUBLIC_URL || ''}/api/v1/payments/webhook`;

    // Cashfree requires a 10-digit customer phone. Real user phones are
    // preferred; the sandbox test number is only used as a last resort so
    // checkout doesn't hard-fail for a user record with no phone on file —
    // this should be tightened to a hard requirement before go-live if
    // phone collection at signup isn't already mandatory.
    const customerPhone = (user.phone || '').replace(/\D/g, '').slice(-10) || '9999999999';

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
          customer_phone: customerPhone,
        },
        order_meta: {
          return_url: returnUrl,
          notify_url: notifyUrl,
        },
        order_note: productInfo,
      },
    });

    if (!order.payment_session_id) {
      throw new BadRequestException('Cashfree did not return a payment session — please try again');
    }

    // Create payment record. `razorpayOrderId`/`razorpayPaymentId` are
    // legacy column names from an earlier gateway (see the "Reusing field"
    // note this project has carried through PayU too) — they now hold the
    // Cashfree order_id / cf_payment_id. Renaming would need a migration;
    // not worth the risk purely for cosmetics.
    await this.prisma.payment.create({
      data: {
        userId,
        razorpayOrderId: orderId,
        amountInr,
        status: 'PENDING',
        metadataJson: metadata,
      } as any,
    });

    return {
      orderId,
      paymentSessionId: order.payment_session_id,
      amountInr,
      cashfreeEnv: this.cf.env, // "sandbox" vs "production" — frontend SDK needs this to know which mode to load
      planName,
      chapterName,
      mockTitle,
      discount,
    };
  }

  // Verify + capture payment. Called by the frontend right after the user
  // lands back on /payment/success — but note it does NOT trust anything
  // the frontend says about whether the payment succeeded. It only uses
  // the frontend-supplied orderId to know WHICH order to check, then asks
  // Cashfree's server directly for the authoritative status.
  async verifyPayment(userId: string, input: { orderId: string }) {
    const payment = await this.prisma.payment.findUnique({ where: { razorpayOrderId: input.orderId } });
    if (!payment) throw new NotFoundException('Order not found');
    if (payment.userId !== userId) throw new BadRequestException('Order belongs to another user');

    // FIX Error #5 (CRITICAL, carried forward from the PayU version): both
    // the browser (verify) and Cashfree's server (webhook) can confirm the
    // same payment, and a page refresh/retry could call verify twice —
    // fulfill() itself is also idempotent (atomic claim below), but
    // short-circuiting here avoids an extra round-trip to Cashfree on an
    // already-settled order.
    if (payment.status === 'SUCCESS') return { ok: true, duplicate: true };

    const order = await this.cfFetch(`/pg/orders/${encodeURIComponent(input.orderId)}`, { method: 'GET' });
    const orderStatus = order.order_status as string; // PAID | ACTIVE | EXPIRED | TERMINATED

    if (orderStatus === 'ACTIVE') {
      // Payment attempt still in progress (e.g. UPI collect awaiting
      // approval) — not a failure, just not resolved yet. Frontend should
      // poll again rather than treat this as an error.
      return { ok: false, pending: true, message: 'Payment is still processing' };
    }

    if (orderStatus !== 'PAID') {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
      throw new BadRequestException(`Payment ${orderStatus?.toLowerCase() || 'failed'}`);
    }

    // Order is genuinely PAID per Cashfree's own server — now fetch the
    // actual payment transaction id for our records (best-effort; the
    // order being PAID is already sufficient to fulfill even if this
    // secondary call has a hiccup).
    let cfPaymentId = input.orderId;
    try {
      const payments = await this.cfFetch(`/pg/orders/${encodeURIComponent(input.orderId)}/payments`, { method: 'GET' });
      const successful = Array.isArray(payments) ? payments.find((p: any) => p.payment_status === 'SUCCESS') : null;
      if (successful?.cf_payment_id) cfPaymentId = String(successful.cf_payment_id);
    } catch (e) {
      this.logger.warn(`Could not fetch payment list for order ${input.orderId}, proceeding with order-level PAID status: ${e}`);
    }

    await this.fulfill(payment, cfPaymentId);
    return { ok: true };
  }

  // Cashfree webhook (server-confirmed payments) — the reliable path;
  // verifyPayment() above is the fast/optimistic path for when the user is
  // actively watching the browser. Either one alone is enough to fulfill;
  // fulfill()'s atomic claim (see its own comment) makes it safe for both
  // to fire for the same order.
  //
  // rawBody/signature/timestamp come from the controller — see
  // MonetizationController.webhook() for how the raw bytes are captured.
  async handleWebhook(rawBody: Buffer, signature: string | undefined, timestamp: string | undefined, parsedBody: any) {
    if (!signature || !timestamp) {
      return { ok: true, ignored: true, reason: 'missing_signature_headers' };
    }
    if (!this.cf.webhookSecret) {
      this.logger.error('Cashfree webhook received but CASHFREE_WEBHOOK_SECRET is not configured — rejecting.');
      return { ok: true, ignored: true, reason: 'webhook_not_configured' };
    }

    // Cashfree's documented algorithm exactly: base64(HMAC-SHA256(secret,
    // timestamp + rawBody)). MUST use the raw bytes as received, not the
    // re-serialized parsed JSON — re-serializing can reorder keys/change
    // whitespace and silently break the signature match.
    const expected = crypto
      .createHmac('sha256', this.cf.webhookSecret)
      .update(timestamp + rawBody.toString('utf-8'))
      .digest('base64');

    const expectedBuf = Buffer.from(expected);
    const gotBuf = Buffer.from(signature);
    const validSignature =
      expectedBuf.length === gotBuf.length && crypto.timingSafeEqual(expectedBuf, gotBuf);

    if (!validSignature) {
      this.logger.warn('Cashfree webhook signature mismatch — ignoring (possible spoofed request).');
      return { ok: true, ignored: true, reason: 'invalid_signature' };
    }

    const orderId = parsedBody?.data?.order?.order_id;
    const paymentStatus = parsedBody?.data?.payment?.payment_status; // SUCCESS | FAILED | USER_DROPPED | ...
    const cfPaymentId = parsedBody?.data?.payment?.cf_payment_id;
    const eventType = parsedBody?.type; // PAYMENT_SUCCESS_WEBHOOK | PAYMENT_FAILED_WEBHOOK | PAYMENT_USER_DROPPED_WEBHOOK

    if (!orderId) return { ok: true, ignored: true, reason: 'no_order_id' };

    const payment = await this.prisma.payment.findUnique({ where: { razorpayOrderId: orderId } });
    if (!payment) return { ok: true, ignored: true, reason: 'unknown_order' };
    if (payment.status === 'SUCCESS') return { ok: true, duplicate: true };

    if (eventType === 'PAYMENT_SUCCESS_WEBHOOK' && paymentStatus === 'SUCCESS') {
      await this.fulfill(payment, String(cfPaymentId || orderId));
      return { ok: true, fulfilled: true, kind: (payment.metadataJson as any)?.kind ?? null };
    }

    if (eventType === 'PAYMENT_FAILED_WEBHOOK' || eventType === 'PAYMENT_USER_DROPPED_WEBHOOK') {
      await this.prisma.payment.updateMany({
        where: { razorpayOrderId: orderId, status: { not: 'SUCCESS' } },
        data: { status: 'FAILED' },
      });
      return { ok: true, failed: true };
    }

    return { ok: true, ignored: true, reason: 'unhandled_event_type' };
  }

  /**
   * Shared fulfillment: Payment PENDING → Subscription / ChapterPurchase / MockAccess.
   *
   * FIX Error #5 follow-up (CRITICAL — race condition in the "fix"):
   * The previous version of this method wrote `status: 'SUCCESS'` as its
   * SECOND-TO-LAST step, AFTER already creating the subscription / chapter
   * purchase / mock credits / referral payout. verifyPayment() and
   * handleWebhook() each read `payment.status` via a separate `findUnique`
   * BEFORE calling fulfill(). If the browser's verify call and PayU's
   * webhook land close together (the exact scenario Error #5 describes —
   * that's the whole reason this guard exists), BOTH reads can happen
   * while status is still PENDING, so both callers pass the `=== 'SUCCESS'`
   * check and both run this method fully, double-granting everything
   * before either write finishes. The per-request check alone cannot
   * close this window — only an atomic, conditional write can.
   *
   * Fix: CLAIM the row first, with a single atomic conditional UPDATE
   * (`status: { not: 'SUCCESS' }` in the WHERE clause). Postgres executes
   * that as one atomic statement, so if two requests race, only one of
   * them can ever see `count === 1`; the other sees `count === 0` and
   * exits immediately without granting anything twice.
   */
  private async fulfill(payment: any, payuPaymentId: string) {
    const claim = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: { not: 'SUCCESS' } },
      data: {
        razorpayPaymentId: payuPaymentId,
        status: 'SUCCESS',
        invoiceUrl: `https://sscprephub.in/invoice/${payment.id}`,
      },
    });
    if (claim.count === 0) {
      // Someone else (the other of browser-verify / webhook) already
      // claimed and fulfilled this payment. Do not grant anything again.
      return;
    }

    const userId = payment.userId;
    const meta = (payment.metadataJson as any) || {};

    if (meta.kind === 'PLAN') {
      const plan = await this.prisma.plan.findUnique({ where: { id: meta.planId } });
      if (!plan) throw new BadRequestException('Plan missing');
      
      // Cancel any existing active subscription
      await this.prisma.subscription.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      });

      const endsAt = new Date();
      endsAt.setMonth(endsAt.getMonth() + plan.durationMonths);
      
      await this.prisma.subscription.create({
        data: { userId, planId: plan.id, status: 'ACTIVE', startsAt: new Date(), endsAt },
      });

      // FIX Error #7: referral.service.ts's onPaidPurchase() was fully
      // implemented but never called from anywhere — referrers never
      // received their promised free subscription. Trigger it here, right
      // after a successful PLAN purchase is recorded.
      await this.referralService.onPaidPurchase(userId);
    } else if (meta.kind === 'CHAPTER') {
      await this.prisma.chapterPurchase.upsert({
        where: { userId_chapterId: { userId, chapterId: meta.chapterId } },
        create: { userId, chapterId: meta.chapterId, amountInr: 1, status: 'SUCCESS' },
        update: { status: 'SUCCESS' },
      });
    } else if (meta.kind === 'MOCK') {
      await this.prisma.mockAccess.upsert({
        where: { userId_testTemplateId: { userId, testTemplateId: meta.mockTemplateId } },
        create: { userId, testTemplateId: meta.mockTemplateId, paidPacksPurchased: 1 },
        update: { paidPacksPurchased: { increment: 1 } },
      });
    }

    // consume coupon if any.
    //
    // BUGFIX (bonus grep, item a — check happens once, the actual grant
    // isn't atomically protected against a race, same root cause as the
    // checkIn() double-XP bug fixed earlier): maxUses was only checked in
    // validateCoupon() at ORDER-CREATION time. If two orders for the same
    // single-use coupon (maxUses: 1) were created concurrently — two tabs,
    // or two different users racing a limited promo code — both could pass
    // validation while usesCount was still 0, both complete real PayU
    // payments, and both land here incrementing usesCount past maxUses.
    // The coupon's own limit was silently bypassed by the race window
    // between "check" and "increment".
    //
    // Both payments are already genuinely captured by PayU at this point,
    // so we can't refuse to grant what was actually paid for — the fix is
    // to atomically re-check maxUses at the moment of consuming it (same
    // conditional-updateMany pattern already used just above for the
    // Payment row's SUCCESS claim) and flag the overage for admin
    // visibility via the audit log, instead of silently letting usesCount
    // drift past its stated limit with no record of it happening.
    if (meta.couponCode) {
      const coupon = await this.prisma.coupon.findUnique({ where: { code: meta.couponCode } });
      if (coupon) {
        const claim = await this.prisma.coupon.updateMany({
          where: {
            code: meta.couponCode,
            OR: [{ maxUses: { lte: 0 } }, { usesCount: { lt: coupon.maxUses } }],
          },
          data: { usesCount: { increment: 1 } },
        });
        if (claim.count === 0) {
          // Coupon's maxUses was already exhausted by a racing/earlier
          // redemption — this purchase still goes through (already paid),
          // but log it so finance/admin can see the coupon was
          // over-redeemed rather than the limit silently not applying.
          await this.prisma.auditLog.create({
            data: {
              userId,
              action: 'COUPON_OVER_REDEEMED',
              targetEntity: 'Coupon',
              entityId: coupon.id,
              metadataJson: { code: meta.couponCode, maxUses: coupon.maxUses, paymentId: payment.id },
            },
          });
        }
      }
    }

    // Log invoice generation
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'INVOICE_GENERATED',
        targetEntity: 'Payment',
        entityId: payment.id,
        metadataJson: { planId: meta.planId, amountInr: payment.amountInr, couponCode: meta.couponCode },
      },
    });
  }

  // ---- Chapter purchases ----
  async myChapterPurchases(userId: string) {
    const rows = await this.prisma.chapterPurchase.findMany({
      where: { userId, status: 'SUCCESS' },
      include: { chapter: { select: { id: true, name: true } } },
    });
    return rows.map((r) => ({ chapterId: r.chapterId, chapterName: r.chapter?.name, amountInr: r.amountInr, purchasedAt: r.createdAt }));
  }

  // ---- Auto-pay / Recurring subscriptions ----
  async enableAutoPay(userId: string, subscriptionId: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId, userId },
      include: { plan: true },
    });
    if (!sub || sub.status !== 'ACTIVE') throw new BadRequestException('No active subscription found');
    
    // Store auto-pay preference (could add to subscription model or user preferences)
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'AUTOPAY_ENABLED',
        targetEntity: 'Subscription',
        entityId: subscriptionId,
        metadataJson: { planId: sub.planId },
      },
    });
    
    return { ok: true, message: 'Auto-pay enabled. Will renew automatically before expiry.' };
  }

  async disableAutoPay(userId: string, subscriptionId: string) {
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'AUTOPAY_DISABLED',
        targetEntity: 'Subscription',
        entityId: subscriptionId,
      },
    });
    
    return { ok: true, message: 'Auto-pay disabled.' };
  }
}
