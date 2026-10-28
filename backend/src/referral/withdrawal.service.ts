// Admin side of Refer & Earn withdrawals: sanction -> pay (UTR) / reject, plus the numbers the admin looks at.
//
// Money rules (every one is enforced here, not in the browser):
//  * The student's balance is already reduced when the request is made. The only ways out of an open request are
//    PAID (deduction stays) or REJECTED / FAILED (the amount goes back to the wallet - exactly once).
//  * Every status change is a conditional update ("... WHERE id = ? AND status IN (...)") inside one database
//    transaction together with the wallet change. Double click, two admins or the background job can never apply
//    the same change twice: the second one finds 0 rows and gets a clear "already ..." message.
//  * An answer from Cashfree that we cannot interpret (timeout, 5xx) never refunds anything - the request stays in
//    PROCESSING until Cashfree itself says success or failure (checked by the background job every 5 minutes).
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PayoutApiError, PayoutService, TransferSnapshot } from './payout.service';
import {
  WdStatus,
  buildTransferId,
  buildWithdrawalStats,
  canMove,
  cleanReason,
  isWdStatus,
  mapGatewayStatus,
  paidMismatch,
  round2,
  startOfTodayIst,
  validatePaymentRef,
} from './withdrawal.util';

const POLL_EVERY_MS = 5 * 60_000;
/** A PROCESSING transfer that Cashfree has never heard of after this long can safely be sent again. */
const NEVER_REACHED_AFTER_MS = 10 * 60_000;

type SyncResult = { ok: true; status: WdStatus; message: string; uncertain?: boolean };

