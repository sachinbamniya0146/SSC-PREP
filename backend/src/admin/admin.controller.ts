import { grantOrExtendSubscription } from '../monetization/subscription.util';
import { Controller, Get, Query, UseGuards, Post, Body, Param, ParseUUIDPipe, Patch, Delete, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { MonetizationService } from '../monetization/monetization.service';
import { checkCouponInput, checkPlanInput, couponStatus, planPricing } from '../monetization/pricing.util';
import { AdminService } from './admin.service';
import { PayoutService } from '../referral/payout.service';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { readPatternSections } from '../common/section-plan';
import { cacheClearPrefix } from '../common/cache';
import { EXAM_PRESETS, planPresetSync, type ExistingPattern } from '../common/exam-presets';
import { MARKING_CACHE_PREFIX } from '../tests/marking-scheme';

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
    private adminService: AdminService,
    private payoutService: PayoutService,
  ) {}

  // ---- Dashboard Overview ----
  @Get('dashboard')
  async dashboard(@Query('days') days?: string) {
    const since = new Date();
    since.setDate(since.getDate() - (days ? Math.min(Number(days) || 30, 365) : 30));

    const [
      totalUsers,
      activeUsers,
      newUsers,
      totalRevenue,
      totalSubscriptions,
      totalTestAttempts,
      totalMockAttempts,
      totalPracticeSets,
      revenueData,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({
        where: { testAttempts: { some: { startedAt: { gte: since } } } },
      }),
      this.prisma.user.count({ where: { createdAt: { gte: since } } }),
      this.prisma.payment.aggregate({
        where: { status: 'SUCCESS', createdAt: { gte: since } },
        _sum: { amountInr: true },
      }),
      this.prisma.subscription.count({ where: { status: 'ACTIVE', endsAt: { gt: new Date() } } }),
      this.prisma.testAttempt.count({ where: { startedAt: { gte: since } } }),
      this.prisma.testAttempt.count({
        where: { startedAt: { gte: since }, testTemplate: { type: 'FULL_MOCK' } },
      }),
      this.prisma.questionBankSet.count({ where: { startedAt: { gte: since } } }),
      this.prisma.payment.groupBy({
        by: ['createdAt'],
        where: { status: 'SUCCESS', createdAt: { gte: since } },
        _sum: { amountInr: true },
        _count: true,
      }),
    ]);

    // Revenue by day for chart
    const revenueByDay = revenueData.reduce((acc: Record<string, { revenue: number; count: number }>, r: { createdAt: Date; _sum: { amountInr: number | null }; _count: number }) => {
      const day = r.createdAt.toISOString().split('T')[0];
      if (!acc[day]) acc[day] = { revenue: 0, count: 0 };
      acc[day].revenue += r._sum.amountInr || 0;
      acc[day].count += r._count;
      return acc;
    }, {});

    // Top users by activity
    const topUsers = await this.prisma.user.findMany({
      where: { testAttempts: { some: { startedAt: { gte: since } } } },
      select: {
        id: true,
        email: true,
        fullName: true,
        _count: { select: { testAttempts: true } },
      },
      orderBy: { testAttempts: { _count: 'desc' } },
      take: 10,
    });

    // Question bank practice stats
    const practiceStats = await this.prisma.questionBankSet.groupBy({
      by: ['mode', 'isCompleted'],
      where: { startedAt: { gte: since } },
      _count: true,
    });

    // Subject-wise practice distribution
    const subjectPractice = await this.prisma.questionBankSet.groupBy({
      by: ['subjectId'],
      where: { startedAt: { gte: since } },
      _count: true,
      orderBy: { _count: { subjectId: 'desc' } },
      take: 10,
    });

    const subjectIds = subjectPractice.map(s => s.subjectId).filter((id): id is string => id !== null);
    const subjects = subjectIds.length > 0
      ? await this.prisma.subject.findMany({
          where: { id: { in: subjectIds } },
          select: { id: true, name: true },
        })
      : [];
    const subjectMap = new Map(subjects.map(s => [s.id, s.name]));

    // Mock test stats
    const mockStats = await this.prisma.testAttempt.groupBy({
      by: ['testTemplateId', 'status'],
      where: { startedAt: { gte: since }, testTemplate: { isPremium: true } },
      _count: true,
    });

    return {
      period: { since, days: days || 30 },
      overview: {
        totalUsers,
        activeUsers,
        newUsers,
        revenueInr: Math.round((totalRevenue._sum?.amountInr ?? 0) * 100) / 100,
        activeSubscriptions: totalSubscriptions,
        totalTestAttempts,
        totalMockAttempts,
        totalPracticeSets,
      },
      revenueByDay: Object.entries(revenueByDay).map(([day, data]) => ({ day, ...data })),
      topUsers,
      questionBankPractice: {
        byMode: practiceStats,
        bySubject: subjectPractice.map(s => ({
          subjectId: s.subjectId,
          subjectName: s.subjectId ? subjectMap.get(s.subjectId) : 'Unknown',
          count: s._count,
        })),
      },
      mockTests: mockStats,
    };
  }

  // ---- Enhanced Dashboard with Analytics ----
  @Get('dashboard-enhanced')
  async enhancedDashboard(@Query('days') days?: string) {
    return this.adminService.getDashboardStats(days ? Number(days) : 30);
  }

  // ---- User Activity Analytics ----
  @Get('analytics/user-activity')
  async userActivityAnalytics(@Query('days') days?: string) {
    return this.adminService.getUserActivityAnalytics(days ? Number(days) : 30);
  }

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
  @Roles(Role.ADMIN) // audit trail contains every admin action — not for department staff
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

    const where: Prisma.UserWhereInput = {};
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { fullName: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (role) where.role = role as Role;

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
          avatarUrl: true,
          preferredLanguage: true,
          isEmailVerified: true,
          createdAt: true,
          // Only the live subscription (ACTIVE and not yet expired). Superseded /
          // lapsed rows used to be listed too, so a user could show several
          // "plans" and a raw plan UUID instead of a name.
          subscriptions: {
            where: { status: 'ACTIVE', endsAt: { gt: new Date() } },
            select: { status: true, endsAt: true, planId: true, startsAt: true, plan: { select: { name: true } } },
            orderBy: { endsAt: 'desc' },
            take: 1,
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
    const active = await this.prisma.subscription.findMany({ where: { userId, status: 'ACTIVE' } });
    if (active.length === 0) throw new NotFoundException('No active subscription found');
    await this.prisma.subscription.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    });
    await this.auditLogService.log({
      action: 'SUBSCRIPTION_CANCELLED_BY_ADMIN',
      targetEntity: 'Subscription',
      entityId: active[0].id,
      metadataJson: { userId, planId: active[0].planId, rows: active.length },
    });
    return { ok: true };
  }

  /**
   * Resolves the duration an admin grant should add: an explicit custom
   * `months` / `days` (e.g. a 10-day gift) wins, otherwise the plan's own length.
   */
  private grantDuration(plan: { durationMonths: number }, body: { months?: number; days?: number }) {
    const months = body.months === undefined || body.months === null ? undefined : Number(body.months);
    const days = body.days === undefined || body.days === null ? undefined : Number(body.days);
    if (days !== undefined) {
      if (!Number.isInteger(days) || days < 1 || days > 3650) throw new BadRequestException('days must be a whole number between 1 and 3650');
      return { days };
    }
    if (months !== undefined) {
      if (!Number.isInteger(months) || months < 1 || months > 120) throw new BadRequestException('months must be a whole number between 1 and 120');
      return { months };
    }
    return { months: plan.durationMonths };
  }

  @Post('users/:id/subscription/add')
  async addUserSubscription(
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() body: { planId: string; months?: number; days?: number },
  ) {
    const plan = await this.prisma.plan.findUnique({ where: { id: body?.planId } });
    if (!plan || !plan.isActive) throw new BadRequestException('Plan not found or inactive');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('User not found');
    const duration = this.grantDuration(plan, body);

    // Extends instead of replacing: remaining paid days are never destroyed.
    const grant = await grantOrExtendSubscription(this.prisma as any, { userId, planId: plan.id, ...duration });
    const sub = grant.subscription;

    await this.auditLogService.log({
      action: 'SUBSCRIPTION_GRANTED_BY_ADMIN',
      targetEntity: 'Subscription',
      entityId: sub.id,
      metadataJson: { userId, planId: plan.id, ...duration, extended: grant.extended, endsAt: sub.endsAt },
    });
    return { ok: true, subscription: sub, extended: grant.extended, endsAt: sub.endsAt };
  }

  @Post('subscriptions/bulk')
  async bulkGrantSubscription(@Body() body: { emails: string[] | string; planId: string; months?: number; days?: number }) {
    const plan = await this.prisma.plan.findUnique({ where: { id: body?.planId } });
    if (!plan || !plan.isActive) throw new BadRequestException('Plan not found or inactive');
    const duration = this.grantDuration(plan, body);

    // Accept an array or a comma / space / newline separated string; dedupe.
    const raw = Array.isArray(body?.emails) ? body.emails : String(body?.emails ?? '').split(/[\s,;]+/);
    const emails = [...new Set(raw.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
    if (emails.length === 0) throw new BadRequestException('Provide at least one email');
    if (emails.length > 500) throw new BadRequestException('Maximum 500 emails per request');

    const results: { email: string; success: boolean; reason?: string; endsAt?: Date }[] = [];
    for (const email of emails) {
      try {
        const user = await this.prisma.user.findUnique({ where: { email } });
        if (!user) {
          results.push({ email, success: false, reason: 'User not found' });
          continue;
        }
        const g = await grantOrExtendSubscription(this.prisma as any, { userId: user.id, planId: plan.id, ...duration });
        await this.auditLogService.log({
          action: 'SUBSCRIPTION_GRANTED_BY_ADMIN',
          targetEntity: 'Subscription',
          entityId: g.subscription.id,
          metadataJson: { userId: user.id, planId: plan.id, ...duration, bulk: true, extended: g.extended },
        });
        results.push({ email, success: true, endsAt: g.subscription.endsAt });
      } catch (e) {
        results.push({ email, success: false, reason: (e as Error)?.message || 'Failed' });
      }
    }
    const granted = results.filter((r) => r.success).length;
    return { total: results.length, granted, failed: results.length - granted, results };
  }

  @Get('plans')
  async listPlans() {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { priceInr: 'asc' },
    });
    return { plans };
  }

  // ---- Plan Management (Admin) ----
  // Every write goes through checkPlanInput() (whitelist + range checks) — the old code passed the raw
  // request body straight to Prisma.

  /** Admin pricing screen: ALL plans (also switched-off ones) with the live pricing block + subscriber counts. */
  @Get('pricing/plans')
  async pricingPlans() {
    const rows = await this.prisma.plan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { durationMonths: 'asc' }, { priceInr: 'asc' }],
      include: { _count: { select: { subscriptions: true } } },
    });
    const now = new Date();
    return {
      plans: rows.map(({ _count, ...p }) => ({ ...p, subscribers: _count.subscriptions, pricing: planPricing(p, now) })),
    };
  }

  @Post('plans')
  async createPlan(@Body() body: Record<string, unknown>) {
    const r = checkPlanInput(body ?? {}, false);
    if (!r.ok) throw new BadRequestException(r.error);
    const d = r.data;
    const plan = await this.prisma.plan.create({
      data: { ...d, name: d.name as string, durationMonths: d.durationMonths as number, priceInr: d.priceInr as number, isActive: d.isActive ?? true },
    });
    await this.auditLogService.log({
      action: 'PLAN_CREATED',
      targetEntity: 'Plan',
      entityId: plan.id,
      metadataJson: JSON.parse(JSON.stringify(r.data)),
    });
    return { plan: { ...plan, pricing: planPricing(plan) } };
  }

  @Patch('plans/:id')
  async updatePlan(@Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const current = await this.prisma.plan.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Plan not found');
    const r = checkPlanInput(body ?? {}, true, {
      priceInr: current.priceInr,
      mrpInr: current.mrpInr,
      offerPct: current.offerPct,
      offerStartsAt: current.offerStartsAt,
      offerEndsAt: current.offerEndsAt,
    });
    if (!r.ok) throw new BadRequestException(r.error);
    const plan = await this.prisma.plan.update({ where: { id }, data: r.data });
    await this.auditLogService.log({
      action: 'PLAN_UPDATED',
      targetEntity: 'Plan',
      entityId: id,
      metadataJson: JSON.parse(JSON.stringify(r.data)),
    });
    return { plan: { ...plan, pricing: planPricing(plan) } };
  }

  @Delete('plans/:id')
  async deletePlan(@Param('id', ParseUUIDPipe) id: string) {
    const subs = await this.prisma.subscription.count({ where: { planId: id } });
    if (subs > 0) {
      // Subscriptions keep a hard reference to their plan (and the students' history needs it) — switch it off instead.
      throw new BadRequestException(`This plan has ${subs} subscription(s) — it cannot be deleted. Switch it off instead (it disappears from the pricing page, existing students keep their access).`);
    }
    await this.prisma.plan.delete({ where: { id } });
    await this.auditLogService.log({
      action: 'PLAN_DELETED',
      targetEntity: 'Plan',
      entityId: id,
    });
    return { ok: true };
  }

  // ---- Coupon Management (Admin) ----
  @Get('coupons')
  async listCoupons() {
    const coupons = await this.prisma.coupon.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    // One grouped query for "how many paid orders / how much revenue / how much discount" per code.
    const stats = await this.prisma.$queryRaw<Array<{ code: string; orders: number; revenue: number; discount: number }>>`
      SELECT "metadataJson"->>'couponCode' AS code,
             COUNT(*)::int AS orders,
             COALESCE(SUM("amountInr"), 0)::float AS revenue,
             COALESCE(SUM(NULLIF("metadataJson"->>'discount', '')::float), 0)::float AS discount
      FROM "payments"
      WHERE "status" = 'SUCCESS' AND "metadataJson"->>'couponCode' IS NOT NULL
      GROUP BY 1`;
    const byCode = new Map(stats.map((x) => [x.code, x]));
    const now = new Date();
    return {
      coupons: coupons.map((c) => {
        const st = byCode.get(c.code);
        return {
          ...c,
          status: couponStatus(c, now),
          paidOrders: st?.orders ?? 0,
          revenueInr: st?.revenue ?? 0,
          discountGivenInr: st?.discount ?? 0,
        };
      }),
    };
  }

  @Post('coupons')
  async createCoupon(@Body() body: Record<string, unknown>) {
    const r = checkCouponInput(body ?? {}, false);
    if (!r.ok) throw new BadRequestException(r.error);
    const d = r.data;
    let coupon;
    try {
      coupon = await this.prisma.coupon.create({
        data: { ...d, code: d.code as string, isActive: d.isActive ?? true },
      });
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') throw new ConflictException(`Coupon code ${d.code} already exists.`);
      throw e;
    }
    await this.auditLogService.log({
      action: 'COUPON_CREATED',
      targetEntity: 'Coupon',
      entityId: coupon.id,
      metadataJson: JSON.parse(JSON.stringify(r.data)),
    });
    return { coupon };
  }

  @Patch('coupons/:id')
  async updateCoupon(@Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const current = await this.prisma.coupon.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Coupon not found');
    // the code itself and usesCount can never be changed from here
    const { code: _code, usesCount: _uses, ...rest } = (body ?? {}) as Record<string, unknown>;
    const r = checkCouponInput(rest, true, {
      discountPct: current.discountPct,
      discountInr: current.discountInr,
      startsAt: current.startsAt,
      expiresAt: current.expiresAt,
    });
    if (!r.ok) throw new BadRequestException(r.error);
    const coupon = await this.prisma.coupon.update({ where: { id }, data: r.data });
    await this.auditLogService.log({
      action: 'COUPON_UPDATED',
      targetEntity: 'Coupon',
      entityId: id,
      metadataJson: JSON.parse(JSON.stringify(r.data)),
    });
    return { coupon };
  }

  @Delete('coupons/:id')
  async deleteCoupon(@Param('id', ParseUUIDPipe) id: string) {
    const current = await this.prisma.coupon.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Coupon not found');
    if (current.usesCount > 0) {
      throw new BadRequestException('This coupon has already been used — keep it for the records and switch it off instead.');
    }
    await this.prisma.coupon.delete({ where: { id } });
    await this.auditLogService.log({
      action: 'COUPON_DELETED',
      targetEntity: 'Coupon',
      entityId: id,
    });
    return { ok: true };
  }

  // ---- Invoice Generation ----
  @Get('invoices/:paymentId')
  async getInvoice(@Param('paymentId', ParseUUIDPipe) paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { user: { select: { email: true, fullName: true, phone: true } }, subscription: { include: { plan: true } } },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    const meta = (payment.metadataJson ?? {}) as Record<string, unknown>;
    return {
      invoiceNumber: `INV-${payment.id.slice(0, 8).toUpperCase()}`,
      date: payment.createdAt,
      amountInr: payment.amountInr,
      status: payment.status,
      user: {
        email: payment.user.email,
        name: payment.user.fullName,
        phone: payment.user.phone,
      },
      plan: payment.subscription?.plan ? {
        name: payment.subscription.plan.name,
        durationMonths: payment.subscription.plan.durationMonths,
        priceInr: payment.subscription.plan.priceInr,
      } : null,
      couponCode: meta.couponCode,
      discount: meta.discount,
      // BUGFIX (Sep 2026 — stale from the PayU→Cashfree migration): this
      // was hardcoded to 'PayU' with a comment insisting it wasn't
      // Razorpay — both wrong today. Gateway has been Cashfree since the
      // migration documented in monetization.service.ts; field names
      // renamed to match (gatewayOrderId/gatewayPaymentId — see migration
      // 20260914100000_rename_payment_gateway_fields).
      paymentMethod: 'Cashfree',
      gatewayOrderId: payment.gatewayOrderId,
      gatewayPaymentId: payment.gatewayPaymentId,
    };
  }

  // ---- Referral Analytics ----
  @Get('referrals/analytics')
  async referralAnalytics(@Query('days') days?: string) {
    const since = new Date();
    since.setDate(since.getDate() - (days ? Math.min(Number(days) || 30, 365) : 30));

    const [
      totalReferrals,
      paidReferrals,
      rewardedReferrals,
      topReferrers,
    ] = await Promise.all([
      this.prisma.referral.count({ where: { createdAt: { gte: since } } }),
      this.prisma.referral.count({
        where: { createdAt: { gte: since }, status: { in: ['PAIDED', 'REWARDED'] } },
      }),
      this.prisma.referral.count({
        where: { createdAt: { gte: since }, status: 'REWARDED' },
      }),
      this.prisma.user.findMany({
        where: { referralCode: { not: null } },
        select: {
          id: true,
          email: true,
          fullName: true,
          referralCode: true,
          _count: { select: { referralsMade: true } },
        },
        orderBy: { referralsMade: { _count: 'desc' } },
        take: 20,
      }),
    ]);

    return {
      totalReferrals,
      paidReferrals,
      rewardedReferrals,
      conversionRate: totalReferrals > 0 ? Math.round((paidReferrals / totalReferrals) * 1000) / 10 : 0,
      topReferrers,
    };
  }

  // ---- Export Users ----
  @Get('users/export')
  async exportUsers(
    @Query('role') role?: string,
    @Query('hasSubscription') hasSubscription?: string,
  ) {
    const where: Prisma.UserWhereInput = {};
    if (role) where.role = role as Role;
    if (hasSubscription === 'true') {
      where.subscriptions = { some: { status: 'ACTIVE', endsAt: { gt: new Date() } } };
    } else if (hasSubscription === 'false') {
      where.subscriptions = { none: { status: 'ACTIVE', endsAt: { gt: new Date() } } };
    }

    const users = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        isEmailVerified: true,
        createdAt: true,
        referralCode: true,
        referredByCode: true,
        freeSubFromReferral: true,
        currentStreak: true,
        xp: true,
        coins: true,
        _count: { select: { testAttempts: true, bookmarks: true, questionBankSets: true } },
        subscriptions: {
          where: { status: { not: 'CANCELLED' } },
          select: { status: true, endsAt: true, planId: true },
          orderBy: { startsAt: 'desc' },
          take: 1,
        },
      },
    });

    return { users, count: users.length };
  }

  // ---- Bulk Operations ----
  @Post('users/bulk-subscription')
  async bulkSubscription(@Body() body: { userIds: string[]; planId: string; action: 'grant' | 'cancel' | 'extend' }) {
    const plan = await this.prisma.plan.findUnique({ where: { id: body.planId } });
    if (!plan || !plan.isActive) throw new BadRequestException('Plan not found or inactive');

    const results = [];
    for (const userId of body.userIds) {
      try {
        if (body.action === 'grant') {
          await this.prisma.subscription.updateMany({
            where: { userId, status: 'ACTIVE' },
            data: { status: 'CANCELLED' },
          });
          const endsAt = new Date();
          endsAt.setMonth(endsAt.getMonth() + plan.durationMonths);
          await this.prisma.subscription.create({
            data: { userId, planId: plan.id, status: 'ACTIVE', startsAt: new Date(), endsAt },
          });
          results.push({ userId, success: true, action: 'granted' });
        } else if (body.action === 'cancel') {
          await this.prisma.subscription.updateMany({
            where: { userId, status: 'ACTIVE' },
            data: { status: 'CANCELLED' },
          });
          results.push({ userId, success: true, action: 'cancelled' });
        } else if (body.action === 'extend') {
          const sub = await this.prisma.subscription.findFirst({
            where: { userId, status: 'ACTIVE' },
            orderBy: { endsAt: 'desc' },
          });
          if (sub) {
            const newEndsAt = new Date(sub.endsAt);
            newEndsAt.setMonth(newEndsAt.getMonth() + plan.durationMonths);
            await this.prisma.subscription.update({
              where: { id: sub.id },
              data: { endsAt: newEndsAt },
            });
            results.push({ userId, success: true, action: 'extended', newEndsAt });
          } else {
            results.push({ userId, success: false, reason: 'No active subscription to extend' });
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.push({ userId, success: false, reason: message });
      }
    }
    return { results };
  }

  // ---- System Health ----
    @Get('system/health')
    async systemHealth() {
      await this.prisma.$queryRaw`SELECT 1 as ok`;
      const userCount = await this.prisma.user.count();
      const activeSessions = await this.prisma.deviceSession.count({ where: { isActive: true } });
      const pendingPayments = await this.prisma.payment.count({ 
        where: { 
          status: 'PENDING', 
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } 
        } 
      });

      return {
        database: 'healthy',
        totalUsers: userCount,
        activeSessions,
        pendingPayments24h: pendingPayments,
        timestamp: new Date(),
      };
    }

  // ---- Exams ----
  // BUGFIX (root cause of "Choose Your Exam" showing empty AND students
  // unable to start any sectional/mock test): the Exam model (id/name/slug/
  // code/isActive) is the anchor every other piece of content hangs off of
  // — bank.service.ts's meta() only shows exams that exist as rows here,
  // tests.service.ts's sectionalExamForFamily() throws "Exam not set up
  // for X yet" if the matching slug isn't in this table, and the bulk
  // upload template's examId column is validated against these same rows.
  // But there was NO endpoint anywhere — admin API or otherwise — to
  // create, list, or edit an Exam. The ExamPattern CRUD just below this
  // assumed exams already existed and only ever let you configure a
  // *pattern* for one. Whoever set up cgl/chsl/mts/cpo originally must
  // have inserted those rows by hand directly in the database; there was
  // no in-app way to add a 5th exam, or recover if one of the 4 is
  // missing/misconfigured on the live DB. This closes that gap.
  @Get('exams')
  async listExams() {
    return this.prisma.exam.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { questions: true } },
      },
    });
  }

  @Post('exams')
  async createExam(
    @Body()
    body: {
      name: string;
      slug: string;
      code: string;
      isActive?: boolean;
    },
  ) {
    if (!body?.name || !body?.slug || !body?.code) {
      throw new BadRequestException('name, slug, and code are all required');
    }
    const slug = body.slug.trim().toLowerCase();
    const code = body.code.trim().toUpperCase();
    const existing = await this.prisma.exam.findFirst({
      where: { OR: [{ slug }, { code }, { name: body.name.trim() }] },
    });
    if (existing) {
      throw new BadRequestException(
        `An exam already exists with this name/slug/code (id: ${existing.id}, slug: ${existing.slug}). ` +
          `Use PATCH /admin/exams/${existing.id} to edit it instead.`,
      );
    }
    return this.prisma.exam.create({
      data: {
        name: body.name.trim(),
        slug,
        code,
        isActive: body.isActive ?? true,
      },
    });
  }

  @Patch('exams/:id')
  async updateExam(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: Partial<{ name: string; slug: string; code: string; isActive: boolean }>,
  ) {
    const existing = await this.prisma.exam.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('Exam not found');
    return this.prisma.exam.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.slug !== undefined ? { slug: body.slug.trim().toLowerCase() } : {}),
        ...(body.code !== undefined ? { code: body.code.trim().toUpperCase() } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });
  }

  // No DELETE route on purpose: an Exam is referenced by Question, SourcePdf,
  // StudyPlan, ExamPattern, QuestionBankSet, and UserProgress rows (see
  // schema.prisma). Deleting one live would either cascade-orphan a large
  // amount of student data or fail on a foreign-key constraint depending on
  // the relation mode — neither is a safe "admin misclicked" recovery path.
  // Use isActive: false via PATCH to hide an exam instead.

  // ---- Exam Patterns ----
  // BUGFIX (bonus grep — "sari exams ke test dena ka option"): ExamPattern
  // rows (durationMinutes/totalQuestions/sections JSON per exam) are read
  // in several places — bank.service.ts's meta(), daily-test.service.ts,
  // and now tests.service.ts's sectionalExamForFamily() — but there was NO
  // admin endpoint anywhere to create/edit/delete one. An admin literally
  // could not configure a pattern for CHSL/MTS/CPO/any new exam through
  // the API; the table could only ever be touched by hand in the database.
  @Get('exam-patterns')
  async listExamPatterns(@Query('examId') examId?: string) {
    return this.prisma.examPattern.findMany({
      where: examId ? { examId } : undefined,
      include: { exam: { select: { name: true, slug: true, code: true } } },
      orderBy: { name: 'asc' },
    });
  }

  // ---- Marking presets (28 Oct 2026) ----
  // The official SSC marking schemes live in common/exam-presets.ts. This is a DRY RUN: it only compares them with
  // the patterns in the database and lists what a sync would change. Nothing is written.
  @Get('exam-patterns/presets')
  async examPatternPresets() {
    return this.buildPresetPlan();
  }

  // Applies the plan above (all of it, or only the preset keys given). Updates touch the marking numbers only —
  // lock / scribe settings, section timers and names that the admin set are kept. Idempotent.
  @Post('exam-patterns/presets/sync')
  async syncExamPatternPresets(@CurrentUser() user: AuthenticatedUser, @Body() body: { keys?: string[] }) {
    const plan = await this.buildPresetPlan();
    const only = Array.isArray(body?.keys) && body.keys.length ? new Set(body.keys) : null;
    const applied: { presetKey: string; kind: string; patternName: string }[] = [];
    for (const a of plan.actions) {
      if (only && !only.has(a.presetKey)) continue;
      if (a.kind === 'update' && a.patternId && a.write) {
        await this.prisma.examPattern.update({
          where: { id: a.patternId },
          data: {
            totalQuestions: a.write.totalQuestions,
            totalMarks: a.write.totalMarks,
            durationMinutes: a.write.durationMinutes,
            negativeMarks: a.write.negativeMarks,
            sections: a.write.sections as unknown as Prisma.InputJsonValue,
            sourceNote: a.write.sourceNote,
          },
        });
        applied.push({ presetKey: a.presetKey, kind: 'update', patternName: a.patternName ?? '' });
      } else if (a.kind === 'create' && a.examId && a.create) {
        await this.prisma.examPattern.create({
          data: {
            examId: a.examId,
            name: a.create.name,
            totalQuestions: a.create.totalQuestions,
            totalMarks: a.create.totalMarks,
            durationMinutes: a.create.durationMinutes,
            negativeMarks: a.create.negativeMarks,
            sections: a.create.sections as unknown as Prisma.InputJsonValue,
            lockPreviousSections: a.create.lockPreviousSections,
            scribeExtraMinutes: a.create.scribeExtraMinutes,
            sourceNote: a.create.sourceNote,
          },
        });
        applied.push({ presetKey: a.presetKey, kind: 'create', patternName: a.create.name });
      }
    }
    cacheClearPrefix(MARKING_CACHE_PREFIX);
    await this.auditLogService.log({
      userId: user?.userId,
      action: 'EXAM_PATTERN_PRESET_SYNC',
      targetEntity: 'ExamPattern',
      metadataJson: { applied },
    });
    return { ok: true, applied, skipped: plan.actions.filter((a) => a.kind === 'skip').map((a) => ({ presetKey: a.presetKey, warnings: a.warnings })) };
  }

  private async buildPresetPlan() {
    const [exams, patterns] = await Promise.all([
      this.prisma.exam.findMany({ select: { id: true, slug: true } }),
      this.prisma.examPattern.findMany({
        select: { id: true, examId: true, name: true, isActive: true, totalQuestions: true, totalMarks: true, durationMinutes: true, negativeMarks: true, sections: true, lockPreviousSections: true },
      }),
    ]);
    const actions = planPresetSync({ presets: EXAM_PRESETS, exams, patterns: patterns as ExistingPattern[] });
    return {
      checkedOn: '28 Oct 2026',
      actions: actions.map((a) => {
        const p = EXAM_PRESETS.find((x) => x.key === a.presetKey);
        return { ...a, remark: p?.remark ?? null, source: p?.source ?? null };
      }),
    };
  }

  // Pattern editor health check (Oct 26 2026). For ONE pattern it answers the three questions an admin has before
  // trusting it: (1) can every section actually be composed from the question bank, (2) which mocks run on it,
  // (3) which same-exam mocks could still be linked. Read-only; counts approximate paper() (published + bilingual).
  @Get('exam-patterns/:id/health')
  async examPatternHealth(@Param('id', ParseUUIDPipe) id: string) {
    const pattern = await this.prisma.examPattern.findUnique({ where: { id }, include: { exam: { select: { name: true } } } });
    if (!pattern) throw new NotFoundException('Exam pattern not found');
    const rows = readPatternSections(pattern.sections);
    const subjects = await this.prisma.subject.findMany({ select: { id: true, slug: true, name: true } });
    const bySlug = new Map(subjects.map((s) => [s.slug.toLowerCase(), s]));
    const idToSlug = new Map(subjects.map((s) => [s.id, s.slug.toLowerCase()]));

    const sections = await Promise.all(
      rows.map(async (r, index) => {
        const subj = r.subjectSlug ? bySlug.get(r.subjectSlug) : undefined;
        const need = r.questions ?? 0;
        let available = 0;
        if (subj) {
          available = await this.prisma.question.count({
            where: {
              isApproved: true,
              isActive: true,
              autoSuspended: false,
              subjectId: subj.id,
              examId: pattern.examId,
              OR: [{ questionTextHindi: { not: '' } }, { subject: { slug: 'english' } }],
            },
          });
        }
        // Same rules paper() applies: 0 -> blocked, below half the section -> blocked, below full -> shortened.
        const status = !r.subjectSlug ? 'no_subject' : !subj ? 'unknown_subject' : available === 0 || available < Math.max(1, Math.ceil(need / 2)) ? 'blocked' : available < need ? 'short' : 'ok';
        return { index, name: r.name, subjectSlug: r.subjectSlug ?? null, subjectName: subj?.name ?? null, questions: need, available, status };
      }),
    );

    const templateSelect = { id: true, title: true, type: true, isActive: true, isPremium: true, year: true, shift: true, examPatternId: true } as const;
    const typeIn = { in: ['FULL_MOCK', 'PREVIOUS_YEAR', 'SHIFT_WISE'] as any };
    const [linkedRaw, availableRaw] = await Promise.all([
      this.prisma.testTemplate.findMany({ where: { examPatternId: id }, select: templateSelect, orderBy: { createdAt: 'desc' }, take: 300 }),
      this.prisma.testTemplate.findMany({
        where: { examId: pattern.examId, type: typeIn, OR: [{ examPatternId: null }, { examPatternId: { not: id } }] },
        select: { ...templateSelect, examPattern: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
    ]);

    const blockedSections = sections.filter((x) => x.status === 'blocked' || x.status === 'unknown_subject' || x.status === 'no_subject').map((x) => x.name);
    const linked = await Promise.all(
      linkedRaw.map(async (t) => {
        let warning: string | null = null;
        let missing: string[] = [];
        if (t.id.startsWith('pyq-')) {
          // A PYQ mock serves ITS OWN paper; every pattern section needs >= 1 question there or the paper refuses to open.
          if (!t.year || !t.shift) {
            warning = 'unknown_paper';
          } else {
            const grouped = await this.prisma.question.groupBy({
              by: ['subjectId'],
              where: { isApproved: true, isActive: true, autoSuspended: false, examId: pattern.examId, year: t.year, shift: t.shift },
              _count: { _all: true },
            });
            const present = new Set(grouped.map((g) => idToSlug.get(g.subjectId)).filter(Boolean) as string[]);
            missing = rows.filter((r) => !r.subjectSlug || !present.has(r.subjectSlug)).map((r) => r.name);
            if (missing.length) warning = 'missing_sections';
          }
        } else if (blockedSections.length) {
          missing = blockedSections;
          warning = 'missing_sections';
        }
        return { ...t, warning, missingSections: missing };
      }),
    );

    return {
      pattern: { id: pattern.id, name: pattern.name, examId: pattern.examId, examName: pattern.exam?.name ?? '', lock: pattern.lockPreviousSections },
      sections,
      linked,
      available: availableRaw.map((t) => ({ ...t, otherPattern: t.examPattern?.name ?? null, examPattern: undefined })),
    };
  }

  @Post('exam-patterns')
  async createExamPattern(
    @Body()
    body: {
      examId: string;
      name: string;
      totalQuestions: number;
      totalMarks: number;
      durationMinutes: number;
      negativeMarks?: number;
      lockPreviousSections?: boolean;
      scribeExtraMinutes?: number;
      sourceNote?: string;
      sections: Array<{ name: string; subjectSlug?: string; questions: number; marks: number; durationMinutes?: number; scribeMinutes?: number; negativeMarks?: number }>;
    },
  ) {
    if (!body.examId || !body.name || !Array.isArray(body.sections) || body.sections.length === 0) {
      throw new BadRequestException('examId, name, and a non-empty sections array are required');
    }
    const exam = await this.prisma.exam.findUnique({ where: { id: body.examId } });
    if (!exam) throw new BadRequestException('Exam not found');
    this.assertPatternShape(body.sections, !!body.lockPreviousSections);

    cacheClearPrefix(MARKING_CACHE_PREFIX);
    return this.prisma.examPattern.create({
      data: {
        examId: body.examId,
        name: body.name,
        totalQuestions: body.totalQuestions,
        totalMarks: body.totalMarks,
        durationMinutes: body.durationMinutes,
        negativeMarks: body.negativeMarks ?? 0.25,
        sections: body.sections as unknown as Prisma.InputJsonValue,
        lockPreviousSections: !!body.lockPreviousSections,
        scribeExtraMinutes: Math.max(0, Math.floor(Number(body.scribeExtraMinutes) || 0)),
        sourceNote: body.sourceNote ?? null,
      },
    });
  }

  // P0 — a strict-sectional pattern is only usable if every section can be composed AND timed. Fail loudly at save
  // time instead of silently serving a mock whose timers cannot be built.
  private assertPatternShape(sections: unknown, lock: boolean) {
    const rows = Array.isArray(sections) ? (sections as any[]) : [];
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      const label = `Section ${i + 1}${r?.name ? ` (${r.name})` : ''}`;
      if (!r?.name || !String(r.name).trim()) throw new BadRequestException(`${label}: name is required`);
      if (!(Number(r.questions) > 0)) throw new BadRequestException(`${label}: questions must be > 0`);
      if (!(Number(r.marks) > 0)) throw new BadRequestException(`${label}: marks must be > 0`);
      if (lock) {
        if (!(Number(r.durationMinutes) > 0)) throw new BadRequestException(`${label}: durationMinutes is required when sections are locked`);
        if (!r.subjectSlug || !String(r.subjectSlug).trim()) throw new BadRequestException(`${label}: subjectSlug is required when sections are locked`);
        const slug = String(r.subjectSlug).trim().toLowerCase();
        const nm = `name:${String(r.name).trim().toLowerCase()}`;
        if (seen.has(nm)) throw new BadRequestException(`${label}: two sections share the name "${r.name}" — names must be unique`);
        seen.add(nm);
        if (seen.has(slug)) throw new BadRequestException(`${label}: subjectSlug "${slug}" is used by two sections — each locked section needs its own subject`);
        seen.add(slug);
      }
      if (r.negativeMarks != null && r.negativeMarks !== '' && !(Number(r.negativeMarks) >= 0)) {
        throw new BadRequestException(`${label}: negativeMarks must be 0 or more (0 = no negative marking in this section)`);
      }
      if (r.scribeMinutes != null && !(Number(r.scribeMinutes) >= Number(r.durationMinutes || 0))) {
        throw new BadRequestException(`${label}: scribeMinutes cannot be less than durationMinutes`);
      }
    });
  }

  @Patch('exam-patterns/:id')
  async updateExamPattern(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: Partial<{
      name: string;
      totalQuestions: number;
      totalMarks: number;
      durationMinutes: number;
      negativeMarks: number;
      isActive: boolean;
      lockPreviousSections: boolean;
      scribeExtraMinutes: number;
      sourceNote: string | null;
      sections: Array<{ name: string; subjectSlug?: string; questions: number; marks: number; durationMinutes?: number; scribeMinutes?: number; negativeMarks?: number }>;
    }>,
  ) {
    const existing = await this.prisma.examPattern.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('Exam pattern not found');
    this.assertPatternShape(
      body.sections !== undefined ? body.sections : existing.sections,
      body.lockPreviousSections !== undefined ? !!body.lockPreviousSections : existing.lockPreviousSections,
    );

    cacheClearPrefix(MARKING_CACHE_PREFIX);
    return this.prisma.examPattern.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.totalQuestions !== undefined ? { totalQuestions: body.totalQuestions } : {}),
        ...(body.totalMarks !== undefined ? { totalMarks: body.totalMarks } : {}),
        ...(body.durationMinutes !== undefined ? { durationMinutes: body.durationMinutes } : {}),
        ...(body.negativeMarks !== undefined ? { negativeMarks: body.negativeMarks } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.sections !== undefined ? { sections: body.sections as unknown as Prisma.InputJsonValue } : {}),
        ...(body.lockPreviousSections !== undefined ? { lockPreviousSections: !!body.lockPreviousSections } : {}),
        ...(body.scribeExtraMinutes !== undefined ? { scribeExtraMinutes: Math.max(0, Math.floor(Number(body.scribeExtraMinutes) || 0)) } : {}),
        ...(body.sourceNote !== undefined ? { sourceNote: body.sourceNote } : {}),
      },
    });
  }

  // P0 — create/refresh the two SSC CGL 2026 strict-sectional patterns (+ one DRAFT mock each, inactive).
  // Idempotent: re-running updates the same rows by (exam, name). NOTE the numbers come from published coaching
  // blogs (Drishti SSC, 1 Jun 2026) — sourceNote says so — so check them against the official notice on ssc.gov.in
  // and edit the pattern if anything differs; nothing is hardcoded in the exam engine.
  @Post('exam-patterns/seed-ssc-2026')
  async seedSsc2026Patterns(@CurrentUser() user: AuthenticatedUser) {
    const exam = await this.prisma.exam.findUnique({ where: { slug: 'cgl' } });
    if (!exam) throw new BadRequestException('Exam with slug "cgl" not found — create it first');
    const note =
      'Seeded 25 Oct 2026 from the Drishti SSC blog "SSC CGL New Exam Pattern 2026" (1 Jun 2026). NOT yet checked against the official SSC notice — verify marks, negative marking and timers on ssc.gov.in.';
    const defs = [
      {
        name: 'SSC CGL 2026 — Tier 1',
        totalQuestions: 100,
        totalMarks: 200,
        durationMinutes: 60,
        negativeMarks: 0.5,
        scribeExtraMinutes: 5,
        sections: [
          { name: 'General Intelligence & Reasoning', subjectSlug: 'reasoning', questions: 25, marks: 50, durationMinutes: 15, scribeMinutes: 20 },
          { name: 'General Awareness', subjectSlug: 'general_awareness', questions: 25, marks: 50, durationMinutes: 15, scribeMinutes: 20 },
          { name: 'Quantitative Aptitude', subjectSlug: 'quantitative_aptitude', questions: 25, marks: 50, durationMinutes: 15, scribeMinutes: 20 },
          { name: 'English Comprehension', subjectSlug: 'english', questions: 25, marks: 50, durationMinutes: 15, scribeMinutes: 20 },
        ],
        mock: { id: 'tpl-cgl-2026-t1-sectional-1', title: 'SSC CGL 2026 Tier 1 — Sectional-Timer Mock 1' },
      },
      {
        name: 'SSC CGL 2026 — Tier 2 Paper I (Session I)',
        totalQuestions: 150,
        totalMarks: 450,
        durationMinutes: 135,
        negativeMarks: 1,
        scribeExtraMinutes: 5,
        sections: [
          { name: 'Mathematical Abilities', subjectSlug: 'quantitative_aptitude', questions: 30, marks: 90, durationMinutes: 30, scribeMinutes: 40 },
          { name: 'Reasoning & General Intelligence', subjectSlug: 'reasoning', questions: 30, marks: 90, durationMinutes: 30, scribeMinutes: 40 },
          { name: 'English Language & Comprehension', subjectSlug: 'english', questions: 45, marks: 135, durationMinutes: 40, scribeMinutes: 55 },
          { name: 'General Awareness', subjectSlug: 'general_awareness', questions: 25, marks: 75, durationMinutes: 20, scribeMinutes: 25 },
          { name: 'Computer Knowledge', subjectSlug: 'computer', questions: 20, marks: 60, durationMinutes: 15, scribeMinutes: 20 },
        ],
        mock: { id: 'tpl-cgl-2026-t2-sectional-1', title: 'SSC CGL 2026 Tier 2 Paper I — Sectional-Timer Mock 1' },
      },
    ];
    const out: any[] = [];
    for (const d of defs) {
      this.assertPatternShape(d.sections, true);
      const pattern = await this.prisma.examPattern.upsert({
        where: { examId_name: { examId: exam.id, name: d.name } },
        create: {
          examId: exam.id,
          name: d.name,
          totalQuestions: d.totalQuestions,
          totalMarks: d.totalMarks,
          durationMinutes: d.durationMinutes,
          negativeMarks: d.negativeMarks,
          sections: d.sections as unknown as Prisma.InputJsonValue,
          lockPreviousSections: true,
          scribeExtraMinutes: d.scribeExtraMinutes,
          sourceNote: note,
        },
        update: {
          totalQuestions: d.totalQuestions,
          totalMarks: d.totalMarks,
          durationMinutes: d.durationMinutes,
          negativeMarks: d.negativeMarks,
          sections: d.sections as unknown as Prisma.InputJsonValue,
          lockPreviousSections: true,
          scribeExtraMinutes: d.scribeExtraMinutes,
        },
      });
      const template = await this.prisma.testTemplate.upsert({
        where: { id: d.mock.id },
        create: {
          id: d.mock.id,
          title: d.mock.title,
          description: `${d.name}: strict sectional timers, no going back to a closed section.`,
          type: 'FULL_MOCK',
          durationMinutes: d.durationMinutes,
          totalQuestions: d.totalQuestions,
          totalMarks: d.totalMarks,
          isPremium: false,
          isActive: false, // draft: admin reviews questions + decides free/paid, then activates
          examId: exam.id,
          examPatternId: pattern.id,
        },
        // never touch isActive/isPremium/price of an existing template on re-seed
        update: { examPatternId: pattern.id, durationMinutes: d.durationMinutes, totalQuestions: d.totalQuestions, totalMarks: d.totalMarks },
      });
      out.push({ patternId: pattern.id, patternName: pattern.name, templateId: template.id, templateActive: template.isActive });
    }
    cacheClearPrefix(MARKING_CACHE_PREFIX);
    await this.auditLogService.log({
      userId: user?.userId,
      action: 'EXAM_PATTERN_SEED_SSC_2026',
      targetEntity: 'ExamPattern',
      metadataJson: { created: out },
    });
    return { ok: true, note, patterns: out };
  }

  // P0 — attach (or detach) an ExamPattern to mock templates, so those mocks run with strict section timers.
  // Select either explicit templateIds, or every template of an exam (optionally only auto-PYQ "pyq-*" mocks).
  @Post('exam-patterns/:id/link-templates')
  async linkPatternTemplates(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { templateIds?: string[]; examId?: string; pyqOnly?: boolean; unlink?: boolean },
  ) {
    const pattern = await this.prisma.examPattern.findUnique({ where: { id } });
    if (!pattern) throw new BadRequestException('Exam pattern not found');
    if (!body.unlink && !pattern.lockPreviousSections) {
      throw new BadRequestException('This pattern does not lock sections — turn on lockPreviousSections first, or the link would change nothing.');
    }
    const ids = Array.isArray(body.templateIds) ? body.templateIds.filter((x) => typeof x === 'string' && x) : [];
    if (ids.length === 0 && !body.examId) throw new BadRequestException('Give templateIds, or an examId to link all of that exam’s templates');
    const where: Prisma.TestTemplateWhereInput = {
      ...(ids.length ? { id: { in: ids } } : {}),
      ...(!ids.length && body.examId ? { examId: body.examId } : {}),
      ...(body.pyqOnly ? { id: { startsWith: 'pyq-' } } : {}),
      type: { in: ['FULL_MOCK', 'PREVIOUS_YEAR', 'SHIFT_WISE'] },
    };
    const res = await this.prisma.testTemplate.updateMany({ where, data: { examPatternId: body.unlink ? null : pattern.id } });
    await this.auditLogService.log({
      userId: user?.userId,
      action: body.unlink ? 'EXAM_PATTERN_UNLINK_TEMPLATES' : 'EXAM_PATTERN_LINK_TEMPLATES',
      targetEntity: 'ExamPattern',
      entityId: id,
      metadataJson: { count: res.count, templateIds: ids, examId: body.examId ?? null, pyqOnly: !!body.pyqOnly },
    });
    return { ok: true, updated: res.count };
  }

  @Delete('exam-patterns/:id')
  async deleteExamPattern(@Param('id', ParseUUIDPipe) id: string) {
    const existing = await this.prisma.examPattern.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('Exam pattern not found');
    await this.prisma.examPattern.delete({ where: { id } });
    cacheClearPrefix(MARKING_CACHE_PREFIX);
    return { ok: true };
  }

  // ==================== REFER & EARN — ADMIN CONTROL ====================
  // Full visibility + control over the referral commission program: who
  // referred whom, who actually paid, every commission credited, every
  // withdrawal request, and the ability to suspend a user's referral
  // earning/withdrawal ability entirely.

  @Get('referrals')
  async listReferrals(@Query('search') search?: string) {
    const where: Prisma.ReferralWhereInput = search
      ? {
          OR: [
            { referrer: { fullName: { contains: search, mode: 'insensitive' } } },
            { referrer: { email: { contains: search, mode: 'insensitive' } } },
            { referee: { fullName: { contains: search, mode: 'insensitive' } } },
            { referee: { email: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {};

    const referrals = await this.prisma.referral.findMany({
      where,
      include: {
        referrer: { select: { id: true, fullName: true, email: true } },
        referee: { select: { id: true, fullName: true, email: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    return referrals.map((r) => ({
      id: r.id,
      referrer: r.referrer,
      referee: r.referee,
      status: r.status, // PENDING = signed up, no purchase yet | PAIDED = purchased via this code | REWARDED = hit the free-sub milestone
      purchasesCount: r.purchasesCount,
      rewardedAt: r.rewardedAt,
      createdAt: r.createdAt,
    }));
  }

  // One user's complete referral picture: their wallet, every person they
  // referred + whether each one purchased, every commission credited, and
  // every withdrawal they've made — everything admin needs to fully audit
  // a single referrer end-to-end.
  @Get('referrals/user/:userId')
  async getUserReferralDetail(@Param('userId', ParseUUIDPipe) userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, email: true, referralCode: true, freeSubFromReferral: true },
    });
    if (!user) throw new BadRequestException('User not found');

    const [wallet, referrals, earnings, withdrawals, payoutMethod] = await Promise.all([
      this.prisma.referralWallet.findUnique({ where: { userId } }),
      this.prisma.referral.findMany({
        where: { referrerId: userId },
        include: { referee: { select: { id: true, fullName: true, email: true, createdAt: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.referralEarning.findMany({
        where: { referrerId: userId },
        include: { referee: { select: { fullName: true } }, payment: { select: { gatewayOrderId: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.withdrawalRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.payoutMethod.findUnique({ where: { userId } }),
    ]);

    return {
      user,
      wallet: wallet || { balanceInr: 0, totalEarnedInr: 0, totalWithdrawnInr: 0, isSuspended: false },
      payoutMethod,
      referrals: referrals.map((r) => ({
        id: r.id,
        referee: r.referee,
        status: r.status,
        purchasesCount: r.purchasesCount,
        rewardedAt: r.rewardedAt,
        createdAt: r.createdAt,
      })),
      earnings: earnings.map((e) => ({
        id: e.id,
        refereeName: e.referee.fullName,
        orderId: e.payment.gatewayOrderId,
        purchaseAmountInr: e.purchaseAmountInr,
        commissionPct: e.commissionPct,
        commissionInr: e.commissionInr,
        createdAt: e.createdAt,
      })),
      withdrawals,
    };
  }

  // Suspend/unsuspend a user's entire referral earning + withdrawal ability.
  // Suspended = no new commission is ever credited to them, and they cannot
  // submit new withdrawal requests. Does NOT touch money already earned or
  // already-pending withdrawal requests — admin should reject those
  // separately if needed.
  @Post('referrals/user/:userId/suspend')
  async suspendReferralUser(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: { suspended: boolean; reason?: string },
  ) {
    await this.prisma.referralWallet.upsert({
      where: { userId },
      create: { userId, isSuspended: body.suspended, suspendedReason: body.suspended ? body.reason || 'Suspended by admin' : null },
      update: { isSuspended: body.suspended, suspendedReason: body.suspended ? body.reason || 'Suspended by admin' : null },
    });
    await this.auditLogService.log({
      userId: admin.userId,
      action: body.suspended ? 'REFERRAL_PROGRAM_SUSPENDED' : 'REFERRAL_PROGRAM_UNSUSPENDED',
      targetEntity: 'User',
      entityId: userId,
      metadataJson: { reason: body.reason },
    });
    return { ok: true };
  }

  // ---- Withdrawal requests ----
  @Get('withdrawals')
  async listWithdrawals(@Query('status') status?: string) {
    const rows = await this.prisma.withdrawalRequest.findMany({
      where: status ? { status: status as any } : {},
      include: { user: { select: { id: true, fullName: true, email: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows;
  }

  // Admin APPROVES a withdrawal. If Cashfree Payouts is configured
  // (PayoutService.isConfigured()), this immediately attempts the real
  // bank/UPI transfer and marks the row PAID (or FAILED + auto-refund on
  // failure). If Payouts isn't configured yet, this just flips the status
  // to APPROVED so admin can go send the money manually and then call
  // markManuallyPaid() below once it's actually sent — money is only ever
  // released to the user's payout method after this explicit admin action,
  // exactly as requested: "jab hee payment refer krne vle ko milega bs
  // admin ne confirm kra".
  @Post('withdrawals/:id/approve')
  async approveWithdrawal(@CurrentUser() admin: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    const w = await this.prisma.withdrawalRequest.findUnique({ where: { id }, include: { user: true } });
    if (!w) throw new BadRequestException('Withdrawal request not found');
    if (w.status !== 'REQUESTED') throw new BadRequestException(`Cannot approve a withdrawal in status ${w.status}`);

    if (!this.payoutService.isConfigured()) {
      await this.prisma.withdrawalRequest.update({
        where: { id },
        data: { status: 'APPROVED', processedByAdminId: admin.userId, processedAt: new Date() },
      });
      await this.auditLogService.log({
        userId: admin.userId,
        action: 'WITHDRAWAL_APPROVED_MANUAL',
        targetEntity: 'WithdrawalRequest',
        entityId: id,
        metadataJson: { amountInr: w.amountInr, note: 'Cashfree Payouts not configured — pay manually then call mark-paid' },
      });
      return { ok: true, autoPayout: false, message: 'Approved. Cashfree Payouts is not configured — send the money manually via UPI/bank, then mark this as Paid.' };
    }

    await this.prisma.withdrawalRequest.update({ where: { id }, data: { status: 'PROCESSING' } });

    try {
      const result = await this.payoutService.payWithdrawal({
        withdrawalId: w.id,
        amountInr: w.amountInr,
        userName: w.user.fullName,
        userEmail: w.user.email,
        userPhone: w.user.phone || '',
        payoutMethodType: w.payoutMethodType,
        upiId: w.upiId,
        bankAccountNo: w.bankAccountNo,
        bankIfsc: w.bankIfsc,
      });

      await this.prisma.$transaction([
        this.prisma.withdrawalRequest.update({
          where: { id },
          data: {
            status: 'PAID',
            cashfreeTransferId: result.cfTransferId,
            processedByAdminId: admin.userId,
            processedAt: new Date(),
          },
        }),
        this.prisma.referralWallet.update({
          where: { userId: w.userId },
          data: { totalWithdrawnInr: { increment: w.amountInr } },
        }),
      ]);

      await this.auditLogService.log({
        userId: admin.userId,
        action: 'WITHDRAWAL_PAID_AUTO',
        targetEntity: 'WithdrawalRequest',
        entityId: id,
        metadataJson: { amountInr: w.amountInr, cfTransferId: result.cfTransferId },
      });

      return { ok: true, autoPayout: true, cfTransferId: result.cfTransferId };
    } catch (e: any) {
      // Transfer failed — refund the held amount back to the wallet so the
      // user isn't left short, and record exactly why for admin to see.
      await this.prisma.$transaction([
        this.prisma.withdrawalRequest.update({
          where: { id },
          data: { status: 'FAILED', adminNote: String(e?.message || e), processedByAdminId: admin.userId, processedAt: new Date() },
        }),
        this.prisma.referralWallet.update({
          where: { userId: w.userId },
          data: { balanceInr: { increment: w.amountInr } },
        }),
      ]);
      await this.auditLogService.log({
        userId: admin.userId,
        action: 'WITHDRAWAL_PAYOUT_FAILED',
        targetEntity: 'WithdrawalRequest',
        entityId: id,
        metadataJson: { amountInr: w.amountInr, error: String(e?.message || e) },
      });
      throw new BadRequestException(`Payout failed: ${e?.message || e}. Amount has been refunded to the user's wallet.`);
    }
  }

  // For when Cashfree Payouts isn't configured: admin sent the money by
  // hand (UPI/bank transfer done outside the system) and now confirms it
  // here, which is the ONLY thing that permanently finalizes the deduction.
  @Post('withdrawals/:id/mark-paid')
  async markWithdrawalManuallyPaid(@CurrentUser() admin: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { note?: string }) {
    const w = await this.prisma.withdrawalRequest.findUnique({ where: { id } });
    if (!w) throw new BadRequestException('Withdrawal request not found');
    if (w.status !== 'APPROVED' && w.status !== 'REQUESTED') {
      throw new BadRequestException(`Cannot mark as paid from status ${w.status}`);
    }

    await this.prisma.$transaction([
      this.prisma.withdrawalRequest.update({
        where: { id },
        data: { status: 'PAID', adminNote: body.note || 'Paid manually by admin', processedByAdminId: admin.userId, processedAt: new Date() },
      }),
      this.prisma.referralWallet.update({
        where: { userId: w.userId },
        data: { totalWithdrawnInr: { increment: w.amountInr } },
      }),
    ]);

    await this.auditLogService.log({
      userId: admin.userId,
      action: 'WITHDRAWAL_PAID_MANUAL',
      targetEntity: 'WithdrawalRequest',
      entityId: id,
      metadataJson: { amountInr: w.amountInr, note: body.note },
    });
    return { ok: true };
  }

  // Admin REJECTS a withdrawal — refunds the held amount back to the
  // user's wallet so they can request again or fix their payout details.
  @Post('withdrawals/:id/reject')
  async rejectWithdrawal(@CurrentUser() admin: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { reason?: string }) {
    const w = await this.prisma.withdrawalRequest.findUnique({ where: { id } });
    if (!w) throw new BadRequestException('Withdrawal request not found');
    if (w.status === 'PAID') throw new BadRequestException('Cannot reject a withdrawal that has already been paid');

    await this.prisma.$transaction([
      this.prisma.withdrawalRequest.update({
        where: { id },
        data: { status: 'REJECTED', adminNote: body.reason || 'Rejected by admin', processedByAdminId: admin.userId, processedAt: new Date() },
      }),
      this.prisma.referralWallet.update({
        where: { userId: w.userId },
        data: { balanceInr: { increment: w.amountInr } },
      }),
    ]);

    await this.auditLogService.log({
      userId: admin.userId,
      action: 'WITHDRAWAL_REJECTED',
      targetEntity: 'WithdrawalRequest',
      entityId: id,
      metadataJson: { amountInr: w.amountInr, reason: body.reason },
    });
    return { ok: true };
  }
  }
