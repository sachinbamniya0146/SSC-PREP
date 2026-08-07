import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { MocksService } from './mocks.service';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('mocks')
@UseGuards(JwtAuthGuard)
export class MocksController {
  constructor(private readonly mocksService: MocksService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.mocksService.listAvailableMocks(user.userId);
  }

  @Post('purchase')
  purchase(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { testTemplateId: string; priceInr?: number },
  ) {
    return this.mocksService.purchaseMockAccess(user.userId, body.testTemplateId, body.priceInr);
  }

  @Post('use')
  use(@CurrentUser() user: AuthenticatedUser, @Body() body: { testTemplateId: string }) {
    return this.mocksService.recordMockUse(user.userId, body.testTemplateId);
  }
}
