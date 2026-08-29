import { Controller, Get, Post, Param, Res, HttpCode, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { PdfExportService } from './pdf-export.service';
import { Public } from '../common/decorators/public.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('tests/:testTemplateId/pdf')
export class PdfExportController {
  constructor(private service: PdfExportService) {}

  // BUG FIX (audit round 4, item 1): generate/spotcheck/publish/status had NO
  // auth guard at all — any unauthenticated caller could regenerate PDFs,
  // fake-pass the QA spot-check, or flip a test paper live/published. These
  // are internal admin QA-gate actions, so they are now ADMIN/MODERATOR-only,
  // matching the same pattern already used for bank-upload and pdf-ingestion.
  @Post('generate')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  async generate(@Param('testTemplateId') id: string) {
    return this.service.generate(id);
  }

  @Post('spotcheck')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  async spotCheck(@Param('testTemplateId') id: string) {
    return this.service.spotCheck(id);
  }

  @Post('publish')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  async publish(@Param('testTemplateId') id: string) {
    return this.service.publish(id);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  async status(@Param('testTemplateId') id: string) {
    return this.service.status(id);
  }

  // Public downloads (browser <a href> — no auth header): served ONLY when published.
  @Public()
  @Get('paper')
  async paper(@Param('testTemplateId') id: string, @Res() res: Response) {
    const { buffer, filename } = await this.service.download(id, 'paper');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Public()
  @Get('answerkey')
  async answerKey(@Param('testTemplateId') id: string, @Res() res: Response) {
    const { buffer, filename } = await this.service.download(id, 'answerkey');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
