import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

// Requirement 2 — registers the daily 9 PM IST cron that enqueues the
// weak-topic-analysis fan-out job. The actual per-user work happens in
// WeakTopicAnalysisWorker (workers/weak-topic-analysis.worker.ts); this
// class only owns the schedule itself.
//
// Uses upsertJobScheduler() (BullMQ 5.16+; this project is on 5.81, see
// package.json) rather than the older `queue.add(name, data, { repeat })`
// pattern — upsertJobScheduler is idempotent by scheduler id, so re-running
// this on every app restart/redeploy updates the existing schedule in place
// instead of accumulating duplicate repeatable jobs (a well-known footgun
// with the older repeat-option API, where every boot could silently add
// another copy of the same recurring job).
@Injectable()
export class WeakTopicAnalysisScheduler implements OnModuleInit {
  private readonly logger = new Logger(WeakTopicAnalysisScheduler.name);
  private static readonly SCHEDULER_ID = 'daily-weak-topic-analysis-9pm-ist';

  constructor(@InjectQueue('telegram-weak-topic-analysis') private readonly queue: Queue) {}

  async onModuleInit() {
    try {
      await this.queue.upsertJobScheduler(
        WeakTopicAnalysisScheduler.SCHEDULER_ID,
        {
          // Standard 5-field cron: minute hour day-of-month month day-of-week.
          // "0 21 * * *" = 21:00 every day, interpreted in the tz below.
          pattern: '0 21 * * *',
          tz: 'Asia/Kolkata',
        },
        {
          name: 'send-daily-weak-topic-analysis',
          data: {},
          opts: {
            removeOnComplete: { count: 20 },
            removeOnFail: { count: 50 },
          },
        },
      );
      this.logger.log(
        `Registered daily weak-topic-analysis schedule (9:00 PM Asia/Kolkata) as "${WeakTopicAnalysisScheduler.SCHEDULER_ID}"`,
      );
    } catch (e: any) {
      // Non-fatal: if Redis is briefly unavailable at boot, log and move on
      // rather than crashing the whole app — the schedule can be
      // re-registered on the next restart, and this is a nice-to-have
      // notification feature, not core exam functionality.
      this.logger.error(`Failed to register weak-topic-analysis schedule: ${e.message}`);
    }
  }
}
