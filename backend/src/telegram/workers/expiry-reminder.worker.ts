/* eslint-disable @typescript-eslint/no-explicit-any */
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { TelegramService } from '../telegram.service';

// Requirement 3 — Expiry Reminder push (3 din pehle se roz, expiry ke turant
// baad band).
//
// Consumes the 'telegram-expiry-reminder' queue (registered in
// telegram.module.ts). Enqueued once a day by ExpiryReminderScheduler's cron
// (see expiry-reminder.scheduler.ts). This worker fans it out one message at
// a time, rate-limited to stay under Telegram's ~30 msg/sec bot API limit —
// same pattern as WeakTopicAnalysisWorker.
//
// BUG-CLASS THIS FILE EXISTS TO AVOID: a queue with jobs enqueued but no
// worker consuming it (found earlier in this audit for 'meilisearch-index',
// and guarded against again for 'telegram-weak-topic-analysis'). Registering
// this worker in telegram.module.ts's `providers` array is mandatory.
//
// This job carries no payload — the worker re-fetches the current
// expiring-subscriber list itself at run-time. Like WeakTopicAnalysisWorker,
// it must NOT store a "triggeredAt" in job.data (repeatable-job data is
// captured once at schedule-registration time and never re-evaluated per
// fire) — job.timestamp is the correct per-run value for logging.
type ExpiryReminderJobData = Record<string, never>;

@Injectable()
@Processor('telegram-expiry-reminder')
export class ExpiryReminderWorker extends WorkerHost {
  private readonly logger = new Logger(ExpiryReminderWorker.name);

  constructor(private readonly telegram: TelegramService) {
    super();
  }

  async process(job: Job<ExpiryReminderJobData>): Promise<{ sent: number; skipped: number; alreadySentToday: number; total: number }> {
    this.logger.log(`Starting daily expiry-reminder push (fired at ${new Date(job.timestamp).toISOString()})`);

    // getExpiringSubscribers() already re-applies status==='ACTIVE' &&
    // endsAt > now itself (it deliberately does NOT go through
    // getSubscribers(), which is scoped to opt-in TelegramSubscription
    // types — see the comment on getExpiringSubscribers() in
    // telegram.service.ts for why this is a separate code path).
    const expiring = await this.telegram.getExpiringSubscribers(3);

    let sent = 0;
    let skipped = 0;
    let alreadySentToday = 0;

    for (const sub of expiring) {
      try {
        // Atomic per-user/per-day claim — guards against double-sending if
        // this job is retried after a partial failure (the cron itself only
        // fires once a day, but a retry could re-run it).
        const claimed = await this.telegram.claimExpiryReminderSlot(sub.userId);
        if (!claimed) {
          alreadySentToday++;
          continue;
        }

        const text = this.telegram.buildExpiryReminderText(sub.planName, sub.endsAt);
        const res = await this.telegram.sendMessage({
          chat_id: Number(sub.chatId),
          text,
          parse_mode: 'HTML',
        });
        if (res.ok) {
          sent++;
        } else {
          skipped++;
          this.logger.warn(`Failed to send expiry-reminder to chat ${sub.chatId}: ${res.error}`);
        }
      } catch (e: any) {
        skipped++;
        this.logger.error(`Error building/sending expiry-reminder for user ${sub.userId}: ${e.message}`);
      }
      // Rate limit: same 35ms-between-sends constant as sendDailyPractice()/
      // broadcastAnnouncement()/WeakTopicAnalysisWorker, kept consistent.
      await new Promise((r) => setTimeout(r, 35));
    }

    this.logger.log(
      `Daily expiry-reminder push done: ${sent} sent, ${skipped} failed, ${alreadySentToday} already-sent-today, ${expiring.length} total eligible`,
    );
    return { sent, skipped, alreadySentToday, total: expiring.length };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`expiry-reminder job ${job.id} failed: ${err.message}`);
  }
}
