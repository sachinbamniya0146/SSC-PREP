import { Controller, Get, Query, UseGuards, Post, Put, Delete, Body, Param, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { MonetizationService } from '../monetization/monetization.service';

// v1 §10 — Admin dashboards: revenue overview + audit log viewer + user management.
// All endpoints are ADMIN-only (global JwtAuthGuard is on the module).
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(
    private prisma: PrismaService,
    private auditLogService: AuditLogService,
    private monetization: MonetizationService,
  ) {}

  // ---- Revenue overview ----
  @Get('revenue')
  async revenue(@Query('days') days?: string) {
    const since = new Date();
    since.setDate(since.getDate() - (days ? Math.min(Number(days) || 30, 365) : 30));

    const [successPayments, pendingPayments, byKind, recent] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { status: 'SUCCESS', createdAt: { gte: since } },
        _sum: { amountInr: true },
        _count: true,
      }),
      this.prisma.payment.count({ where: { status: 'PENDING' } }),
      this.prisma.payment.groupBy({
        by: ['status'],
        where: { createdAt: { gte: since } },
        _sum: { amountInr: true },
        _count: true,
      }),
      this.prisma.payment.findMany({
        where: { status: 'SUCCESS', createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { user: { select: { email: true, fullName: true } } },
      }),
    ]);

    const [subsActive, chapterSales, mockSales] = await Promise.all([
      this.prisma.subscription.count({ where: { status: 'ACTIVE', endsAt: { gt: new Date() } } }),
      this.prisma.chapterPurchase.count({ where: { status: 'SUCCESS' } }),
      this.prisma.mockAccess.count({ where: { paidPacksPurchased: { gt: 0 } } }),
    ]);

    return {
      since,
      revenueInr: Math.round((successPayments._sum?.amountInr ?? 0) * 100) / 100,
      paymentCount: successPayments._count,
      pendingPayments,
      byStatus: byKind,
      activeSubscriptions: subsActive,
      chapterSales,
      mockSales,
      recent,
    };
  }

  // ---- Audit log viewer ----
  @Get('audit-log')
  @Roles(Role.ADMIN, Role.MODERATOR)
  async auditLog(
    @Query('action') action?: string,
    @Query('entity') entity?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const logs = await this.auditLogService.findMany({
      action: action || undefined,
      targetEntity: entity || undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
    return logs;
  }

  // ---- User management ----
  @Get('users')
  async listUsers(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('search') search?: string,
    @Query('role') role?: string,
  ) {
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { fullName: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (role) where.role = role;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          phone: true,
          isEmailVerified: true,
          createdAt: true,
          subscriptions: {
            where: { status: { not: 'CANCELLED' } },
            select: { status: true, endsAt: true, planId: true },
            orderBy: { startsAt: 'desc' },
          },
          _count: { select: { testAttempts: true, bookmarks: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { users, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) };
  }

  @Post('users/:id/subscription/cancel')
  async cancelUserSubscription(@Param('id', ParseUUIDPipe) userId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId, status: 'ACTIVE' },
    });
    if (!subscription) throw new Error('No active subscription found');
    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: 'CANCELLED' },
    });
    await this.auditLogService.log({
      action: 'SUBSCRIPTION_CANCELLED_BY_ADMIN',
      targetEntity: 'Subscription',
      entityId: subscription.id,
      metadataJson: { userId, planId: subscription.planId },
    });
    return { ok: true };
  }

  @Post('users/:id/subscription/add')
  async addUserSubscription(
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() body: { planId: string },
  ) {
    const plan = await this.prisma.plan.findUnique({ where: { id: body.planId } });
    if (!plan || !plan.isActive) throw new Error('Plan not found or inactive');

    // Cancel any existing active subscription
    await this.prisma.subscription.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    });

    const endsAt = new Date();
    endsAt.setMonth(endsAt.getMonth() + plan.durationMonths);

    const sub = await this.prisma.subscription.create({
      data: {
        userId,
        planId: plan.id,
        status: 'ACTIVE',
        startsAt: new Date(),
        endsAt,
      },
    });

    await this.auditLogService.log({
      action: 'SUBSCRIPTION_GRANTED_BY_ADMIN',
      targetEntity: 'Subscription',
      entityId: sub.id,
      metadataJson: { userId, planId: plan.id, durationMonths: plan.durationMonths },
    });
    return { ok: true, subscription: sub };
  }

  @Post('subscriptions/bulk')
  async bulkGrantSubscription(@Body() body: { emails: string[]; planId: string }) {
    const plan = await this.prisma.plan.findUnique({ where: { id: body.planId } });
    if (!plan || !plan.isActive) throw new Error('Plan not found or inactive');

    const results = [];
    for (const email of body.emails) {
      const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
      if (!user) {
        results.push({ email, success: false, reason: 'User not found' });
        continue;
      }

      await this.prisma.subscription.updateMany({
        where: { userId: user.id, status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      });

      const endsAt = new Date();
      endsAt.setMonth(endsAt.getMonth() + plan.durationMonths);

      await this.prisma.subscription.create({
        data: {
          userId: user.id,
          planId: plan.id,
          status: 'ACTIVE',
          startsAt: new Date(),
          endsAt,
        },
      });

      await this.auditLogService.log({
        action: 'SUBSCRIPTION_GRANTED_BY_ADMIN',
        targetEntity: 'Subscription',
        entityId: user.id,
        metadataJson: { userId: user.id, planId: plan.id, bulk: true },
      });

      results.push({ email, success: true });
    }
    return { results };
  }

  // ---- Coupon Management ----
  @Get('coupons')
  async listCoupons(@Query('activeOnly') activeOnly?: string) {
    const coupons = await this.monetization.listCoupons({
      activeOnly: activeOnly ? activeOnly === 'true' : undefined,
    });
    return { coupons };
  }

  @Post('coupons')
  async createCoupon(@Body() body: {
    code: string;
    description?: string;
    discountPct?: number;
    discountInr?: number;
    maxUses?: number;
    expiresAt?: string; // ISO date string
    isActive?: boolean;
  }) {
    const coupon = await this.monetization.createCoupon({
      code: body.code,
      description: body.description,
      discountPct: body.discountPct,
      discountInr: body.discountInr,
      maxUses: body.maxUses,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      isActive: body.isActive,
    });
    await this.auditLogService.log({
      action: 'COUPON_CREATED_BY_ADMIN',
      targetEntity: 'Coupon',
      entityId: coupon.id,
      metadataJson: { code: coupon.code },
    });
    return { coupon };
  }

  @Put('coupons/:id')
  async updateCoupon(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: {
      code?: string;
      description?: string;
      discountPct?: number;
      discountInr?: number;
      maxUses?: number;
      expiresAt?: string; // ISO date string
      isActive?: boolean;
    }
  ) {
    const coupon = await this.monetization.updateCoupon(id, {
      code: body.code,
      description: body.description,
      discountPct: body.discountPct,
      discountInr: body.discountInr,
      maxUses: body.maxUses,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      isActive: body.isActive,
    });
    await this.auditLogService.log({
      action: 'COUPON_UPDATED_BY_ADMIN',
      targetEntity: 'Coupon',
      entityId: id,
      metadataJson: { code: coupon.code },
    });
    return { coupon };
  }

  @Delete('coupons/:id')
  async deleteCoupon(@Param('id', ParseUUIDPipe) id: string) {
    // First get the coupon for audit log before deleting
    const couponExist = await this.prisma.coupon.findUnique({ where: { id } });
    if (!couponExist) throw new Error('Coupon not found');
    
    await this.monetization.deleteCoupon(id);
    await this.auditLogService.log({
      action: 'COUPON_DELETED_BY_ADMIN',
      targetEntity: 'Coupon',
      entityId: id,
      metadataJson: { code: couponExist.code },
    });
    return { ok: true };
  }

  @Get('plans')
  async listPlans() {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { priceInr: 'asc' },
    });
    return { plans };
  }

  // ---- Admin: Grant/Revoke Premium Access ----
  @Post('users/:id/grant-premium')
  async grantPremium(
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() body: { months?: number; days?: number },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');

    // Cancel any existing active subscription
    await this.prisma.subscription.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    });

    const endsAt = new Date();
    if (body.months) {
      endsAt.setMonth(endsAt.getMonth() + body.months);
    } else if (body.days) {
      endsAt.setDate(endsAt.getDate() + body.days);
    } else {
      endsAt.setFullYear(endsAt.getFullYear() + 1); // Default 1 year
    }

    // Create a special admin-granted subscription (using a special plan or custom)
    const adminPlan = await this.prisma.plan.findFirst({ 
      where: { code: 'ADMIN_GRANTED' } 
    });
    
    let planId = adminPlan?.id;
    if (!planId) {
      // Create admin plan if doesn't exist
      const newPlan = await this.prisma.plan.create({
        data: {
          code: 'ADMIN_GRANTED',
          name: 'Admin Granted Premium',
          description: 'Premium access granted by admin',
          priceInr: 0,
          durationMonths: 12,
          features: ['all_mocks', 'unlimited_bookmarks', 'advanced_analytics', 'priority_support', 'all_chapters'],
          isActive: true,
        },
      });
      planId = newPlan.id;
    }

    const sub = await this.prisma.subscription.create({
      data: {
        userId,
        planId,
        status: 'ACTIVE',
        startsAt: new Date(),
        endsAt,
      },
    });

    await this.auditLogService.log({
      action: 'PREMIUM_GRANTED_BY_ADMIN',
      targetEntity: 'Subscription',
      entityId: sub.id,
      metadataJson: { userId, planId, endsAt: endsAt.toISOString() },
    });
    return { ok: true, subscription: sub, endsAt };
  }

  @Post('users/:id/revoke-premium')
  async revokePremium(@Param('id', ParseUUIDPipe) userId: string) {
    await this.prisma.subscription.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    });
    await this.auditLogService.log({
      action: 'PREMIUM_REVOKED_BY_ADMIN',
      targetEntity: 'Subscription',
      entityId: userId,
      metadataJson: { userId },
    });
    return { ok: true };
  }

  @Post('bulk/grant-premium')
  async bulkGrantPremium(@Body() body: { emails: string[]; months?: number; days?: number }) {
    const endsAt = new Date();
    if (body.months) {
      endsAt.setMonth(endsAt.getMonth() + body.months);
    } else if (body.days) {
      endsAt.setDate(endsAt.getDate() + body.days);
    } else {
      endsAt.setFullYear(endsAt.getFullYear() + 1);
    }

    const adminPlan = await this.prisma.plan.findFirst({ 
      where: { code: 'ADMIN_GRANTED' } 
    });
    
    let planId = adminPlan?.id;
    if (!planId) {
      const newPlan = await this.prisma.plan.create({
        data: {
          code: 'ADMIN_GRANTED',
          name: 'Admin Granted Premium',
          description: 'Premium access granted by admin',
          priceInr: 0,
          durationMonths: 12,
          features: ['all_mocks', 'unlimited_bookmarks', 'advanced_analytics', 'priority_support', 'all_chapters'],
          isActive: true,
        },
      });
      planId = newPlan.id;
    }

    const results = [];
    for (const email of body.emails) {
      const user = await this.prisma.user.findUnique({ 
        where: { email: email.trim().toLowerCase() } 
      });
      if (!user) {
        results.push({ email, success: false, reason: 'User not found' });
        continue;
      }

      await this.prisma.subscription.updateMany({
        where: { userId: user.id, status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      });

      await this.prisma.subscription.create({
        data: {
          userId: user.id,
          planId,
          status: 'ACTIVE',
          startsAt: new Date(),
          endsAt,
        },
      });

      await this.auditLogService.log({
        action: 'PREMIUM_GRANTED_BY_ADMIN',
        targetEntity: 'Subscription',
        entityId: user.id,
        metadataJson: { userId: user.id, planId, bulk: true, endsAt: endsAt.toISOString() },
      });

      results.push({ email, success: true });
    }
    return { results };
  }
}
