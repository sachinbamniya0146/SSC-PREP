import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

// Requirement 3 — registers the daily 9 AM IST cron that enqueues the
// expiry-reminder fan-out job. The actual per-user work happens in
// ExpiryReminderWorker (workers/expiry-reminder.worker.ts); this class only
// owns the schedule itself. Mirrors WeakTopicAnalysisScheduler exactly,
// including the reasons documented there for using upsertJobScheduler()
// over the older `queue.add(name, data, { repeat })` API.
//
// Run at 9:00 AM IST rather than 9:00 PM (where the weak-topic-analysis push
// already sits) purely to keep the two daily sends from landing in the same
// minute — there's no functional dependency between them.
@Injectable()
export class ExpiryReminderScheduler implements OnModuleInit {
  private readonly logger = new Logger(ExpiryReminderScheduler.name);
  private static readonly SCHEDULER_ID = 'daily-expiry-reminder-9am-ist';

  constructor(@InjectQueue('telegram-expiry-reminder') private readonly queue: Queue) {}

  async onModuleInit() {
    try {
      await this.queue.upsertJobScheduler(
        ExpiryReminderScheduler.SCHEDULER_ID,
        {
          // Standard 5-field cron: minute hour day-of-month month day-of-week.
          // "0 9 * * *" = 09:00 every day, interpreted in the tz below.
          pattern: '0 9 * * *',
          tz: 'Asia/Kolkata',
        },
        {
          name: 'send-daily-expiry-reminder',
          data: {},
          opts: {
            removeOnComplete: { count: 20 },
            removeOnFail: { count: 50 },
          },
        },
      );
      this.logger.log(
        `Registered daily expiry-reminder schedule (9:00 AM Asia/Kolkata) as "${ExpiryReminderScheduler.SCHEDULER_ID}"`,
      );
    } catch (e: any) {
      // Non-fatal: if Redis is briefly unavailable at boot, log and move on
      // rather than crashing the whole app — the schedule can be
      // re-registered on the next restart, and this is a nice-to-have
      // notification feature, not core exam functionality.
      this.logger.error(`Failed to register expiry-reminder schedule: ${e.message}`);
    }
  }
}
