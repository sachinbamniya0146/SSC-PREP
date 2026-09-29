import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { StaffService } from './staff.service';
import { GrantStaffDto, UpdateStaffDto } from './dto/staff.dto';

// ADMIN-only: decide which student email gets which department.
@Controller('admin/staff')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  list() {
    return this.staff.list();
  }

  @Get('lookup')
  lookup(@Query('email') email?: string) {
    if (!email) throw new BadRequestException('email is required');
    return this.staff.lookup(email);
  }

  @Post()
  grant(@CurrentUser() actor: AuthenticatedUser, @Body() dto: GrantStaffDto) {
    return this.staff.grant(actor.userId, dto.email, dto.permissions);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staff.update(actor.userId, id, dto.permissions, dto.note);
  }

  @Delete(':id')
  revoke(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.revoke(actor.userId, id);
  }
}
