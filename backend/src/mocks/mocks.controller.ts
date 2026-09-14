import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
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
  list(@CurrentUser() user: AuthenticatedUser, @Query('examId') examId?: string) {
    return this.mocksService.listAvailableMocks(user.userId, examId);
  }

  // SECURITY FIX: this endpoint used to be callable by ANY logged-in user
  // and instantly granted paid mock access while fabricating a fake
  // "local-..." SUCCESS payment row — no real gateway order, no payment
  // verification, nothing. Any student could POST here directly (devtools/
  // curl) and unlock every premium mock for free; the frontend's own
  // "Unlock" button on /mocks was silently relying on this hole instead of
  // the real, hash-verified Cashfree flow that /payments/order + /payments/verify
  // already implement for mockTemplateId purchases.
  //
  // This is now ADMIN-only (for manually comping access to a user), exactly
  // like /admin/users/:id/subscription/add. Real purchases MUST go through
  // /payments/order (Cashfree) -> Cashfree hosted checkout -> /payments/verify
  // (webhook + browser-return, both handled by monetization.service.ts#fulfill()),
  // which is what the frontend now calls (see premium/page.tsx & mocks/page.tsx).
  //
  // BUGFIX (Sep 2026 — "revenue dashboard mein Cashfree ke alawa kuch aur
  // count toh nahi ho raha" audit): this admin-comp path writes a `Payment`
  // row with status SUCCESS so mockAccess history/receipts still look
  // normal to the user — but that meant every free comp an admin granted
  // was ALSO getting summed into admin.service.ts's revenue dashboard
  // (`payment.aggregate`/`groupBy` there only filtered on `status:
  // 'SUCCESS'`, with nothing distinguishing a real Cashfree payment from a
  // ₹0-actually-collected admin freebie) — silently inflating "revenue"
  // by however much comp'd access was handed out. Two changes close that:
  // 1) this now records WHICH admin granted it (metadataJson.kind:
  //    'ADMIN_COMP' + grantedByAdminId) instead of just a bare
  //    unverifiable "local-..." order id, and
  // 2) admin.service.ts#getDashboardStats() now explicitly excludes
  //    metadataJson.kind === 'ADMIN_COMP' rows from both revenue sums —
  //    see the doc-comment there.
  @Post('purchase')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  purchase(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() body: { userId: string; testTemplateId: string; priceInr?: number },
  ) {
    return this.mocksService.purchaseMockAccess(body.userId, body.testTemplateId, body.priceInr, admin.userId);
  }

  @Post('use')
  use(@CurrentUser() user: AuthenticatedUser, @Body() body: { testTemplateId: string }) {
    return this.mocksService.recordMockUse(user.userId, body.testTemplateId);
  }
}
