import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { SubscribeDto, BroadcastDto } from './dto/push.dto';

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly enabled: boolean;

  constructor(private prisma: PrismaService) {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || 'mailto:admin@sscprephub.com';

    this.enabled = Boolean(publicKey && privateKey);
    if (this.enabled) {
      webpush.setVapidDetails(subject, publicKey as string, privateKey as string);
    } else {
      // Not fatal — the rest of the app must keep working even if push was
      // never configured (matches how TelegramService degrades gracefully
      // when TELEGRAM_BOT_TOKEN is missing, see telegram.service.ts).
      this.logger.warn(
        'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — push notifications are disabled. ' +
          'Generate a pair with `npx web-push generate-vapid-keys` and set both env vars.',
      );
    }
  }

  async subscribe(userId: string, dto: SubscribeDto, userAgent?: string) {
    return this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      update: { userId, p256dh: dto.keys.p256dh, auth: dto.keys.auth, userAgent },
      create: {
        userId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userAgent,
      },
    });
  }

  async unsubscribe(endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint } });
    return { ok: true };
  }

  /**
   * Sends one notification to every subscribed device across every
   * STUDENT. Runs sends in parallel and prunes subscriptions the push
   * service reports as gone (410/404 — user uninstalled, cleared site
   * data, etc.) so the table doesn't grow stale forever.
   */
  async broadcastToAllStudents(dto: BroadcastDto) {
    if (!this.enabled) {
      return { sent: 0, failed: 0, disabled: true };
    }

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { user: { role: 'STUDENT' } },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });

    const payload = JSON.stringify({
      title: dto.title,
      body: dto.body,
      url: dto.url || '/dashboard',
    });

    let sent = 0;
    let failed = 0;
    const deadIds: string[] = [];

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload,
          );
          sent += 1;
        } catch (err) {
          failed += 1;
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            deadIds.push(sub.id);
          } else {
            this.logger.warn(`Push send failed for subscription ${sub.id}: ${err}`);
          }
        }
      }),
    );

    if (deadIds.length) {
      await this.prisma.pushSubscription.deleteMany({ where: { id: { in: deadIds } } });
    }

    return { sent, failed, total: subscriptions.length };
  }

  /**
   * Sends one notification to every subscribed device of every ADMIN /
   * MODERATOR. Used for "a student just reported a question error" so staff
   * find out without having to keep /admin/error-reports open. Never throws —
   * a push failure must not break the action that triggered it.
   */
  async notifyStaff(dto: BroadcastDto) {
    if (!this.enabled) {
      return { sent: 0, failed: 0, disabled: true };
    }
    try {
      const subscriptions = await this.prisma.pushSubscription.findMany({
        where: { user: { role: { in: ['ADMIN', 'MODERATOR'] } } },
        select: { id: true, endpoint: true, p256dh: true, auth: true },
      });
      const payload = JSON.stringify({
        title: dto.title,
        body: dto.body,
        url: dto.url || '/admin',
      });
      let sent = 0;
      let failed = 0;
      const deadIds: string[] = [];
      await Promise.all(
        subscriptions.map(async (sub) => {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              payload,
            );
            sent += 1;
          } catch (err) {
            failed += 1;
            const statusCode = (err as { statusCode?: number }).statusCode;
            if (statusCode === 404 || statusCode === 410) {
              deadIds.push(sub.id);
            } else {
              this.logger.warn(`Staff push failed for subscription ${sub.id}: ${err}`);
            }
          }
        }),
      );
      if (deadIds.length) {
        await this.prisma.pushSubscription.deleteMany({ where: { id: { in: deadIds } } });
      }
      return { sent, failed, total: subscriptions.length };
    } catch (err) {
      this.logger.warn(`notifyStaff failed: ${err}`);
      return { sent: 0, failed: 0, error: true };
    }
  }
}
