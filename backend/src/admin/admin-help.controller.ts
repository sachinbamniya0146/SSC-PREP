import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminService } from './admin.service';

@Controller('admin/help')
export class AdminHelpController {
  constructor(private readonly adminService: AdminService) {}

  @Get('formats')
  @Roles('ADMIN', 'MODERATOR')
  async getFormatExamples(@CurrentUser() user: { userId: string }) {
    return this.adminService.getFormatExamples();
  }

  @Get('prompts')
  @Roles('ADMIN', 'MODERATOR')
  async getAIPrompts(@CurrentUser() user: { userId: string }) {
    return this.adminService.getAIPrompts();
  }

  @Get('templates/excel')
  @Roles('ADMIN', 'MODERATOR')
  async downloadExcelTemplate(@Res() res: Response) {
    const buffer = this.adminService.generateExcelTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="question_bulk_upload_template.xlsx"');
    res.send(buffer);
  }

  @Get('templates/csv')
  @Roles('ADMIN', 'MODERATOR')
  async downloadCSVTemplate(@Res() res: Response) {
    const buffer = this.adminService.generateCSVTemplate();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="question_bulk_upload_template.csv"');
    res.send(buffer);
  }

  @Get('templates/json')
  @Roles('ADMIN', 'MODERATOR')
  async downloadJSONTemplate(@Res() res: Response) {
    const buffer = this.adminService.generateJSONTemplate();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="question_bulk_upload_template.json"');
    res.send(buffer);
  }

  @Get('templates/text')
  @Roles('ADMIN', 'MODERATOR')
  async downloadTextTemplate(@Res() res: Response) {
    const buffer = this.adminService.generateTextTemplate();
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="question_bulk_upload_template.txt"');
    res.send(buffer);
  }
}