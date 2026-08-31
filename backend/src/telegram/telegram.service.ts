/* eslint-disable @typescript-eslint/no-explicit-any */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import * as crypto from 'crypto';
import { TestsService } from '../tests/tests.service';
import { StudyPlanService } from '../study-plan/study-plan.service';
import { PdfRenderer } from '../pdf-export/pdf-renderer';
import { buildAttemptResultHtml, PdfAttemptMeta, PdfAttemptQuestion } from '../pdf-export/pdf-templates';

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

// Requirement 1 — link-code TTL. Short-lived on purpose: this code is shown
// once on the settings page and typed into Telegram within a couple of
// minutes in the normal flow: 10 minutes gives real headroom without
// leaving stale codes usable for long if someone screenshots one.
const LINK_CODE_TTL_SECONDS = 10 * 60;
const LINK_CODE_REDIS_PREFIX = 'telegram:link:';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private botToken: string;
  private baseUrl: string;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private http: HttpService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    // Requirement 5, part (a): TestsService now ALSO injects TelegramService
    // (see tests.service.ts's submitAttempt() → notifyTelegramAttemptPdf()),
    // so this is a true two-way provider cycle, not just a module cycle.
    // forwardRef() is needed on BOTH constructor injections — this one AND
    // tests.service.ts's @Inject(forwardRef(() => TelegramService)) — since
    // both providers reference each other directly; wrapping only one side
    // still fails to resolve at boot.
    @Inject(forwardRef(() => TestsService))
    private tests: TestsService,
    private studyPlan: StudyPlanService,
    private pdfRenderer: PdfRenderer,
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

  /**
   * Send a file (PDF, etc.) via Telegram's sendDocument API — used for
   * Requirement 5 (attempt PDF: questions + your answers + correct answers +
   * explanation). Mirrors sendMessage()'s shape/error-handling but posts
   * multipart form-data since Telegram's sendDocument needs the actual file
   * bytes, not JSON.
   */
  async sendDocument(params: {
    chat_id: number | string;
    document: Buffer;
    filename: string;
    caption?: string;
    parse_mode?: 'HTML' | 'Markdown';
  }) {
    if (!this.botToken) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not configured, skipping sendDocument');
      return { ok: false, error: 'Bot token not configured' };
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const FormData = require('form-data');
      const form = new FormData();
      form.append('chat_id', String(params.chat_id));
      if (params.caption) form.append('caption', params.caption);
      if (params.parse_mode) form.append('parse_mode', params.parse_mode);
      form.append('document', params.document, { filename: params.filename, contentType: 'application/pdf' });

      const res = await firstValueFrom(
        this.http.post(`${this.baseUrl}/sendDocument`, form, {
          headers: form.getHeaders(),
          timeout: 30000,
          maxBodyLength: 25 * 1024 * 1024, // Telegram's own bot-API document limit is 50MB; 25MB is a safe generous cap for an exam-paper PDF
          maxContentLength: 25 * 1024 * 1024,
        }),
      );
      return res.data;
    } catch (e: any) {
      this.logger.error(`Send document failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  /**
   * Build the same progress-report text used both by the on-demand
   * /report command (Requirement 4) and the daily weak-topic-analysis push
   * (Requirement 2) — one shared builder so the two never drift apart.
   */
  async buildProgressReportText(userId: string): Promise<string> {
    const [target, weakChapters] = await Promise.all([
      this.studyPlan.getDailyTarget(userId),
      this.tests.getWeakChapters(userId),
    ]);

    const lines: string[] = ['📊 <b>Your Progress Report</b>', ''];

    if (target.hasPlan) {
      lines.push(`🎯 Aaj ka target: <b>${target.todayDone}/${target.dailyTarget}</b> questions (${target.remaining} baaki)`);
      lines.push(`🔥 Streak: <b>${target.streak} din</b>`);
    } else {
      lines.push(`🎯 Koi study plan set nahi hai. Dashboard se ek banayein: <a href="https://sscprephub.in/dashboard">Open app</a>`);
    }

    if (weakChapters.length > 0) {
      const weakest = weakChapters[0];
      lines.push('');
      lines.push(`📉 Sabse kamzor topic: <b>${weakest.chapterName}</b> (${weakest.subject}) — accuracy <b>${weakest.accuracy}%</b>`);
      lines.push(`🔗 Abhi practice karein: <a href="https://sscprephub.in/question-bank?chapterId=${weakest.chapterId}">Open app</a>`);
    } else {
      lines.push('');
      lines.push('📉 Weak topics dekhne ke liye pehle kam se kam ek mock/sectional test submit karein.');
    }

    // Most recent submitted attempt, if any — score/rank/percentile.
    const recentAttempt = await this.prisma.testAttempt.findFirst({
      where: { userId, status: 'SUBMITTED' },
      orderBy: { submittedAt: 'desc' },
      select: { id: true },
    });
    if (recentAttempt) {
      const detail = await this.tests.attemptDetail(userId, recentAttempt.id);
      lines.push('');
      lines.push(`📝 Last test: Score <b>${detail.score}</b> | Rank <b>#${detail.rank}</b> | Percentile <b>${detail.percentile}%</b>`);
    }

    return lines.join('\n');
  }

  /**
   * On-demand /report — sends the report right now, no cron wait. Caller
   * (telegram.controller.ts) has already checked hasActiveSubscription()
   * before calling this.
   */
  async sendProgressReport(userId: string, chatId: number) {
    const text = await this.buildProgressReportText(userId);
    return this.sendMessage({ chat_id: chatId, text, parse_mode: 'HTML' });
  }

  // ---- Requirement 5: attempt PDF (questions + your answer + correct
  // answer + explanation), sent to Telegram ----

  /**
   * Build the PDF for one submitted attempt and send it via sendDocument().
   * Callers must have already checked hasActiveSubscription() + that the
   * user is Telegram-linked — same "subscription-active + linked" gate
   * used everywhere else in this file — so this method itself stays a pure
   * "given a userId+chatId+attemptId, build and send" step with no
   * premium/link checks of its own, kept consistent with sendProgressReport()
   * above.
   *
   * Reuses tests.service.ts's attemptDetail() (v6 §6 — the same data source
   * the results/review screen uses) for the per-question
   * selectedOption/correctAnswer/isCorrect/explanation shape, and
   * pdf-export's PdfRenderer + pdf-templates.ts's buildAttemptResultHtml()
   * (Session 11 addition) for rendering — per the spec's "don't build a new
   * renderer" instruction, only a new template function was added.
   */
  async sendAttemptPdf(userId: string, chatId: number, attemptId: string) {
    const [detail, user] = await Promise.all([
      this.tests.attemptDetail(userId, attemptId), // throws BadRequestException if not found/not this user's
      this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }),
    ]);

    if (detail.status !== 'SUBMITTED') {
      return { ok: false, error: 'This attempt has not been submitted yet — the result PDF is only available after you finish and submit.' };
    }

    const questions: PdfAttemptQuestion[] = detail.questions.map((q: any) => ({
      id: q.questionId,
      q: q.questionText,
      qh: q.questionTextHindi || q.questionText,
      options: q.options,
      selectedOption: q.selectedOption,
      correctAnswer: q.correctAnswer,
      isCorrect: q.isCorrect,
      isSkipped: q.isSkipped,
      explanation: q.explanation || '',
      explanationHindi: q.explanationHindi || '',
      chapter: q.chapter || '',
      examName: q.examName || '',
      year: q.year,
      shift: q.shift,
      marks: q.marks ?? 2,
      negativeMarks: q.negativeMarks ?? 0.5,
    }));

    const examLabel = `${questions[0]?.examName ?? ''}${questions[0]?.year ? ' ' + questions[0].year : ''}`.trim();
    const submittedAt = detail.submittedAt
      ? new Intl.DateTimeFormat('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }).format(new Date(detail.submittedAt))
      : '';

    const meta: PdfAttemptMeta = {
      title: detail.testTemplate?.title || 'Test Result',
      examLabel: examLabel || detail.testTemplate?.title || '',
      studentName: user?.fullName || 'Student',
      score: detail.score,
      totalMarks: detail.testTemplate?.totalMarks ?? 0,
      correctCount: detail.totalCorrect,
      wrongCount: detail.totalWrong,
      skippedCount: detail.totalSkipped,
      rank: detail.rank ?? null,
      percentile: detail.percentile ?? null,
      submittedAt,
    };

    const html = buildAttemptResultHtml(meta, questions);
    const pdfBuffer = await this.pdfRenderer.htmlToPdf(html);

    return this.sendDocument({
      chat_id: chatId,
      document: pdfBuffer,
      filename: `attempt-result-${attemptId}.pdf`,
      caption: `📄 <b>${meta.title}</b> — Score ${meta.score}/${meta.totalMarks}`,
      parse_mode: 'HTML',
    });
  }

  async setWebhook(url: string, allowedUpdates?: string[]) {
    if (!this.botToken) return { ok: false, error: 'Bot token not configured' };
    try {
      // BUGFIX (bonus grep — "site work karna chahiye", Telegram bot was
      // 100% dead): pairs with the @Public() + secret-token check added in
      // telegram.controller.ts. Telegram's own docs recommend setting a
      // secret_token on setWebhook so Telegram echoes it back on every
      // update via the X-Telegram-Bot-Api-Secret-Token header — this lets
      // the now-public webhook route reject spoofed POSTs from anyone who
      // isn't actually Telegram, without needing this app's own JWT auth
      // (which Telegram's servers can never provide).
      const secret = this.config.get<string>('TELEGRAM_WEBHOOK_SECRET') || '';
      const res = await firstValueFrom(
        this.http.post(
          `${this.baseUrl}/setWebhook`,
          { url, allowed_updates: allowedUpdates, ...(secret ? { secret_token: secret } : {}) },
          { timeout: 10000 },
        ),
      );
      return res.data;
    } catch (e: any) {
      this.logger.error(`Set webhook failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  /** True if no TELEGRAM_WEBHOOK_SECRET is configured (nothing to check —
   * back-compat for setups that haven't set it), or the header Telegram
   * sent matches it. */
  verifyWebhookSecret(headerValue: string | undefined): boolean {
    const secret = this.config.get<string>('TELEGRAM_WEBHOOK_SECRET') || '';
    if (!secret) return true;
    return headerValue === secret;
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

  // ---- Requirement 1: premium-only link-code flow ----

  /**
   * True if this user currently has an ACTIVE subscription that hasn't
   * expired yet. This is the single gate every Telegram feature in this
   * service must pass before linking, subscribing, or sending anything —
   * per the spec's "check subscription-active before every message" rule.
   */
  async hasActiveSubscription(userId: string): Promise<boolean> {
    const sub = await this.prisma.subscription.findFirst({
      where: { userId, status: 'ACTIVE', endsAt: { gt: new Date() } },
    });
    return !!sub;
  }

  /**
   * Generate a short-lived link code for the "Generate Link Code" button on
   * /settings/telegram. Stored in Redis (not Postgres) since it's
   * intentionally ephemeral, single-use, and never needs to survive a
   * restart. Only issued to users who already have an active subscription —
   * free users are told to subscribe first instead of getting a code that
   * would just fail at /link time anyway.
   */
  async generateLinkCode(userId: string): Promise<{ ok: true; code: string; expiresInSeconds: number } | { ok: false; error: string }> {
    const active = await this.hasActiveSubscription(userId);
    if (!active) {
      return { ok: false, error: 'Telegram bot access is a premium feature. Please subscribe first.' };
    }

    // 6-character uppercase alphanumeric, collision-checked against Redis.
    // Small keyspace (36^6) but codes are single-use + 10-minute TTL, so
    // this is plenty for a link flow (not a long-lived secret).
    let code = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      code = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
      const exists = await this.redis.get(`${LINK_CODE_REDIS_PREFIX}${code}`);
      if (!exists) break;
    }

    await this.redis.set(`${LINK_CODE_REDIS_PREFIX}${code}`, userId, 'EX', LINK_CODE_TTL_SECONDS);
    return { ok: true, code, expiresInSeconds: LINK_CODE_TTL_SECONDS };
  }

  /**
   * Verify + consume a /link CODE sent from the bot. Single-use: the Redis
   * key is deleted immediately on a successful read so the same code can't
   * be replayed by someone who saw it. Re-checks the subscription at
   * verification time too (not just at generation time) — a code could sit
   * unused for up to 10 minutes, and while that's a short window, the
   * requirement is "no free user ever ends up linked", so this belt-and-
   * braces check costs nothing and closes that edge case fully.
   */
  async verifyAndConsumeLinkCode(code: string): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
    const key = `${LINK_CODE_REDIS_PREFIX}${code.toUpperCase().trim()}`;
    const userId = await this.redis.get(key);
    if (!userId) {
      return { ok: false, error: 'This code is invalid or has expired. Generate a new one from Telegram Settings in the app.' };
    }
    await this.redis.del(key); // single-use — burn it whether or not the rest of this call succeeds

    const active = await this.hasActiveSubscription(userId);
    if (!active) {
      return { ok: false, error: 'This feature is for premium members only. Please subscribe first, then generate a new code.' };
    }
    return { ok: true, userId };
  }

  async getTelegramUserByChatId(chatId: number) {
    return this.prisma.telegramUser.findUnique({ where: { chatId: BigInt(chatId) } });
  }

  async getTelegramUserByUserId(userId: string) {
    return this.prisma.telegramUser.findUnique({ where: { userId }, include: { subscriptions: true } });
  }

  async subscribe(chatId: number, type: string) {
    const tgUser = await this.getTelegramUserByChatId(chatId);
    if (!tgUser) return { ok: false as const, error: 'Telegram user not linked' };
    // Even a previously-linked user shouldn't be able to (re)subscribe once
    // their premium has lapsed — mirrors the same gate used at link-time.
    const active = await this.hasActiveSubscription(tgUser.userId);
    if (!active) {
      return { ok: false as const, error: 'This feature is for premium members only. Please renew your subscription.' };
    }
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
    // CRITICAL (Requirement 3): never surface an expired-premium user as a
    // "subscriber" to any send path. isActive on TelegramSubscription only
    // tracks opt-in/opt-out — it says nothing about whether the person is
    // still paying, so every caller of getSubscribers() (daily practice,
    // announcements, and the new daily-analysis/expiry-reminder jobs) must
    // go through this same subscription-active filter, not roll their own.
    const subs = await this.prisma.telegramSubscription.findMany({
      where: { type, isActive: true },
      include: { user: true },
    });
    if (subs.length === 0) return [];

    const userIds = subs.map((s) => s.userId);
    const activeSubs = await this.prisma.subscription.findMany({
      where: { userId: { in: userIds }, status: 'ACTIVE', endsAt: { gt: new Date() } },
      select: { userId: true },
    });
    const activeUserIds = new Set(activeSubs.map((s) => s.userId));
    return subs.filter((s) => activeUserIds.has(s.userId));
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

  // ---- Requirement 3: expiry-reminder (3 days before, roz, expiry ke turant baad band) ----

  /**
   * Users whose Subscription is still ACTIVE and expiring within the next
   * `withinDays` days — AND who are Telegram-linked (a TelegramUser row
   * exists for them). This is intentionally NOT getSubscribers(): that
   * method targets a specific opt-in `type` (daily_practice,
   * weak_topic_analysis, ...), while this targets "everyone whose premium
   * is about to lapse" regardless of what they've opted into — a different
   * audience with a different, billing-critical purpose. So the
   * `status === 'ACTIVE' && endsAt > now` check is re-applied here
   * explicitly rather than delegated to getSubscribers()'s internal filter.
   * The moment endsAt passes, the next day's cron run naturally excludes
   * that user — the query condition itself does that, no extra cleanup
   * needed.
   */
  async getExpiringSubscribers(withinDays = 3): Promise<Array<{ userId: string; chatId: bigint; planName: string; endsAt: Date }>> {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);
    const subs = await this.prisma.subscription.findMany({
      where: { status: 'ACTIVE', endsAt: { gt: now, lte: windowEnd } },
      include: { plan: true },
    });
    if (subs.length === 0) return [];

    const userIds = subs.map((s) => s.userId);
    // isActive here means "this Telegram link itself hasn't been
    // deactivated" (set on registerTelegramUser) — a separate concern from
    // premium-active, which is already enforced by the query above.
    const tgUsers = await this.prisma.telegramUser.findMany({
      where: { userId: { in: userIds }, isActive: true },
    });
    const tgByUserId = new Map(tgUsers.map((t) => [t.userId, t]));

    return subs
      .filter((s) => tgByUserId.has(s.userId))
      .map((s) => ({
        userId: s.userId,
        chatId: tgByUserId.get(s.userId)!.chatId,
        planName: s.plan.name,
        endsAt: s.endsAt,
      }));
  }

  /**
   * Guards against sending the same user more than one expiry reminder on
   * the same (IST) calendar day. A daily cron only fires once a day anyway,
   * but a BullMQ retry after a partial failure could re-run the job — this
   * makes a re-run idempotent per user/day instead of double-messaging.
   * Returns true the first time it's called for a given user+day (i.e. "go
   * ahead and send"), false on every subsequent call for that same day
   * (i.e. "already sent, skip").
   */
  async claimExpiryReminderSlot(userId: string): Promise<boolean> {
    // en-CA locale formats as YYYY-MM-DD, which is exactly the IST calendar
    // date we want without doing manual UTC-offset arithmetic.
    const istDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const key = `telegram:expiry-reminder-sent:${userId}:${istDate}`;
    // NX = only set if this key doesn't already exist (atomic claim). EX =
    // 26h TTL — comfortably past one calendar day so the key is always gone
    // well before the same date could ever recur, no separate cleanup job
    // needed.
    const result = await this.redis.set(key, '1', 'EX', 26 * 60 * 60, 'NX');
    return result === 'OK';
  }

  /** Message text for the expiry reminder — kept separate from
   * buildProgressReportText() since this is a billing notice, not a
   * progress/study nudge, and has its own tone + CTA. */
  buildExpiryReminderText(planName: string, endsAt: Date): string {
    const daysLeft = Math.max(1, Math.ceil((endsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
    const dateStr = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(endsAt);

    return `⏰ <b>Subscription Expiring Soon</b>

Aapka <b>${planName}</b> plan <b>${daysLeft} din</b> mein khatam ho raha hai (${dateStr}).

Bina rukawat access jaari rakhne ke liye abhi renew karein: <a href="https://sscprephub.in/subscription">Renew now</a>`;
  }
}
