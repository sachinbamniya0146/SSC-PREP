import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminService } from './admin.service';
import { BankUploadService } from '../bank/bank-upload.service';

@Controller('admin/help')
export class AdminHelpController {
  constructor(
    private readonly adminService: AdminService,
    private readonly uploadService: BankUploadService,
  ) {}

  @Get('formats')
  @Roles('ADMIN', 'MODERATOR')
  async getFormatExamples(@CurrentUser() _user: { userId: string }) {
    return this.adminService.getFormatExamples();
  }

  @Get('prompts')
  @Roles('ADMIN', 'MODERATOR')
  async getAIPrompts(@CurrentUser() _user: { userId: string }) {
    return this.adminService.getAIPrompts();
  }

  // FIX (bonus grep item c — two parallel template generators, one dead
  // and divergent): these four routes used to call AdminService's own
  // generateXTemplate() methods, which were a hand-maintained SECOND copy
  // of the bulk-upload template — missing topicId/subTopicId/paperCode
  // entirely, so a question filled in against this template could never
  // reference a topic/sub-topic or record a paperCode. The REAL template —
  // the one that actually matches what BankUploadService's own parser
  // accepts (see the trailing-`*`-header-strip fix) — lived in
  // BankUploadService.generateXTemplate(), but was never wired to any
  // route, so admins never saw it. Now these routes delegate straight to
  // BankUploadService, so there is exactly one template generator, and it's
  // guaranteed to match the parser that actually receives the upload.
  @Get('templates/excel')
  @Roles('ADMIN', 'MODERATOR')
  async downloadExcelTemplate(@Res() res: Response) {
    // generateExcelTemplate() is now async (this session) — it queries the
    // DB to fill the "Reference IDs" sheet with real exam/subject/chapter/
    // topic/sub-topic IDs instead of placeholder '...' rows. Must be awaited.
    const buffer = await this.uploadService.generateExcelTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="question_bulk_upload_template.xlsx"');
    res.send(buffer);
  }

  @Get('templates/csv')
  @Roles('ADMIN', 'MODERATOR')
  async downloadCSVTemplate(@Res() res: Response) {
    const buffer = this.uploadService.generateCSVTemplate();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="question_bulk_upload_template.csv"');
    res.send(buffer);
  }

  @Get('templates/json')
  @Roles('ADMIN', 'MODERATOR')
  async downloadJSONTemplate(@Res() res: Response) {
    const buffer = this.uploadService.generateJSONTemplate();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="question_bulk_upload_template.json"');
    res.send(buffer);
  }

  @Get('templates/text')
  @Roles('ADMIN', 'MODERATOR')
  async downloadTextTemplate(@Res() res: Response) {
    const buffer = this.uploadService.generateTextTemplate();
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="question_bulk_upload_template.txt"');
    res.send(buffer);
  }
}
