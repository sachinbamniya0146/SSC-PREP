import { Controller, Post, Body, Get, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TelegramService, TelegramWebhookUpdate } from './telegram.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('Telegram')
@Controller('telegram')
@SkipThrottle()
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  // Public webhook endpoint (no auth)
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Body() update: TelegramWebhookUpdate) {
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

To link your account:
1. Open <a href="https://sscprephub.in/settings/telegram">Telegram Settings</a> in the app
2. Click "Generate Link Code"
3. Send the code here: <code>/link YOUR_CODE</code>

Or if you already have a code, send: <code>/link YOUR_CODE</code>

Available commands:
/subscribe daily_practice – Get daily question
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
      const code = text.split(' ')[1];
      // TODO: Validate code and link account
      await this.telegram.sendMessage({
        chat_id: chatId,
        text: `🔗 Linking with code: <code>${code}</code>\n\nFeature coming soon!`,
        parse_mode: 'HTML',
      });
      return { ok: true };
    }

    // Handle /subscribe TYPE
    if (text.startsWith('/subscribe ')) {
      const type = text.split(' ')[1];
      const validTypes = ['daily_practice', 'mock_results', 'leaderboard', 'announcements'];
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
/link <code>CODE</code> – Link your account
/subscribe <type> – Subscribe to notifications
/unsubscribe <type> – Unsubscribe

<b>Subscription types:</b>
• daily_practice – Daily question
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

  // User: Link Telegram account
  @Post('link')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Link Telegram account' })
  async linkAccount(
    @CurrentUser() user: { sub: string },
    @Body() body: { chatId: number; username?: string; firstName?: string; lastName?: string; languageCode?: string },
  ) {
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