@Injectable()
export class WithdrawalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WithdrawalService.name);
  private timer?: NodeJS.Timeout;
  private polling = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payout: PayoutService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ---------------------------------------------------------------- background: ask Cashfree about PROCESSING rows
  onModuleInit() {
    if (process.env.WITHDRAWAL_POLL === 'off') return;
    setTimeout(() => void this.tick(), 60_000).unref?.();
    this.timer = setInterval(() => void this.tick(), POLL_EVERY_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass of the job. Safe to run twice / in two containers: every change is a conditional update. */
  async tick(): Promise<number> {
    if (this.polling || !this.payout.isConfigured()) return 0;
    this.polling = true;
    let changed = 0;
    try {
      const rows = await this.prisma.withdrawalRequest.findMany({
        where: { status: 'PROCESSING' },
        orderBy: { lastCheckedAt: { sort: 'asc', nulls: 'first' } },
        take: 50,
        select: { id: true, processedAt: true },
      });
      for (const w of rows) {
        try {
          const r = await this.syncOne(w.id, w.processedAt, null);
          if (r.status !== 'PROCESSING') changed++;
        } catch (e) {
          this.logger.warn(`[withdrawals] status check failed for ${w.id}: ${(e as Error)?.message}`);
        }
      }
      if (changed > 0) this.logger.log(`[withdrawals] ${changed} transfer(s) settled by the status check`);
    } catch (e) {
      this.logger.error(`[withdrawals] status job failed: ${(e as Error)?.message}`);
    } finally {
      this.polling = false;
    }
    return changed;
  }

  // ---------------------------------------------------------------- small helpers

  private async audit(adminId: string | null | undefined, action: string, id: string, meta: Record<string, unknown>) {
    try {
      await this.auditLog.log({ userId: adminId ?? undefined, action, targetEntity: 'WithdrawalRequest', entityId: id, metadataJson: meta });
    } catch (e) {
      // the money step already happened - a failed log line must not turn it into an error for the admin
      this.logger.error(`[withdrawals] audit log failed for ${action} ${id}: ${(e as Error)?.message}`);
    }
  }

  private async mustFind(id: string) {
    const w = await this.prisma.withdrawalRequest.findUnique({
      where: { id },
      include: { user: { select: { id: true, fullName: true, email: true, phone: true, isSuspended: true } } },
    });
    if (!w) throw new NotFoundException('Withdrawal request not found');
    return w;
  }

  /** A conditional update matched nothing: say what the request looks like now. */
  private async stateError(id: string, action: string): Promise<Error> {
    const cur = await this.prisma.withdrawalRequest.findUnique({ where: { id }, select: { status: true } });
    if (!cur) return new NotFoundException('Withdrawal request not found');
    if (cur.status === 'REQUESTED') return new ConflictException(`Cannot ${action}: sanction (approve) this request first.`);
    return new ConflictException(`Cannot ${action}: this request is already ${cur.status.toLowerCase()}. Refresh the list.`);
  }

  private async assertNotFrozen(userId: string, userSuspended: boolean) {
    const wallet = await this.prisma.referralWallet.findUnique({ where: { userId }, select: { isSuspended: true, suspendedReason: true } });
    if (userSuspended || wallet?.isSuspended) {
      throw new BadRequestException(
        'This student is suspended or their referral earnings are paused. Reject the request (the money goes back to the wallet) or restore their earnings first.',
      );
    }
  }

  /** Moves a request to PAID and records it in the wallet counter - both or neither. False = it was not in an allowed state. */
  private async finishPaid(
    id: string,
    opts: { from: WdStatus[]; actorId?: string | null; paymentRef?: string | null; note?: string | null; gatewayStatus?: string | null },
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const w = await tx.withdrawalRequest.findUnique({ where: { id } });
      if (!w) throw new NotFoundException('Withdrawal request not found');
      const now = new Date();
      const claim = await tx.withdrawalRequest.updateMany({
        where: { id, status: { in: [...opts.from] } },
        data: {
          status: 'PAID',
          paidAt: now,
          processedAt: now,
          lastCheckedAt: now,
          adminNote: opts.note ?? null,
          ...(opts.actorId ? { paidById: opts.actorId, processedByAdminId: opts.actorId } : {}),
          ...(opts.paymentRef ? { paymentRef: opts.paymentRef } : {}),
          ...(opts.gatewayStatus ? { gatewayStatus: opts.gatewayStatus } : {}),
        },
      });
      if (claim.count !== 1) return false;
      await tx.referralWallet.update({ where: { userId: w.userId }, data: { totalWithdrawnInr: { increment: w.amountInr } } });
      return true;
    });
  }

  /** Moves a request to REJECTED / FAILED and gives the amount back to the wallet - both or neither, at most once. */
  private async finishRefund(
    id: string,
    opts: { from: WdStatus[]; to: 'REJECTED' | 'FAILED'; actorId?: string | null; note: string; gatewayStatus?: string | null },
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const w = await tx.withdrawalRequest.findUnique({ where: { id } });
      if (!w) throw new NotFoundException('Withdrawal request not found');
      const now = new Date();
      const claim = await tx.withdrawalRequest.updateMany({
        where: { id, status: { in: [...opts.from] } },
        data: {
          status: opts.to,
          adminNote: opts.note,
          rejectedAt: now,
          processedAt: now,
          lastCheckedAt: now,
          ...(opts.actorId ? { processedByAdminId: opts.actorId } : {}),
          ...(opts.gatewayStatus ? { gatewayStatus: opts.gatewayStatus } : {}),
        },
      });
      if (claim.count !== 1) return false;
      await tx.referralWallet.update({ where: { userId: w.userId }, data: { balanceInr: { increment: w.amountInr } } });
      return true;
    });
  }

  // ---------------------------------------------------------------- lists & numbers

  async list(statusRaw?: string, q?: string) {
    const status = isWdStatus(statusRaw) ? statusRaw : undefined;
    const term = String(q ?? '').trim().slice(0, 80);
    const where: Prisma.WithdrawalRequestWhereInput = {
      ...(status ? { status } : {}),
      ...(term
        ? {
            OR: [
              { user: { fullName: { contains: term, mode: 'insensitive' } } },
              { user: { email: { contains: term, mode: 'insensitive' } } },
              { paymentRef: { contains: term, mode: 'insensitive' } },
              { upiId: { contains: term, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    // waiting work: oldest first (first come, first served); history: newest first
    const queue = status === 'REQUESTED' || status === 'APPROVED' || status === 'PROCESSING';
    const rows = await this.prisma.withdrawalRequest.findMany({
      where,
      include: { user: { select: { id: true, fullName: true, email: true, phone: true } } },
      orderBy: { createdAt: queue ? 'asc' : 'desc' },
      take: 300,
    });

    // how many of this person's friends are flagged (same device ...) - a warning for the admin before paying
    const ids = Array.from(new Set(rows.map((r) => r.userId)));
    const flagged = ids.length
      ? await this.prisma.referral.groupBy({
          by: ['referrerId'],
          where: { referrerId: { in: ids }, flagReason: { not: null } },
          _count: { _all: true },
        })
      : [];
    const flaggedBy = new Map(flagged.map((f) => [f.referrerId, f._count._all]));
    return rows.map((r) => ({ ...r, flaggedFriends: flaggedBy.get(r.userId) ?? 0 }));
  }

  async stats() {
    const now = new Date();
    const today = startOfTodayIst(now);
    const d30 = new Date(now.getTime() - 30 * 86_400_000);
    const paidSince = (gte: Date) =>
      this.prisma.withdrawalRequest.aggregate({ where: { status: 'PAID', paidAt: { gte } }, _sum: { amountInr: true }, _count: { _all: true } });

    const [groups, wallets, paidToday, paid30, oldest] = await Promise.all([
      this.prisma.withdrawalRequest.groupBy({ by: ['status'], _count: { _all: true }, _sum: { amountInr: true } }),
      this.prisma.referralWallet.aggregate({ _sum: { totalWithdrawnInr: true } }),
      paidSince(today),
      paidSince(d30),
      this.prisma.withdrawalRequest.findFirst({ where: { status: 'REQUESTED' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    ]);

    const s = buildWithdrawalStats(groups.map((g) => ({ status: g.status, count: g._count._all, amountInr: g._sum.amountInr ?? 0 })));
    return {
      ...s,
      paidToday: { count: paidToday._count._all, amountInr: round2(paidToday._sum.amountInr ?? 0) },
      paidLast30Days: { count: paid30._count._all, amountInr: round2(paid30._sum.amountInr ?? 0) },
      oldestAwaitingHours: oldest ? Math.max(0, Math.floor((now.getTime() - oldest.createdAt.getTime()) / 3_600_000)) : null,
      payoutMode: this.payout.isConfigured() ? ('CASHFREE' as const) : ('MANUAL' as const),
      // the wallet counters must equal the paid rows; a difference is shown to the admin as a warning
      mismatch: paidMismatch(wallets._sum.totalWithdrawnInr ?? 0, s.paid.amountInr),
    };
  }

  // ---------------------------------------------------------------- actions

  /** Sanction: the admin agrees that this request will be paid. Nothing is sent yet. */
  async approve(adminId: string, id: string) {
    const w = await this.mustFind(id);
    if (!canMove(w.status, 'APPROVED')) throw await this.stateError(id, 'approve');
    await this.assertNotFrozen(w.userId, w.user.isSuspended);

    const now = new Date();
    const claim = await this.prisma.withdrawalRequest.updateMany({
      where: { id, status: 'REQUESTED' },
      data: { status: 'APPROVED', approvedAt: now, approvedById: adminId, processedAt: now, processedByAdminId: adminId },
    });
    if (claim.count !== 1) throw await this.stateError(id, 'approve');
    await this.audit(adminId, 'WITHDRAWAL_APPROVED', id, { amountInr: w.amountInr, userId: w.userId });
    return {
      ok: true,
      status: 'APPROVED' as const,
      autoPayout: this.payout.isConfigured(),
      message: this.payout.isConfigured()
        ? 'Sanctioned. Press "Send via Cashfree", or pay it yourself and record the UTR.'
        : 'Sanctioned. Now send the money from your UPI / bank app and record the UTR with "Mark as paid".',
    };
  }

  /** Admin sent the money by hand (UPI / bank app) and records the UTR. The only manual way to reach PAID. */
  async markPaid(adminId: string, id: string, referenceRaw: string, noteRaw?: string) {
    const ref = validatePaymentRef(referenceRaw);
    if (!ref.ok) throw new BadRequestException(ref.error);
    const note = String(noteRaw ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || null;

    const w = await this.mustFind(id);
    if (!canMove(w.status, 'PAID')) throw await this.stateError(id, 'mark as paid');
    const dup = await this.prisma.withdrawalRequest.findFirst({ where: { paymentRef: ref.value, id: { not: id } }, select: { id: true } });
    if (dup) throw new ConflictException('This UTR / reference is already recorded on another withdrawal. Check the number.');

    const ok = await this.finishPaid(id, { from: ['APPROVED', 'PROCESSING'], actorId: adminId, paymentRef: ref.value, note });
    if (!ok) throw await this.stateError(id, 'mark as paid');
    await this.audit(adminId, 'WITHDRAWAL_PAID_MANUAL', id, { amountInr: w.amountInr, userId: w.userId, paymentRef: ref.value, wasProcessing: w.status === 'PROCESSING' });
    return { ok: true, status: 'PAID' as const };
  }

  /** Reject (or take back a sanction before paying): the amount goes back to the student's wallet. */
  async reject(adminId: string, id: string, reasonRaw: string) {
    const reason = cleanReason(reasonRaw);
    if (!reason.ok) throw new BadRequestException(reason.error);
    const w = await this.mustFind(id);
    if (!canMove(w.status, 'REJECTED')) {
      if (w.status === 'PROCESSING') {
        throw new ConflictException('The money is already on its way through Cashfree. Use "Check status" - it is refunded automatically if the transfer fails.');
      }
      throw await this.stateError(id, 'reject');
    }
    const ok = await this.finishRefund(id, { from: ['REQUESTED', 'APPROVED'], to: 'REJECTED', actorId: adminId, note: reason.value });
    if (!ok) throw await this.stateError(id, 'reject');
    await this.audit(adminId, 'WITHDRAWAL_REJECTED', id, { amountInr: w.amountInr, userId: w.userId, reason: reason.value, wasStatus: w.status });
    return { ok: true, status: 'REJECTED' as const };
  }

  /** Override for a stuck PROCESSING row: the admin saw in the Cashfree dashboard that it failed. Refunds once. */
  async markFailed(adminId: string, id: string, reasonRaw: string) {
    const reason = cleanReason(reasonRaw);
    if (!reason.ok) throw new BadRequestException(reason.error);
    const w = await this.mustFind(id);
    if (w.status !== 'PROCESSING') throw await this.stateError(id, 'mark as failed');
    const ok = await this.finishRefund(id, { from: ['PROCESSING'], to: 'FAILED', actorId: adminId, note: reason.value });
    if (!ok) throw await this.stateError(id, 'mark as failed');
    await this.audit(adminId, 'WITHDRAWAL_MARKED_FAILED', id, { amountInr: w.amountInr, userId: w.userId, reason: reason.value });
    return { ok: true, status: 'FAILED' as const };
  }

  /** Send a sanctioned withdrawal through Cashfree Payouts (only when it is configured). */
  async pay(adminId: string, id: string): Promise<SyncResult> {
    if (!this.payout.isConfigured()) {
      throw new BadRequestException('Cashfree Payouts is not set up yet. Send the money from your UPI / bank app and use "Mark as paid".');
    }
    const w = await this.mustFind(id);
    if (!canMove(w.status, 'PROCESSING')) throw await this.stateError(id, 'send');
    await this.assertNotFrozen(w.userId, w.user.isSuspended);

    const transferId = buildTransferId(w.id);
    const claim = await this.prisma.withdrawalRequest.updateMany({
      where: { id, status: 'APPROVED' },
      data: { status: 'PROCESSING', cashfreeTransferId: transferId, processedAt: new Date(), processedByAdminId: adminId, gatewayStatus: null, lastCheckedAt: null },
    });
    if (claim.count !== 1) throw await this.stateError(id, 'send');
    await this.audit(adminId, 'WITHDRAWAL_SENT_TO_GATEWAY', id, { amountInr: w.amountInr, userId: w.userId, transferId });

    try {
      const snap = await this.payout.submitTransfer({
        withdrawalId: w.id,
        amountInr: w.amountInr,
        userName: w.user.fullName,
        userEmail: w.user.email,
        userPhone: w.user.phone || '',
        payoutMethodType: w.payoutMethodType,
        upiId: w.upiId,
        bankAccountNo: w.bankAccountNo,
        bankIfsc: w.bankIfsc,
        bankAccountName: w.bankAccountName,
      });
      return await this.applySnapshot(id, snap, adminId);
    } catch (e) {
      if (e instanceof PayoutApiError && e.definite) {
        // Cashfree clearly refused (bad account, blocked, ...): nothing was sent, give the money back.
        const note = `Cashfree refused: ${e.message}`;
        await this.finishRefund(id, { from: ['PROCESSING'], to: 'FAILED', actorId: adminId, note });
        await this.audit(adminId, 'WITHDRAWAL_PAYOUT_FAILED', id, { amountInr: w.amountInr, error: e.message, code: e.code });
        throw new BadRequestException(`${note}. The amount is back in the student's wallet.`);
      }
      // We do not know whether the money left. Keep it PROCESSING - never refund on a guess, never send twice.
      const msg = (e as Error)?.message || 'unknown error';
      this.logger.error(`[withdrawals] ${id}: could not confirm the transfer (${msg}) - left in PROCESSING`);
      await this.audit(adminId, 'WITHDRAWAL_PAYOUT_UNCERTAIN', id, { amountInr: w.amountInr, error: msg });
      return {
        ok: true,
        status: 'PROCESSING',
        uncertain: true,
        message: 'Could not get a clear answer from Cashfree. The request stays "Processing" - do NOT pay it again. Press "Check status" in a few minutes (it is also checked automatically).',
      };
    }
  }

  /** Ask Cashfree where a PROCESSING transfer is. */
  async checkStatus(adminId: string, id: string): Promise<SyncResult> {
    if (!this.payout.isConfigured()) {
      throw new BadRequestException('Cashfree Payouts is not set up. If you already paid this by hand, use "Mark as paid" with the UTR.');
    }
    const w = await this.mustFind(id);
    if (w.status !== 'PROCESSING') throw await this.stateError(id, 'check');
    try {
      return await this.syncOne(id, w.processedAt, adminId);
    } catch (e) {
      throw new BadRequestException(`Could not reach Cashfree: ${(e as Error)?.message || 'try again in a minute'}`);
    }
  }

  // ---------------------------------------------------------------- Cashfree answers -> our state

  private async syncOne(id: string, processedAt: Date | null, actorId: string | null): Promise<SyncResult> {
    const snap = await this.payout.getTransfer(buildTransferId(id));
    if (snap) return this.applySnapshot(id, snap, actorId);

    // Cashfree has no such transfer. Right after sending that can be a short delay; much later it means it never arrived.
    const age = Date.now() - (processedAt?.getTime() ?? 0);
    if (age >= NEVER_REACHED_AFTER_MS) {
      const back = await this.prisma.withdrawalRequest.updateMany({
        where: { id, status: 'PROCESSING' },
        data: { status: 'APPROVED', gatewayStatus: 'NOT_FOUND', lastCheckedAt: new Date(), adminNote: 'The transfer never reached Cashfree - it can be sent again.' },
      });
      if (back.count === 1) {
        await this.audit(actorId, 'WITHDRAWAL_PAYOUT_NOT_FOUND', id, {});
        return { ok: true, status: 'APPROVED', message: 'The transfer never reached Cashfree, so nothing was sent. It is back to "Sanctioned" - you can send it again.' };
      }
    }
    await this.prisma.withdrawalRequest.updateMany({ where: { id, status: 'PROCESSING' }, data: { lastCheckedAt: new Date() } });
    return { ok: true, status: 'PROCESSING', message: 'Cashfree has not registered this transfer yet. Check again in a minute.' };
  }

  /** Someone else (the other admin, the job) already moved this request: report what it is now. */
  private async alreadySettled(id: string): Promise<SyncResult> {
    const cur = await this.prisma.withdrawalRequest.findUnique({ where: { id }, select: { status: true } });
    const status = (cur?.status ?? 'PROCESSING') as WdStatus;
    return { ok: true, status, message: `Already ${status.toLowerCase()} - nothing more to do.` };
  }

  private async applySnapshot(id: string, snap: TransferSnapshot, actorId: string | null): Promise<SyncResult> {
    const outcome = mapGatewayStatus(snap.status, snap.statusCode);

    if (outcome === 'PAID') {
      const done = await this.finishPaid(id, { from: ['PROCESSING'], actorId, paymentRef: snap.utr, gatewayStatus: snap.status });
      if (!done) return this.alreadySettled(id);
      await this.audit(actorId, 'WITHDRAWAL_PAID_AUTO', id, { transferId: snap.transferId, cfTransferId: snap.cfTransferId, utr: snap.utr });
      return { ok: true, status: 'PAID', message: snap.utr ? `Paid. UTR ${snap.utr}.` : 'Paid through Cashfree.' };
    }

    if (outcome === 'FAILED') {
      const note = `Cashfree: ${snap.status}${snap.statusCode ? ` / ${snap.statusCode}` : ''}`;
      const done = await this.finishRefund(id, { from: ['PROCESSING'], to: 'FAILED', actorId, note, gatewayStatus: snap.status });
      if (!done) return this.alreadySettled(id);
      await this.audit(actorId, 'WITHDRAWAL_PAYOUT_FAILED', id, { transferId: snap.transferId, status: snap.status, statusCode: snap.statusCode });
      return { ok: true, status: 'FAILED', message: "Cashfree could not complete the transfer. The amount is back in the student's wallet." };
    }

    await this.prisma.withdrawalRequest.updateMany({
      where: { id, status: 'PROCESSING' },
      data: { gatewayStatus: snap.status, lastCheckedAt: new Date() },
    });
    return { ok: true, status: 'PROCESSING', message: `Cashfree says "${snap.status}" - the bank has not confirmed yet. It is checked again automatically.` };
  }
}
