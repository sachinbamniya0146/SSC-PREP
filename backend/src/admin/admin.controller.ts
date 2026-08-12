import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';

// v1 §10 — Admin dashboards: revenue overview + audit log viewer.
// Both endpoints are ADMIN/MODERATOR-only (global JwtAuthGuard is on the module).
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  constructor(
    private prisma: PrismaService,
    private auditLogService: AuditLogService,
  ) {}

  // ---- Revenue overview ----
  @Get('revenue')
  @Roles(Role.ADMIN)
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
}
