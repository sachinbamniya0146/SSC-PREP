/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface TelegramWebhookUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
      language_code?: string;
    };
    chat: {
      id: number;
      type: string;
      title?: string;
      username?: string;
    };
    date: number;
    text?: string;
    entities?: Array<{ type: string; offset: number; length: number }>;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name: string; username?: string };
    message?: any;
    data?: string;
  };
}

export interface SendMessageParams {
  chat_id: number | string;
  text: string;
  parse_mode?: 'HTML' | 'Markdown';
  disable_web_page_preview?: boolean;
  reply_markup?: any;
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private botToken: string;
  private baseUrl: string;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private http: HttpService,
  ) {
    this.botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN') || '';
    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  async sendMessage(params: SendMessageParams) {
    if (!this.botToken) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not configured, skipping send');
      return { ok: false, error: 'Bot token not configured' };
    }
    try {
      const res = await firstValueFrom(
        this.http.post(`${this.baseUrl}/sendMessage`, params, { timeout: 10000 }),
      );
      return res.data;
    } catch (e: any) {
      this.logger.error(`Send message failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  async setWebhook(url: string, allowedUpdates?: string[]) {
    if (!this.botToken) return { ok: false, error: 'Bot token not configured' };
    try {
      const res = await firstValueFrom(
        this.http.post(`${this.baseUrl}/setWebhook`, { url, allowed_updates: allowedUpdates }, { timeout: 10000 }),
      );
      return res.data;
    } catch (e: any) {
      this.logger.error(`Set webhook failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  async getMe() {
    if (!this.botToken) return { ok: false, error: 'Bot token not configured' };
    try {
      const res = await firstValueFrom(this.http.get(`${this.baseUrl}/getMe`, { timeout: 5000 }));
      return res.data;
    } catch (e: any) {
      this.logger.error(`GetMe failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  // Register or link Telegram account to user
  async registerTelegramUser(data: {
    userId: string;      // Our internal user UUID
    chatId: number;      // Telegram chat_id
    username?: string;
    firstName?: string;
    lastName?: string;
    languageCode?: string;
  }) {
    return this.prisma.telegramUser.upsert({
      where: { userId: data.userId },
      create: {
        userId: data.userId,
        chatId: BigInt(data.chatId),
        username: data.username,
        firstName: data.firstName,
        lastName: data.lastName,
        languageCode: data.languageCode || 'en',
        isActive: true,
      },
      update: {
        chatId: BigInt(data.chatId),
        username: data.username,
        firstName: data.firstName,
        lastName: data.lastName,
        languageCode: data.languageCode || 'en',
        isActive: true,
        lastActiveAt: new Date(),
      },
    });
  }

  async getTelegramUserByChatId(chatId: number) {
    return this.prisma.telegramUser.findUnique({ where: { chatId: BigInt(chatId) } });
  }

  async getTelegramUserByUserId(userId: string) {
    return this.prisma.telegramUser.findUnique({ where: { userId } });
  }

  async subscribe(chatId: number, type: string) {
    const tgUser = await this.getTelegramUserByChatId(chatId);
    if (!tgUser) return { ok: false as const, error: 'Telegram user not linked' };
    await this.prisma.telegramSubscription.upsert({
      where: { chatId_type: { chatId: BigInt(chatId), type } },
      create: { userId: tgUser.userId, chatId: BigInt(chatId), type, isActive: true },
      update: { isActive: true },
    });
    return { ok: true as const };
  }

  async unsubscribe(chatId: number, type: string) {
    try {
      await this.prisma.telegramSubscription.update({
        where: { chatId_type: { chatId: BigInt(chatId), type } },
        data: { isActive: false },
      });
      return { ok: true as const };
    } catch {
      return { ok: false as const, error: 'Subscription not found' };
    }
  }

  async getSubscribers(type: string) {
    return this.prisma.telegramSubscription.findMany({
      where: { type, isActive: true },
      include: { user: true },
    });
  }

  // Send daily practice question to subscribed users
  async sendDailyPractice(question: {
    questionId: string;
    text: string;
    options: string[];
    correctOption: number;
    explanation?: string;
    explanationHindi?: string;
    subjectName?: string;
    chapterName?: string;
  }) {
    const subs = await this.getSubscribers('daily_practice');
    const text = this.formatDailyPracticeMessage(question);
    let sent = 0;
    for (const sub of subs) {
      const res = await this.sendMessage({ chat_id: Number(sub.chatId), text, parse_mode: 'HTML' });
      if (res.ok) sent++;
      else this.logger.warn(`Failed to send to ${sub.chatId}: ${res.error}`);
      // Rate limit: 30 messages/sec for bot
      await new Promise(r => setTimeout(r, 35));
    }
    return { sent, total: subs.length };
  }

  private formatDailyPracticeMessage(q: any) {
    const opts = q.options.map((o: string, i: number) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n');
    return `📝 <b>Daily Practice</b>

<b>${q.subjectName || 'Question'}</b> ${q.chapterName ? `– ${q.chapterName}` : ''}

${q.text}

${opts}

✅ <b>Answer:</b> ${String.fromCharCode(65 + q.correctOption)}
${q.explanation ? `\n📖 <i>${q.explanation}</i>` : ''}
${q.explanationHindi ? `\n🇮🇳 <i>${q.explanationHindi}</i>` : ''}

🔗 Practice more: <a href="https://sscprephub.in/question-bank/${q.id}">Open in app</a>`;
  }

  // Send mock test result
  async sendMockResult(chatId: number, result: {
    examName: string;
    score: number;
    total: number;
    rank?: number;
    percentile?: number;
    timeTaken: string;
  }) {
    const text = `📊 <b>Mock Test Result</b>

<b>${result.examName}</b>
Score: ${result.score}/${result.total}
${result.rank ? `Rank: ${result.rank}` : ''}
${result.percentile ? `Percentile: ${result.percentile}%` : ''}
Time: ${result.timeTaken}

🔗 View analysis: <a href="https://sscprephub.in/results/${result.examName.toLowerCase()}">Open in app</a>`;
    return this.sendMessage({ chat_id: chatId, text, parse_mode: 'HTML' });
  }

  // Send leaderboard update
  async sendLeaderboardUpdate(chatId: number, data: { rank: number; score: number; examName: string }) {
    const text = `🏆 <b>Leaderboard Update</b>

<b>${data.examName}</b>
Your rank: <b>#${data.rank}</b>
Score: ${data.score}

Keep practicing to climb higher! 🚀`;
    return this.sendMessage({ chat_id: chatId, text, parse_mode: 'HTML' });
  }

  // Broadcast announcement to all active users
  async broadcastAnnouncement(message: string) {
    const subs = await this.getSubscribers('announcements');
    let sent = 0;
    for (const sub of subs) {
      const res = await this.sendMessage({ chat_id: Number(sub.chatId), text: message, parse_mode: 'HTML' });
      if (res.ok) sent++;
      await new Promise(r => setTimeout(r, 35));
    }
    return { sent, total: subs.length };
  }
}