import { Controller, Get, Query, UseGuards, Post, Body, Param, ParseUUIDPipe, Patch, Delete, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { MonetizationService } from '../monetization/monetization.service';
import { AdminService } from './admin.service';

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

  @Get('plans')
  async listPlans() {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { priceInr: 'asc' },
    });
    return { plans };
  }

  // ---- Plan Management (Admin) ----
  @Post('plans')
  async createPlan(@Body() body: { name: string; durationMonths: number; priceInr: number }) {
    const plan = await this.prisma.plan.create({
      data: { name: body.name, durationMonths: body.durationMonths, priceInr: body.priceInr, isActive: true },
    });
    await this.auditLogService.log({
      action: 'PLAN_CREATED',
      targetEntity: 'Plan',
      entityId: plan.id,
      metadataJson: body,
    });
    return { plan };
  }

  @Patch('plans/:id')
  async updatePlan(@Param('id', ParseUUIDPipe) id: string, @Body() body: { name?: string; durationMonths?: number; priceInr?: number; isActive?: boolean }) {
    const plan = await this.prisma.plan.update({
      where: { id },
      data: body,
    });
    await this.auditLogService.log({
      action: 'PLAN_UPDATED',
      targetEntity: 'Plan',
      entityId: id,
      metadataJson: body,
    });
    return { plan };
  }

  @Delete('plans/:id')
  async deletePlan(@Param('id', ParseUUIDPipe) id: string) {
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
    });
    return { coupons };
  }

  @Post('coupons')
  async createCoupon(@Body() body: { code: string; description?: string; discountPct?: number; discountInr?: number; maxUses?: number; expiresAt?: string }) {
    if (body.discountPct && body.discountInr) throw new Error('Use either discountPct or discountInr, not both');
    const coupon = await this.prisma.coupon.create({
      data: {
        code: body.code.trim().toUpperCase(),
        description: body.description,
        discountPct: body.discountPct,
        discountInr: body.discountInr,
        maxUses: body.maxUses ?? 1,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        isActive: true,
      },
    });
    await this.auditLogService.log({
      action: 'COUPON_CREATED',
      targetEntity: 'Coupon',
      entityId: coupon.id,
      metadataJson: body,
    });
    return { coupon };
  }

  @Patch('coupons/:id')
  async updateCoupon(@Param('id', ParseUUIDPipe) id: string, @Body() body: { description?: string; discountPct?: number; discountInr?: number; maxUses?: number; expiresAt?: string; isActive?: boolean }) {
    const coupon = await this.prisma.coupon.update({
      where: { id },
      data: body,
    });
    await this.auditLogService.log({
      action: 'COUPON_UPDATED',
      targetEntity: 'Coupon',
      entityId: id,
      metadataJson: body,
    });
    return { coupon };
  }

  @Delete('coupons/:id')
  async deleteCoupon(@Param('id', ParseUUIDPipe) id: string) {
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
    if (!payment) throw new Error('Payment not found');

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
      // Payment gateway is PayU (see monetization.service.ts payuConfig) — not Razorpay.
      paymentMethod: 'PayU',
      razorpayOrderId: payment.razorpayOrderId,
      razorpayPaymentId: payment.razorpayPaymentId,
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
    if (!plan || !plan.isActive) throw new Error('Plan not found or inactive');

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
      sections: Array<{ name: string; subjectSlug?: string; questions: number; marks: number; durationMinutes?: number }>;
    },
  ) {
    if (!body.examId || !body.name || !Array.isArray(body.sections) || body.sections.length === 0) {
      throw new BadRequestException('examId, name, and a non-empty sections array are required');
    }
    const exam = await this.prisma.exam.findUnique({ where: { id: body.examId } });
    if (!exam) throw new BadRequestException('Exam not found');

    return this.prisma.examPattern.create({
      data: {
        examId: body.examId,
        name: body.name,
        totalQuestions: body.totalQuestions,
        totalMarks: body.totalMarks,
        durationMinutes: body.durationMinutes,
        negativeMarks: body.negativeMarks ?? 0.25,
        sections: body.sections as unknown as Prisma.InputJsonValue,
      },
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
      sections: Array<{ name: string; subjectSlug?: string; questions: number; marks: number; durationMinutes?: number }>;
    }>,
  ) {
    const existing = await this.prisma.examPattern.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('Exam pattern not found');

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
      },
    });
  }

  @Delete('exam-patterns/:id')
  async deleteExamPattern(@Param('id', ParseUUIDPipe) id: string) {
    const existing = await this.prisma.examPattern.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('Exam pattern not found');
    await this.prisma.examPattern.delete({ where: { id } });
    return { ok: true };
  }
  }
