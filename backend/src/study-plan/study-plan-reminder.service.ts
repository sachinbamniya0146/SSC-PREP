/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../auth/mail.service';

// =============================================================================
// StudyPlanReminderService (NEW — Oct 3 2026)
//
// "8:30 baje email jana chahiye ki aapka test 30 minutes baad hai."
// Every minute: find the 9:00 AM chapter tests (kind TEST) that start within the
// next 30 minutes and have no reminder yet, and e-mail the student once.
// A plain timer is used on purpose (no extra dependency); the reminder flag in the
// database makes a restart or a second run harmless.
// =============================================================================
@Injectable()
export class StudyPlanReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StudyPlanReminderService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), 60_000);
    // first run shortly after boot (catches a restart inside the 8:30–9:00 window)
    setTimeout(() => void this.tick(), 15_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const in30 = new Date(now.getTime() + 30 * 60_000);
      const due = await this.prisma.studyPlanTest.findMany({
        where: { kind: 'TEST', status: 'SCHEDULED', reminderSentAt: null, scheduledFor: { gt: now, lte: in30 } },
        take: 200,
      });
      for (const t of due) {
        // claim first (atomic) so two ticks can never send twice
        const claim = await this.prisma.studyPlanTest.updateMany({ where: { id: t.id, reminderSentAt: null }, data: { reminderSentAt: new Date() } });
        if (claim.count === 0) continue;
        const user = await this.prisma.user.findUnique({ where: { id: t.userId }, select: { email: true, fullName: true } });
        if (!user?.email) continue;
        const exam = await this.prisma.exam.findUnique({ where: { id: t.examId }, select: { name: true } });
        const chapterIds = ((t.chapterIds as string[]) ?? []).slice(0, 40);
        const chapters = await this.prisma.chapter.findMany({ where: { id: { in: chapterIds } }, select: { name: true } });
        const list = chapters.map((c) => `<li>${esc(c.name)}</li>`).join('');
        const site = process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://sscprephub.in';
        const html = `
          <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px">
            <h2 style="color:#1e293b;margin:0 0 8px">⏰ Aapka test 30 minute baad hai</h2>
            <p style="color:#475569;font-size:15px">Hi ${esc(user.fullName || 'Student')}, aapka <b>${esc(exam?.name || 'SSC')}</b> study-plan test aaj <b>9:00 AM</b> par khulega.
            Isme aapke chune hue ${chapters.length} chapter ke questions honge. Har chapter me <b>95%+</b> laana hai.</p>
            ${list ? `<ul style="color:#334155;font-size:14px">${list}</ul>` : ''}
            <p style="margin:20px 0"><a href="${site}/study-plan" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Test page kholein</a></p>
            <p style="color:#64748b;font-size:13px">9 baje ke baad aap kabhi bhi test de sakte hain.</p>
          </div>`;
        await this.mail.sendHtml(user.email, 'SSC Prep Hub — aapka test 30 minute baad hai', html);
      }
    } catch (e) {
      this.logger.warn(`reminder tick failed: ${(e as Error)?.message}`);
    } finally {
      this.running = false;
    }
  }
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
