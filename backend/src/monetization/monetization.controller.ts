import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { MonetizationService } from './monetization.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

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
    @Body() body: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string },
  ) {
    return this.service.verifyPayment(user.userId, body);
  }
}
