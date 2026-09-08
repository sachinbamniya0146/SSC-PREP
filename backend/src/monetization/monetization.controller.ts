import { Controller, Get, Post, Body, Req } from '@nestjs/common';
import type { Request } from 'express';
import { MonetizationService } from './monetization.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';

@Controller('payments')
export class MonetizationController {
  constructor(private service: MonetizationService) {}

  @Get('plans')
  listPlans() {
    return this.service.listPlans();
  }

  @Get('subscription')
  mySubscription(@CurrentUser() user: { userId: string }) {
    return this.service.mySubscription(user.userId);
  }

  @Get('chapters')
  myChapterPurchases(@CurrentUser() user: { userId: string }) {
    return this.service.myChapterPurchases(user.userId);
  }

  @Post('coupon/validate')
  validateCoupon(@Body() body: { code: string; amountInr: number }) {
    return this.service.validateCoupon(body.code, body.amountInr);
  }

  @Post('order')
  createOrder(
    @CurrentUser() user: { userId: string },
    @Body() body: { planId?: string; mockTemplateId?: string; chapterId?: string; couponCode?: string },
  ) {
    return this.service.createOrder(user.userId, body);
  }

  // Cashfree migration: the frontend now only ever needs to tell us WHICH
  // order to check — see monetization.service.ts verifyPayment() for why
  // (we ask Cashfree's server for the real status instead of trusting
  // anything the browser reports).
  @Post('verify')
  verifyPayment(
    @CurrentUser() user: { userId: string },
    @Body() body: { orderId: string },
  ) {
    return this.service.verifyPayment(user.userId, body);
  }

  // Auto-pay endpoints
  @Post('subscription/autopay/enable')
  enableAutoPay(
    @CurrentUser() user: { userId: string },
    @Body() body: { subscriptionId: string },
  ) {
    return this.service.enableAutoPay(user.userId, body.subscriptionId);
  }

  @Post('subscription/autopay/disable')
  disableAutoPay(
    @CurrentUser() user: { userId: string },
    @Body() body: { subscriptionId: string },
  ) {
    return this.service.disableAutoPay(user.userId, body.subscriptionId);
  }

  // Cashfree webhook (server-confirmed payments). Public — Cashfree calls
  // this directly, no user session — so it's authenticated purely by the
  // HMAC signature Cashfree signs every webhook with, verified in the
  // service. `req.rawBody` is the exact byte buffer captured by the global
  // body-parser `verify` hook in main.ts, which the signature MUST be
  // computed over (re-serializing the parsed JSON can reorder keys and
  // silently break the signature match).
  @Public()
  @Post('webhook')
  webhook(@Req() req: Request & { rawBody?: Buffer }) {
    return this.service.handleWebhook(
      req.rawBody || Buffer.from(JSON.stringify(req.body || {})),
      req.headers['x-webhook-signature'] as string | undefined,
      req.headers['x-webhook-timestamp'] as string | undefined,
      req.body,
    );
  }
}
