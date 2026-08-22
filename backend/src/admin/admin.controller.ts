import { Controller, Get, Query, UseGuards, Post, Body, Param, ParseUUIDPipe } from '@nestjs/common';
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
        where: { startedAt: { gte: since }, testTemplate: { type: 'FULL_MOCK' } } 
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
    const revenueByDay = revenueData.reduce((acc: any, r: any) => {
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
          select: { id: true, name: true } 
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
      revenueByDay: Object.entries(revenueByDay).map(([day, data]: [string, any]) => ({ day, ...data })),
      topUsers,
      questionBankPractice: {
        byMode: practiceStats,
        bySubject: subjectPractice.map(s => ({ 
          subjectId: s.subjectId, 
          subjectName: s.subjectId ? subjectMap.get(s.subjectId) : 'Unknown', 
          count: s._count 
        })),
      },
      mockTests: mockStats,
    };
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

  @Get('plans')
  async listPlans() {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { priceInr: 'asc' },
    });
    return { plans };
  }
}
