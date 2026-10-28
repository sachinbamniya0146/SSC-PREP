import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { MailService } from '../auth/mail.service';
import { deletedMail, restoredMail, suspendedMail } from './user-mail.templates';

/** Placeholder account that keeps payment rows (accounting records) after a student is deleted. */
export const DELETED_USER_EMAIL = 'deleted-user@deleted.sscprephub.invalid';

@Injectable()
export class UserModerationService {
  private readonly logger = new Logger(UserModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly mail: MailService,
  ) {}

  private async loadTarget(adminId: string, userId: string) {
    if (adminId === userId) throw new BadRequestException('You cannot do this to your own account.');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, role: true, isSuspended: true },
    });
    if (!user || user.email === DELETED_USER_EMAIL) throw new NotFoundException('User not found');
    if (user.role === Role.ADMIN) {
      throw new BadRequestException('Admin accounts cannot be suspended or deleted. Change the role first.');
    }
    return user;
  }

  async suspend(adminId: string, userId: string, body: { reason?: string; notify?: boolean }) {
    const user = await this.loadTarget(adminId, userId);
    const reason = (body?.reason || '').trim();
    if (reason.length < 5) throw new BadRequestException('Please write a reason (at least 5 characters). It is shown to the student.');
    if (reason.length > 500) throw new BadRequestException('Reason is too long (max 500 characters).');
    if (user.isSuspended) throw new ConflictException('This account is already suspended.');

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { isSuspended: true, suspendedAt: now, suspendedReason: reason } }),
      // sign the student out everywhere: the JWT guard rejects tokens whose device session is inactive
      this.prisma.deviceSession.updateMany({ where: { userId, isActive: true }, data: { isActive: false } }),
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
    ]);
    await this.audit.log({
      userId: adminId,
      action: 'USER_SUSPENDED',
      targetEntity: 'User',
      entityId: userId,
      metadataJson: { email: user.email, reason },
    });
    const emailSent = body?.notify === false ? false : await this.notify(user.email, suspendedMail(user.fullName, user.email, reason));
    return { ok: true, emailSent };
  }

  async unsuspend(adminId: string, userId: string, body: { notify?: boolean }) {
    const user = await this.loadTarget(adminId, userId);
    if (!user.isSuspended) throw new ConflictException('This account is not suspended.');
    await this.prisma.user.update({ where: { id: userId }, data: { isSuspended: false, suspendedAt: null, suspendedReason: null } });
    await this.audit.log({
      userId: adminId,
      action: 'USER_UNSUSPENDED',
      targetEntity: 'User',
      entityId: userId,
      metadataJson: { email: user.email },
    });
    const emailSent = body?.notify === false ? false : await this.notify(user.email, restoredMail(user.fullName, user.email));
    return { ok: true, emailSent };
  }

  /** What would be lost if this account were deleted — shown to the admin before they confirm. */
  async deletePreview(adminId: string, userId: string) {
    const user = await this.loadTarget(adminId, userId);
    const now = new Date();
    const [activeSubs, payments, paidPayments, wallet, openWithdrawals, attempts] = await Promise.all([
      this.prisma.subscription.count({ where: { userId, status: 'ACTIVE', endsAt: { gt: now } } }),
      this.prisma.payment.count({ where: { userId } }),
      this.prisma.payment.count({ where: { userId, status: 'SUCCESS' } }),
      this.prisma.referralWallet.findUnique({ where: { userId }, select: { balanceInr: true } }),
      this.prisma.withdrawalRequest.count({ where: { userId, status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } } }),
      this.prisma.testAttempt.count({ where: { userId } }),
    ]);
    const walletBalanceInr = wallet?.balanceInr ?? 0;
    return {
      email: user.email,
      fullName: user.fullName,
      activeSubscriptions: activeSubs,
      payments,
      paidPayments,
      walletBalanceInr,
      openWithdrawals,
      testAttempts: attempts,
      blocked: openWithdrawals > 0,
      blockedReason: openWithdrawals > 0 ? 'This student has a withdrawal request in progress. Complete or reject it first.' : null,
      needsAcknowledge: activeSubs > 0 || walletBalanceInr > 0,
    };
  }

  async deletePermanently(
    adminId: string,
    userId: string,
    body: { confirmEmail?: string; reason?: string; notify?: boolean; acknowledge?: boolean },
  ) {
    const user = await this.loadTarget(adminId, userId);
    if ((body?.confirmEmail || '').trim().toLowerCase() !== user.email.toLowerCase()) {
      throw new BadRequestException('Type the student\'s exact email address to confirm the deletion.');
    }
    const preview = await this.deletePreview(adminId, userId);
    if (preview.blocked) throw new ConflictException(preview.blockedReason);
    if (preview.needsAcknowledge && body?.acknowledge !== true) {
      throw new ConflictException('This student has an active subscription or wallet balance. Tick the confirmation box to delete anyway.');
    }
    const reason = (body?.reason || '').trim().slice(0, 500);

    await this.prisma.$transaction(
      async (tx) => {
        // Payments have no cascade (they are accounting records): move them to a placeholder account first.
        const tomb = await tx.user.upsert({
          where: { email: DELETED_USER_EMAIL },
          update: {},
          create: {
            email: DELETED_USER_EMAIL,
            fullName: 'Deleted user',
            passwordHash: 'disabled:' + (await bcrypt.hash(randomBytes(24).toString('hex'), 4)),
            isSuspended: true,
            suspendedReason: 'System placeholder for deleted accounts',
          },
        });
        await tx.payment.updateMany({ where: { userId }, data: { userId: tomb.id } });
        // Everything else (attempts, answers, bookmarks, notes, sessions, subscriptions, wallet ...) cascades.
        await tx.user.delete({ where: { id: userId } });
      },
      { timeout: 60_000, maxWait: 10_000 },
    );

    await this.audit.log({
      userId: adminId,
      action: 'USER_DELETED_PERMANENTLY',
      targetEntity: 'User',
      entityId: userId,
      metadataJson: { email: user.email, fullName: user.fullName, reason, paymentsKept: preview.payments, testAttempts: preview.testAttempts },
    });
    const emailSent = body?.notify === false ? false : await this.notify(user.email, deletedMail(user.fullName, user.email, reason));
    return { ok: true, emailSent };
  }

  private async notify(to: string, m: { subject: string; html: string }): Promise<boolean> {
    try {
      return await this.mail.sendHtml(to, m.subject, m.html);
    } catch (e) {
      this.logger.error(`mail to ${to} failed: ${(e as Error).message}`);
      return false;
    }
  }
}
