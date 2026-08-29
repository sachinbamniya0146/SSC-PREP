import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { MocksService } from './mocks.service';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('mocks')
@UseGuards(JwtAuthGuard)
export class MocksController {
  constructor(private readonly mocksService: MocksService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.mocksService.listAvailableMocks(user.userId);
  }

  // SECURITY FIX: this endpoint used to be callable by ANY logged-in user
  // and instantly granted paid mock access while fabricating a fake
  // "local-..." SUCCESS payment row — no PayU order, no payment
  // verification, nothing. Any student could POST here directly (devtools/
  // curl) and unlock every premium mock for free; the frontend's own
  // "Unlock" button on /mocks was silently relying on this hole instead of
  // the real, hash-verified PayU flow that /payments/order + /payments/verify
  // already implement for mockTemplateId purchases.
  //
  // This is now ADMIN-only (for manually comping access to a user), exactly
  // like /admin/users/:id/subscription/add. Real purchases MUST go through
  // /payments/order (PayU) -> PayU redirect -> /payments/verify, which is
  // what the frontend now calls (see premium/page.tsx & mocks/page.tsx).
  @Post('purchase')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  purchase(
    @Body() body: { userId: string; testTemplateId: string; priceInr?: number },
  ) {
    return this.mocksService.purchaseMockAccess(body.userId, body.testTemplateId, body.priceInr);
  }

  @Post('use')
  use(@CurrentUser() user: AuthenticatedUser, @Body() body: { testTemplateId: string }) {
    return this.mocksService.recordMockUse(user.userId, body.testTemplateId);
  }
}
