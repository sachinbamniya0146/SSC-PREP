// P2 — monetization service: Razorpay orders, coupons, subscription plans, chapter purchases.
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MonetizationService {
  constructor(private prisma: PrismaService) {}

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

  // ---- Razorpay order ----
  async createOrder(userId: string, input: { planId?: string; mockTemplateId?: string; chapterId?: string; couponCode?: string }) {
    const razorpay = await this.getRazorpay();
    const keyId = process.env.RAZORPAY_KEY_ID || '';

    if (input.planId) {
      const plan = await this.prisma.plan.findUnique({ where: { id: input.planId } });
      if (!plan || !plan.isActive) throw new BadRequestException('Plan not found');
      const { finalAmountInr, discount } = input.couponCode
        ? await this.validateCoupon(input.couponCode, plan.priceInr)
        : { finalAmountInr: plan.priceInr, discount: 0 };
      const order = await razorpay.orders.create({
        amount: Math.round(finalAmountInr * 100),
        currency: 'INR',
        receipt: `plan-${plan.id.slice(0, 12)}`,
        notes: { userId, planId: plan.id, coupon: input.couponCode || '' },
      });
      await this.prisma.payment.create({
        data: {
          userId,
          razorpayOrderId: order.id,
          amountInr: finalAmountInr,
          status: 'PENDING',
          metadataJson: { kind: 'PLAN', planId: plan.id, planName: plan.name, discount, couponCode: input.couponCode || null },
        } as any,
      });
      return { orderId: order.id, amountInr: finalAmountInr, keyId, discount, planName: plan.name };
    }

    if (input.chapterId) {
      const chapter = await this.prisma.chapter.findUnique({ where: { id: input.chapterId } });
      if (!chapter) throw new BadRequestException('Chapter not found');
      const existing = await this.prisma.chapterPurchase.findUnique({
        where: { userId_chapterId: { userId, chapterId: input.chapterId } },
      });
      if (existing) throw new BadRequestException('Chapter already purchased');
      const order = await razorpay.orders.create({
        amount: 100, // ₹1.00
        currency: 'INR',
        receipt: `chapter-${chapter.id.slice(0, 12)}`,
        notes: { userId, chapterId: chapter.id },
      });
      await this.prisma.payment.create({
        data: {
          userId,
          razorpayOrderId: order.id,
          amountInr: 1,
          status: 'PENDING',
          metadataJson: { kind: 'CHAPTER', chapterId: chapter.id },
        } as any,
      });
      return { orderId: order.id, amountInr: 1, keyId, chapterName: chapter.name };
    }

    if (input.mockTemplateId) {
      const tpl = await this.prisma.testTemplate.findUnique({ where: { id: input.mockTemplateId } });
      if (!tpl) throw new BadRequestException('Mock template not found');
      const price = tpl.isPremium ? 10 : 0; // ₹10 per premium mock (offer price)
      const order = await razorpay.orders.create({
        amount: Math.round(price * 100),
        currency: 'INR',
        receipt: `mock-${tpl.id.slice(0, 12)}`,
        notes: { userId, mockTemplateId: tpl.id },
      });
      await this.prisma.payment.create({
        data: {
          userId,
          razorpayOrderId: order.id,
          amountInr: price,
          status: 'PENDING',
          metadataJson: { kind: 'MOCK', mockTemplateId: tpl.id },
        } as any,
      });
      return { orderId: order.id, amountInr: price, keyId, mockTitle: tpl.title };
    }

    throw new BadRequestException('Provide planId, mockTemplateId, or chapterId');
  }

  // Verify + capture payment (called from frontend after Razorpay checkout; or webhook).
  async verifyPayment(userId: string, input: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) {
    const payment = await this.prisma.payment.findUnique({ where: { razorpayOrderId: input.razorpayOrderId } });
    if (!payment) throw new NotFoundException('Order not found');
    if (payment.userId !== userId) throw new BadRequestException('Order belongs to another user');

    const crypto = await import('crypto');
    const secret = process.env.RAZORPAY_KEY_SECRET || '';
    const body = `${input.razorpayOrderId}|${input.razorpayPaymentId}`;
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    if (expected !== input.razorpaySignature) throw new BadRequestException('Invalid payment signature');

    await this.fulfill(payment, input.razorpayPaymentId);
    return { ok: true };
  }

  /**
   * v3 §1 — Razorpay webhook (server-confirmed payments). The client success
   * callback is forgeable; only a signature-verified webhook writes the
   * ChapterPurchase/Subscription/MockAccess rows. Idempotent: already-SUCCESS
   * payments are acked without re-fulfilling (Razorpay retries on non-2xx).
   */
  async handleWebhook(rawBody: Buffer | string | undefined, signature: string | undefined) {
    const crypto = await import('crypto');
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
    if (!secret) throw new BadRequestException('Webhook secret not configured on server');

    const bodyStr = typeof rawBody === 'string' ? rawBody : (rawBody as Buffer | undefined)?.toString('utf8') ?? '';
    if (!bodyStr) throw new BadRequestException('Empty webhook body');

    const expected = crypto.createHmac('sha256', secret).update(bodyStr).digest('hex');
    const sigOk = signature && expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    if (!sigOk) throw new BadRequestException('Invalid webhook signature');

    let event: any;
    try {
      event = JSON.parse(bodyStr);
    } catch {
      throw new BadRequestException('Malformed webhook payload');
    }
    const eventName = event?.event || '';
    const entity = event?.payload?.payment?.entity ?? null;

    if (eventName === 'payment.captured' && entity) {
      const orderId: string = entity.order_id || '';
      const paymentId: string = entity.id || '';
      if (!orderId) return { ok: true, ignored: true, reason: 'no_order_id' };

      const payment = await this.prisma.payment.findUnique({ where: { razorpayOrderId: orderId } });
      if (!payment) {
        // Unknown order — ack so Razorpay stops retrying; nothing to fulfill.
        return { ok: true, ignored: true, reason: 'unknown_order' };
      }
      if (payment.status === 'SUCCESS') {
        return { ok: true, duplicate: true };
      }
      await this.fulfill(payment, paymentId);
      return { ok: true, fulfilled: true, kind: (payment.metadataJson as any)?.kind ?? null };
    }

    if (eventName === 'payment.failed' && entity) {
      await this.prisma.payment.updateMany({
        where: { razorpayOrderId: entity.order_id || '' },
        data: { status: 'FAILED' },
      });
      return { ok: true, ignored: false, failed: true };
    }

    return { ok: true, ignored: true, reason: 'unhandled_event' };
  }

  /** Shared fulfillment: Payment PENDING → Subscription / ChapterPurchase / MockAccess. */
  private async fulfill(payment: any, razorpayPaymentId: string) {
    const userId = payment.userId;
    const meta = (payment.metadataJson as any) || {};
    if (meta.kind === 'PLAN') {
      const plan = await this.prisma.plan.findUnique({ where: { id: meta.planId } });
      if (!plan) throw new BadRequestException('Plan missing');
      const endsAt = new Date();
      endsAt.setMonth(endsAt.getMonth() + plan.durationMonths);
      await this.prisma.subscription.create({
        data: { userId, planId: plan.id, status: 'ACTIVE', startsAt: new Date(), endsAt },
      });
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

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { razorpayPaymentId, status: 'SUCCESS' },
    });
    // consume coupon if any
    if (meta.couponCode) {
      await this.prisma.coupon.updateMany({
        where: { code: meta.couponCode },
        data: { usesCount: { increment: 1 } },
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

  private async getRazorpay() {
    const keyId = process.env.RAZORPAY_KEY_ID || '';
    const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
    if (!keyId || !keySecret) {
      // No keys configured → local fallback (dev mode): accept any signature via mock.
      throw new BadRequestException('Payments not configured — Razorpay keys missing');
    }
    const Razorpay = require('razorpay');
    return new Razorpay({ key_id: keyId, key_secret: keySecret });
  }
}
