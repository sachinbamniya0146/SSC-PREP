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

  @Post('verify')
  verifyPayment(
    @CurrentUser() user: { userId: string },
    @Body() body: { 
      txnid: string; 
      payuPaymentId: string; 
      hash: string;
      status: string;
      amount: string;
      productinfo: string;
      firstname: string;
      email: string;
      udf1: string;
      udf2: string;
      udf3: string;
      udf4: string;
      udf5: string;
    },
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

  // PayU webhook (server-confirmed payments)
  @Public()
  @Post('webhook')
  webhook(@Req() req: Request) {
    return this.service.handleWebhook(req.body);
  }
}
