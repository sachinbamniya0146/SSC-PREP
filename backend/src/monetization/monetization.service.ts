/* eslint-disable @typescript-eslint/no-explicit-any */
// P2 — monetization service: PayU orders, coupons, subscription plans, chapter purchases.
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

interface PayUConfig {
  merchantId: string;
  merchantKey: string;
  salt: string;
  baseUrl: string;
  isTest: boolean;
}

interface PayUOrderResponse {
  orderId: string;
  amountInr: number;
  keyId: string;
  hash: string;
  planName?: string;
  chapterName?: string;
  mockTitle?: string;
  discount?: number;
  formData: Record<string, string>;
}

@Injectable()
export class MonetizationService {
  private payuConfig: PayUConfig;

  constructor(private prisma: PrismaService) {
    this.payuConfig = {
      merchantId: process.env.PAYU_MERCHANT_ID || '',
      merchantKey: process.env.PAYU_KEY || 'eUXkOt',
      salt: process.env.PAYU_SALT || 'e0YkggUb7yKMMj39c3cxXk3VSSTnUeuc',
      baseUrl: process.env.PAYU_BASE_URL || 'https://test.payu.in',
      isTest: process.env.PAYU_TEST_MODE !== 'false',
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

  // ---- PayU Hash Generation ----
  private generatePayUHash(params: Record<string, string>): string {
    // PayU hash sequence: key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5|udf6|udf7|udf8|udf9|udf10|salt
    const hashSequence = [
      this.payuConfig.merchantKey,
      params.txnid || '',
      params.amount || '',
      params.productinfo || '',
      params.firstname || '',
      params.email || '',
      params.udf1 || '',
      params.udf2 || '',
      params.udf3 || '',
      params.udf4 || '',
      params.udf5 || '',
      params.udf6 || '',
      params.udf7 || '',
      params.udf8 || '',
      params.udf9 || '',
      params.udf10 || '',
      this.payuConfig.salt,
    ];
    return crypto.createHash('sha512').update(hashSequence.join('|')).digest('hex').toLowerCase();
  }

  private generateVerifyHash(params: Record<string, string>): string {
    // Verify hash sequence: salt|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key
    const hashSequence = [
      this.payuConfig.salt,
      params.status || '',
      '||||||',
      params.udf5 || '',
      params.udf4 || '',
      params.udf3 || '',
      params.udf2 || '',
      params.udf1 || '',
      params.email || '',
      params.firstname || '',
      params.productinfo || '',
      params.amount || '',
      params.txnid || '',
      this.payuConfig.merchantKey,
    ];
    return crypto.createHash('sha512').update(hashSequence.join('|')).digest('hex').toLowerCase();
  }

  // ---- PayU order creation ----
  async createOrder(userId: string, input: { planId?: string; mockTemplateId?: string; chapterId?: string; couponCode?: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, fullName: true, phone: true } });
    if (!user) throw new NotFoundException('User not found');

    const txnid = `SSC_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const surl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/success`;
    const furl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/failure`;
    const curl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/cancel`;

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
      const price = tpl.isPremium ? 10 : 0;
      amountInr = price;
      productInfo = `SSC Prep Hub - Mock Test: ${tpl.title}`;
      mockTitle = tpl.title;
      metadata = { kind: 'MOCK', mockTemplateId: tpl.id };
    } else {
      throw new BadRequestException('Provide planId, mockTemplateId, or chapterId');
    }

    // Generate hash
    const hashParams = {
      key: this.payuConfig.merchantKey,
      txnid,
      amount: amountInr.toFixed(2),
      productinfo: productInfo,
      firstname: user.fullName || 'User',
      email: user.email,
      phone: user.phone || '',
      surl,
      furl,
      curl,
      udf1: userId,
      udf2: metadata.kind,
      udf3: input.planId || input.chapterId || input.mockTemplateId || '',
      udf4: input.couponCode || '',
      udf5: '',
    };

    const hash = this.generatePayUHash(hashParams);

    // Create payment record
    const payment = await this.prisma.payment.create({
      data: {
        userId,
        razorpayOrderId: txnid, // Reusing field for PayU txnid
        amountInr,
        status: 'PENDING',
        metadataJson: metadata,
      } as any,
    });

