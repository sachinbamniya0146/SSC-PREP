import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Department } from '../common/decorators/department.decorator';
import { TestReserveService } from './test-reserve.service';

/** Admin: how many practice questions are shown to students and how many are kept for tests. */
@Controller('bank/admin/test-reserve')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MODERATOR')
@Department('QUESTIONS', 'PRACTICE')
export class TestReserveController {
  constructor(private readonly reserve: TestReserveService) {}

  @Get()
  stats() {
    return this.reserve.stats();
  }

  @Post('rebalance')
  async rebalance() {
    const moved = await this.reserve.rebalance('admin');
    return { moved, ...(await this.reserve.stats()) };
  }
}
