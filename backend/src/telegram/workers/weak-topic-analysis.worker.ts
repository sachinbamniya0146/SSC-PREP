/* eslint-disable @typescript-eslint/no-explicit-any */
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { TelegramService } from '../telegram.service';

// Requirement 2 — Daily Weak-Topic Analysis push.
//
// This worker consumes the 'telegram-weak-topic-analysis' queue (registered
// in telegram.module.ts). The job is enqueued once a day by
// TelegramSchedulerService's cron (see weak-topic-analysis.scheduler.ts),
// and this worker fans it out to every eligible subscriber one message at a
// time, rate-limited to stay under Telegram's ~30 msg/sec bot API limit.
//
// BUG-CLASS THIS FILE EXISTS TO AVOID: a queue with jobs enqueued but no
// worker consuming it. This exact gap was found earlier in this audit for
// the 'meilisearch-index' queue (jobs sat in Redis forever, unprocessed).
// Registering this worker in telegram.module.ts's `providers` array is
// mandatory — the queue alone does nothing.
// This job carries no payload — the worker re-fetches the current
// subscriber list itself at run-time (see note on job.data below).
type WeakTopicAnalysisJobData = Record<string, never>;

@Injectable()
@Processor('telegram-weak-topic-analysis')
export class WeakTopicAnalysisWorker extends WorkerHost {
  private readonly logger = new Logger(WeakTopicAnalysisWorker.name);

  constructor(private readonly telegram: TelegramService) {
    super();
  }

  async process(job: Job<WeakTopicAnalysisJobData>): Promise<{ sent: number; skipped: number; total: number }> {
    // BUGFIX-BY-DESIGN: a BullMQ repeatable job's `data` is captured once at
    // schedule-registration time and stays fixed across every recurrence —
    // it is NOT re-evaluated per fire. Using job.data.triggeredAt here would
    // log the same stale registration-time timestamp on every single daily
    // run forever. job.timestamp (set by BullMQ itself when each occurrence
    // is actually enqueued) is the correct per-run value to log instead.
    this.logger.log(`Starting daily weak-topic-analysis push (fired at ${new Date(job.timestamp).toISOString()})`);

    // getSubscribers() already filters to isActive TelegramSubscription rows
    // AND cross-checks Subscription.status==='ACTIVE' && endsAt > now — see
    // telegram.service.ts. This is the single source of truth for "who
    // should receive this type of message right now"; this worker must not
    // re-implement or bypass that filter.
    const subs = await this.telegram.getSubscribers('weak_topic_analysis');

    let sent = 0;
    let skipped = 0;

    for (const sub of subs) {
      try {
        const text = await this.telegram.buildProgressReportText(sub.userId);
        const res = await this.telegram.sendMessage({
          chat_id: Number(sub.chatId),
          text: `🌙 <b>Your Daily Study Nudge</b>\n\n${text}`,
          parse_mode: 'HTML',
        });
        if (res.ok) {
          sent++;
        } else {
          skipped++;
          this.logger.warn(`Failed to send weak-topic-analysis to chat ${sub.chatId}: ${res.error}`);
        }
      } catch (e: any) {
        skipped++;
        this.logger.error(`Error building/sending weak-topic-analysis for user ${sub.userId}: ${e.message}`);
      }
      // Rate limit: Telegram bot API allows ~30 messages/sec. 35ms between
      // sends keeps us comfortably under that even with network jitter —
      // same constant already used by sendDailyPractice()/
      // broadcastAnnouncement() in telegram.service.ts, kept consistent here.
      await new Promise((r) => setTimeout(r, 35));
    }

    this.logger.log(`Daily weak-topic-analysis push done: ${sent} sent, ${skipped} skipped, ${subs.length} total eligible`);
    return { sent, skipped, total: subs.length };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`weak-topic-analysis job ${job.id} failed: ${err.message}`);
  }
}