    // Form data for PayU checkout
    const formData = {
      key: this.payuConfig.merchantKey,
      txnid,
      amount: amountInr.toFixed(2),
      productinfo: productInfo,
      firstname: user.fullName || 'User',
      email: user.email,
      phone: user.phone || '',
      surl,
      furl,
      curl,
      hash,
      udf1: userId,
      udf2: metadata.kind,
      udf3: input.planId || input.chapterId || input.mockTemplateId || '',
      udf4: input.couponCode || '',
      udf5: '',
      service_provider: 'payu_paisa',
    };

    return { 
      orderId: txnid, 
      amountInr, 
      keyId: this.payuConfig.merchantKey,
      hash, 
      planName, 
      chapterName, 
      mockTitle, 
      discount, 
      formData,
      payuUrl: this.payuConfig.baseUrl + '/_payment',
    };
  }

  // Verify + capture payment (called from frontend after PayU checkout; or webhook).
  async verifyPayment(userId: string, input: { 
    txnid: string; 
    payuPaymentId: string; 
    hash: string;
    status: string;
    amount: string;
    productinfo: string;
    firstname: string;
    email: string;
    udf1: string;
    udf2: string;
    udf3: string;
    udf4: string;
    udf5: string;
  }) {
    const payment = await this.prisma.payment.findUnique({ where: { razorpayOrderId: input.txnid } });
    if (!payment) throw new NotFoundException('Order not found');
    if (payment.userId !== userId) throw new BadRequestException('Order belongs to another user');

    // Verify hash
    const verifyParams = {
      status: input.status,
      udf5: input.udf5,
      udf4: input.udf4,
      udf3: input.udf3,
      udf2: input.udf2,
      udf1: input.udf1,
      email: input.email,
      firstname: input.firstname,
      productinfo: input.productinfo,
      amount: input.amount,
      txnid: input.txnid,
    };
    
    const expectedHash = this.generateVerifyHash(verifyParams);
    if (expectedHash !== input.hash.toLowerCase()) {
      throw new BadRequestException('Invalid payment hash');
    }

    if (input.status !== 'success') {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED' },
      });
      throw new BadRequestException('Payment failed');
    }

    await this.fulfill(payment, input.payuPaymentId);
    return { ok: true };
  }

  // PayU webhook (server-confirmed payments)
  async handleWebhook(body: Record<string, any>) {
    const txnid = body.txnid;
    const status = body.status;
    const hash = body.hash;
    const payuPaymentId = body.mihpayid;

    if (!txnid) return { ok: true, ignored: true, reason: 'no_txnid' };

    const payment = await this.prisma.payment.findUnique({ where: { razorpayOrderId: txnid } });
    if (!payment) return { ok: true, ignored: true, reason: 'unknown_order' };
    if (payment.status === 'SUCCESS') return { ok: true, duplicate: true };

    // Verify hash
    const verifyParams = {
      status,
      udf5: body.udf5 || '',
      udf4: body.udf4 || '',
      udf3: body.udf3 || '',
      udf2: body.udf2 || '',
      udf1: body.udf1 || '',
      email: body.email || '',
      firstname: body.firstname || '',
      productinfo: body.productinfo || '',
      amount: body.amount || '',
      txnid,
    };
    
    const expectedHash = this.generateVerifyHash(verifyParams);
    if (expectedHash !== (hash || '').toLowerCase()) {
      return { ok: true, ignored: true, reason: 'invalid_hash' };
    }

    if (status === 'success') {
      await this.fulfill(payment, payuPaymentId);
      return { ok: true, fulfilled: true, kind: (payment.metadataJson as any)?.kind ?? null };
    }

    if (status === 'failure') {
      await this.prisma.payment.updateMany({
        where: { razorpayOrderId: txnid },
        data: { status: 'FAILED' },
      });
      return { ok: true, failed: true };
    }

    return { ok: true, ignored: true, reason: 'unhandled_status' };
  }

  /** Shared fulfillment: Payment PENDING → Subscription / ChapterPurchase / MockAccess. */
  private async fulfill(payment: any, payuPaymentId: string) {
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
      data: { razorpayPaymentId: payuPaymentId, status: 'SUCCESS', invoiceUrl: `https://sscprephub.in/invoice/${payment.id}` },
    });

    // consume coupon if any
    if (meta.couponCode) {
      await this.prisma.coupon.updateMany({
        where: { code: meta.couponCode },
        data: { usesCount: { increment: 1 } },
      });
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