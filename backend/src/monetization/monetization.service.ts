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
    const c = await this.prisma.coupon.findUnique({
      where: { code: code.trim().toUpperCase() },
    });
    if (!c) throw new NotFoundException('Invalid coupon code');
    if (!c.isActive) throw new BadRequestException('Coupon is inactive');
    if (c.expiresAt && c.expiresAt < new Date()) throw new BadRequestException('Coupon expired');
    if (c.maxUses && c.maxUses > 0 && c.usesCount >= c.maxUses) throw new BadRequestException('Coupon usage limit reached');
    let discount = 0;
    if (c.discountPct) {
      discount = Math.round((amountInr * c.discountPct) / 100 * 100) / 100;
    } else if (c.discountInr) {
      discount = Math.min(c.discountInr, amountInr);
    }
    const final = Math.max(0, amountInr - discount);
    return { code: c.code, discount, finalAmount: final };
  }

  // Admin methods for coupon management
  async createCoupon(data: {
    code: string;
    description?: string;
    discountPct?: number;
    discountInr?: number;
    maxUses?: number;
    expiresAt?: Date;
    isActive?: boolean;
  }) {
    // Check if coupon code already exists
    const existing = await this.prisma.coupon.findUnique({
      where: { code: data.code.trim().toUpperCase() },
    });
    if (existing) {
      throw new BadRequestException('Coupon code already exists');
    }
    return this.prisma.coupon.create({
      data: {
        code: data.code.trim().toUpperCase(),
        description: data.description,
        discountPct: data.discountPct,
        discountInr: data.discountInr,
        maxUses: data.maxUses,
        expiresAt: data.expiresAt,
        isActive: data.isActive ?? true,
      },
    });
  }

  async updateCoupon(id: string, data: {
    code?: string;
    description?: string;
    discountPct?: number;
    discountInr?: number;
    maxUses?: number;
    expiresAt?: Date;
    isActive?: boolean;
  }) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException('Coupon not found');
    return this.prisma.coupon.update({
      where: { id },
      data: {
        code: data.code ? data.code.trim().toUpperCase() : undefined,
        description: data.description,
        discountPct: data.discountPct,
        discountInr: data.discountInr,
        maxUses: data.maxUses,
        expiresAt: data.expiresAt,
        isActive: data.isActive,
        updatedAt: new Date(),
      },
    });
  }

  async deleteCoupon(id: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException('Coupon not found');
    return this.prisma.coupon.delete({ where: { id } });
  }

  async listCoupons(options: { activeOnly?: boolean } = {}) {
    return this.prisma.coupon.findMany({
      where: options.activeOnly ? { isActive: true } : {},
      orderBy: { createdAt: 'desc' },
    });
  }


  // ---- Chapter Purchases ----
  async myChapterPurchases(userId: string) {
    return this.prisma.chapterPurchase.findMany({
      where: { userId, status: 'SUCCESS' },
      include: { chapter: true, exam: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createOrder(userId: string, body: { planId?: string; mockTemplateId?: string; chapterId?: string; couponCode?: string }) {
    const { planId, mockTemplateId, chapterId, couponCode } = body;
    let amountInr = 0;
    let coupon: any = null;
    
    if (couponCode) {
      const validated = await this.validateCoupon(couponCode, 0); // amount will be recalculated
      coupon = await this.prisma.coupon.findUnique({ where: { code: couponCode.trim().toUpperCase() } });
    }

    if (planId) {
      const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
      if (!plan) throw new NotFoundException('Plan not found');
      amountInr = plan.priceInr;
    } else if (mockTemplateId) {
      // Mock access pack pricing
      amountInr = 499; // default mock pack price
    } else if (chapterId) {
      const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
      if (!chapter) throw new NotFoundException('Chapter not found');
      amountInr = 1; // ₹1 per chapter
    }

    if (coupon && coupon.discountPct) {
      amountInr = Math.round(amountInr * (1 - coupon.discountPct / 100));
    } else if (coupon && coupon.discountInr) {
      amountInr = Math.max(0, amountInr - coupon.discountInr);
    }

    // Create Razorpay order
    const crypto = await import('crypto');
    // Simplified - in production use actual Razorpay client
    const orderId = 'order_' + crypto.randomBytes(8).toString('hex');
    
    // Create payment record
    const payment = await this.prisma.payment.create({
      data: {
        userId,
        amountInr,
        status: 'PENDING',
        provider: 'razorpay',
        razorpayOrderId: orderId,
        providerOrderId: orderId,
        metadata: { planId, mockTemplateId, chapterId, couponCode },
      } as any,
    });

    return { orderId, amountInr, paymentId: payment.id };
  }

  async verifyPayment(userId: string, body: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) {
    // Verify signature (simplified)
    const payment = await this.prisma.payment.findFirst({
      where: { razorpayOrderId: body.razorpayOrderId },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    
    // In production, verify HMAC signature with Razorpay secret
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCESS',
        providerPaymentId: body.razorpayPaymentId,
        providerSignature: body.razorpaySignature,
      } as any,
    });

    // Activate subscription/chapter purchase based on metadata
    const meta = (payment as any).metadata || {};
    if (meta.planId) {
      const plan = await this.prisma.plan.findUnique({ where: { id: meta.planId } });
      if (plan) {
        const endsAt = new Date();
        endsAt.setDate(endsAt.getDate() + plan.durationMonths * 30);
        await this.prisma.subscription.upsert({
          where: { userId_planId: { userId, planId: meta.planId } },
          create: { userId, planId: meta.planId, endsAt, status: 'ACTIVE' },
          update: { status: 'ACTIVE', endsAt },
        } as any);
      }
    } else if (meta.chapterId) {
      await this.prisma.chapterPurchase.upsert({
        where: { userId_chapterId: { userId, chapterId: meta.chapterId } },
        create: { userId, chapterId: meta.chapterId, examId: '', amountInr: payment.amountInr, status: 'SUCCESS', paymentId: payment.id, completedAt: new Date() },
        update: { status: 'SUCCESS', paymentId: payment.id, completedAt: new Date() },
      });
    } else if (meta.mockTemplateId) {
      // Grant mock access
      await this.prisma.mockAccess.upsert({
        where: { userId_testTemplateId: { userId, testTemplateId: meta.mockTemplateId } },
        create: { userId, testTemplateId: meta.mockTemplateId, paidPacksPurchased: 1 },
        update: { paidPacksPurchased: { increment: 1 } },
      });
    }

    const couponCode = meta.couponCode;
    const couponCodeVar = meta.couponCode;
    if (couponCodeVar) {
      await this.prisma.coupon.update({
        where: { code: couponCodeVar.trim().toUpperCase() },
        data: { usesCount: { increment: 1 } },
      });
    }

    return { success: true };
  }

  async handleWebhook(rawBody: string, signature: string) {
    // Verify webhook signature (simplified)
    // In production: validate HMAC with Razorpay webhook secret
    console.log('Webhook received:', rawBody);
    return { received: true };
  }
}