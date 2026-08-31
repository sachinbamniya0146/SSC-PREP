import { Controller, Post, Body, Get, Param, UseGuards, HttpCode, HttpStatus, Headers, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TelegramService, TelegramWebhookUpdate } from './telegram.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('Telegram')
@Controller('telegram')
@SkipThrottle()
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  // BUGFIX (bonus grep — the entire Telegram bot was unreachable):
  // JwtAuthGuard + RolesGuard are registered globally (see app.module.ts's
  // APP_GUARD providers) and apply to every route by default unless it
  // opts out with @Public(). This handler had no @Public() and no
  // @UseGuards() override, so every incoming update from Telegram's own
  // servers — /start, /link, /subscribe, button taps, everything — was
  // rejected with 401 Unauthorized before ever reaching this code, because
  // Telegram obviously has no JWT for this app. The bot could never work.
  //
  // Now public (required — Telegram can't send a bearer token), but
  // verified via the secret_token Telegram echoes back in the
  // X-Telegram-Bot-Api-Secret-Token header when TELEGRAM_WEBHOOK_SECRET is
  // configured (see telegram.service.ts setWebhook()/verifyWebhookSecret()),
  // so this being public doesn't mean "anyone can POST fake bot updates".
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() update: TelegramWebhookUpdate,
    @Headers('x-telegram-bot-api-secret-token') secretHeader?: string,
  ) {
    if (!this.telegram.verifyWebhookSecret(secretHeader)) {
      throw new UnauthorizedException('Invalid webhook secret');
    }
    if (!update.message && !update.callback_query) return { ok: true };
    
    const msg = update.message || update.callback_query?.message;
    if (!msg) return { ok: true };

    const chatId = msg.chat.id;
    const text = update.message?.text || update.callback_query?.data || '';

    // Handle /start command - link account
    if (text === '/start') {
      // Generate deep link or show instructions
      await this.telegram.sendMessage({
        chat_id: chatId,
        text: `👋 Welcome to SSC Prep Hub Bot!

🔒 <b>This bot is for Premium members only.</b>

To link your account:
1. Open <a href="https://sscprephub.in/settings/telegram">Telegram Settings</a> in the app (you need an active subscription)
2. Click "Generate Link Code"
3. Send the code here: <code>/link YOUR_CODE</code>

Available commands:
/report – Your progress right now (target, streak, weak topics)
/pdf ATTEMPT_ID – Get a test's result PDF (questions + your answers + explanations)
/subscribe daily_practice – Get daily question
/subscribe weak_topic_analysis – Daily personalized study nudge
/subscribe mock_results – Get mock test results
/subscribe leaderboard – Get rank updates
/subscribe announcements – Important updates
/unsubscribe <type> – Stop notifications
/help – Show this message`,
        parse_mode: 'HTML',
      });
      return { ok: true };
    }

    // Handle /link CODE
    if (text.startsWith('/link ')) {
      const code = text.split(' ')[1] || '';
      const result = await this.telegram.verifyAndConsumeLinkCode(code);
      if (!result.ok) {
        await this.telegram.sendMessage({
          chat_id: chatId,
          text: `❌ ${result.error}`,
        });
        return { ok: true };
      }

      await this.telegram.registerTelegramUser({
        userId: result.userId,
        chatId,
        username: update.message?.from?.username,
        firstName: update.message?.from?.first_name,
        languageCode: update.message?.from?.language_code,
      });

      await this.telegram.sendMessage({
        chat_id: chatId,
        text: `✅ <b>Account linked!</b>\n\nYou'll now get updates here. Subscribe to what you want:\n\n/subscribe daily_practice\n/subscribe mock_results\n/subscribe leaderboard\n/subscribe announcements\n\nWant your progress right now? Send /report anytime.`,
        parse_mode: 'HTML',
      });
      return { ok: true };
    }

    // Handle /report or /mystats — on-demand progress (Requirement 4)
    if (text === '/report' || text === '/mystats') {
      const tgUser = await this.telegram.getTelegramUserByChatId(chatId);
      if (!tgUser) {
        await this.telegram.sendMessage({
          chat_id: chatId,
          text: '❌ Your Telegram isn\'t linked yet. Send /start for instructions.',
        });
        return { ok: true };
      }
      const active = await this.telegram.hasActiveSubscription(tgUser.userId);
      if (!active) {
        await this.telegram.sendMessage({
          chat_id: chatId,
          text: '🔒 This feature is for premium members only. Renew here: https://sscprephub.in/premium',
        });
        return { ok: true };
      }
      await this.telegram.sendProgressReport(tgUser.userId, chatId);
      return { ok: true };
    }

    // Handle /pdf ATTEMPT_ID — on-demand attempt result PDF (Requirement 5).
    // Same "linked + premium" gate as /report above, so a stray /pdf from a
    // free or unlinked user fails fast with a clear message instead of
    // burning a Chromium render for nothing.
    if (text.startsWith('/pdf')) {
      const tgUser = await this.telegram.getTelegramUserByChatId(chatId);
      if (!tgUser) {
        await this.telegram.sendMessage({
          chat_id: chatId,
          text: '❌ Your Telegram isn\'t linked yet. Send /start for instructions.',
        });
        return { ok: true };
      }
      const active = await this.telegram.hasActiveSubscription(tgUser.userId);
      if (!active) {
        await this.telegram.sendMessage({
          chat_id: chatId,
          text: '🔒 This feature is for premium members only. Renew here: https://sscprephub.in/premium',
        });
        return { ok: true };
      }
      const attemptId = text.split(' ')[1] || '';
      if (!attemptId) {
        await this.telegram.sendMessage({
          chat_id: chatId,
          text: '❌ Usage: /pdf ATTEMPT_ID — find the attempt id on your results page (Open in app link on any test result).',
        });
        return { ok: true };
      }
      try {
        const res = await this.telegram.sendAttemptPdf(tgUser.userId, chatId, attemptId);
        if (!res.ok) {
          await this.telegram.sendMessage({ chat_id: chatId, text: `❌ ${res.error || 'Could not generate that PDF.'}` });
        }
      } catch {
        await this.telegram.sendMessage({
          chat_id: chatId,
          text: '❌ Attempt not found, or it isn\'t yours.',
        });
      }
      return { ok: true };
    }

    // Handle /subscribe TYPE
    if (text.startsWith('/subscribe ')) {
      const type = text.split(' ')[1];
      const validTypes = ['daily_practice', 'mock_results', 'leaderboard', 'announcements', 'weak_topic_analysis'];
      if (!validTypes.includes(type)) {
        await this.telegram.sendMessage({
          chat_id: chatId,
          text: `❌ Invalid type. Valid: ${validTypes.join(', ')}`,
        });
        return { ok: true };
      }
      const res = await this.telegram.subscribe(chatId, type);
      await this.telegram.sendMessage({
        chat_id: chatId,
        text: res.ok ? `✅ Subscribed to <b>${type}</b>` : `❌ ${res.error}`,
        parse_mode: 'HTML',
      });
      return { ok: true };
    }

    // Handle /unsubscribe TYPE
    if (text.startsWith('/unsubscribe ')) {
      const type = text.split(' ')[1];
      const res = await this.telegram.unsubscribe(chatId, type);
      await this.telegram.sendMessage({
        chat_id: chatId,
        text: res.ok ? `🔕 Unsubscribed from <b>${type}</b>` : `❌ ${res.error}`,
        parse_mode: 'HTML',
      });
      return { ok: true };
    }

    // Handle /help
    if (text === '/help') {
      await this.telegram.sendMessage({
        chat_id: chatId,
        text: `🤖 <b>SSC Prep Hub Bot Commands</b>

/start – Welcome & link instructions
/link <code>CODE</code> – Link your account (Premium only)
/report – Your progress right now
/pdf <code>ATTEMPT_ID</code> – Result PDF for a submitted test
/subscribe <type> – Subscribe to notifications
/unsubscribe <type> – Unsubscribe

<b>Subscription types:</b>
• daily_practice – Daily question
• weak_topic_analysis – Daily personalized study nudge
• mock_results – Mock test results
• leaderboard – Rank updates
• announcements – Important news`,
        parse_mode: 'HTML',
      });
      return { ok: true };
    }

    return { ok: true };
  }

  // Admin: Get bot info
  @Get('bot/info')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get bot info (admin)' })
  async getBotInfo() {
    return this.telegram.getMe();
  }

  // Admin: Set webhook
  @Post('bot/webhook')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set webhook URL (admin)' })
  async setWebhook(@Body() body: { url: string; allowedUpdates?: string[] }) {
    return this.telegram.setWebhook(body.url, body.allowedUpdates);
  }

  // User: Generate a link code from the app (Requirement 1 — settings page
  // "Generate Link Code" button posts here). Premium-gated inside the
  // service: free users get a clear ok:false + message instead of a code.
  @Post('link/generate-code')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate a short-lived Telegram link code (Premium only)' })
  async generateLinkCode(@CurrentUser() user: { sub: string }) {
    return this.telegram.generateLinkCode(user.sub);
  }

  // User: Link Telegram account
  //
  // BUGFIX (bonus grep — this session's audit): every other Telegram
  // premium-feature entry point (generateLinkCode, verifyAndConsumeLinkCode,
  // /report, /pdf, subscribe, unsubscribe) checks hasActiveSubscription()
  // before doing anything. This direct chatId-link endpoint was the one
  // place that didn't — any authenticated FREE user could POST here and
  // register a TelegramUser row for themselves, completely bypassing the
  // "Telegram bot access is a premium feature" gate enforced everywhere
  // else. Added the same check + the same error message used at
  // generateLinkCode() so behavior is consistent across every entry point.
  @Post('link')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Link Telegram account (Premium only)' })
  async linkAccount(
    @CurrentUser() user: { sub: string },
    @Body() body: { chatId: number; username?: string; firstName?: string; lastName?: string; languageCode?: string },
  ) {
    const active = await this.telegram.hasActiveSubscription(user.sub);
    if (!active) {
      return { ok: false, error: 'Telegram bot access is a premium feature. Please subscribe first.' };
    }
    return this.telegram.registerTelegramUser({
      userId: user.sub,
      chatId: body.chatId,
      username: body.username,
      firstName: body.firstName,
      lastName: body.lastName,
      languageCode: body.languageCode,
    });
  }

  // User: Get linked Telegram account
  @Get('account')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get linked Telegram account' })
  async getAccount(@CurrentUser() user: { sub: string }) {
    return this.telegram.getTelegramUserByUserId(user.sub);
  }

  // User: Subscribe
  @Post('subscribe/:type')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Subscribe to notifications' })
  async subscribe(
    @CurrentUser() user: { sub: string },
    @Param('type') type: string,
  ) {
    const tgUser = await this.telegram.getTelegramUserByUserId(user.sub);
    if (!tgUser) return { ok: false, error: 'Telegram not linked' };
    return this.telegram.subscribe(Number(tgUser.chatId), type);
  }

  // User: Unsubscribe
  @Post('unsubscribe/:type')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unsubscribe from notifications' })
  async unsubscribe(
    @CurrentUser() user: { sub: string },
    @Param('type') type: string,
  ) {
    const tgUser = await this.telegram.getTelegramUserByUserId(user.sub);
    if (!tgUser) return { ok: false, error: 'Telegram not linked' };
    return this.telegram.unsubscribe(Number(tgUser.chatId), type);
  }

  // Admin: Broadcast announcement
  @Post('broadcast')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Broadcast announcement (admin)' })
  async broadcast(@Body() body: { message: string }) {
    return this.telegram.broadcastAnnouncement(body.message);
  }

  // Admin: Send daily practice manually
  @Post('send/daily-practice')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send daily practice to all subscribers (admin)' })
  async sendDailyPractice(@Body() body: {
    questionId: string;
    text: string;
    options: string[];
    correctOption: number;
    explanation?: string;
    explanationHindi?: string;
    subjectName?: string;
    chapterName?: string;
  }) {
    return this.telegram.sendDailyPractice(body);
  }
}
