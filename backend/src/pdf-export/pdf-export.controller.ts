import { Controller, Get, Post, Param, Res, HttpCode } from '@nestjs/common';
import { Response } from 'express';
import { PdfExportService } from './pdf-export.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('tests/:testTemplateId/pdf')
export class PdfExportController {
  constructor(private service: PdfExportService) {}

  @Post('generate')
  @HttpCode(200)
  async generate(@Param('testTemplateId') id: string) {
    return this.service.generate(id);
  }

  @Post('spotcheck')
  @HttpCode(200)
  async spotCheck(@Param('testTemplateId') id: string) {
    return this.service.spotCheck(id);
  }

  @Post('publish')
  @HttpCode(200)
  async publish(@Param('testTemplateId') id: string) {
    return this.service.publish(id);
  }

  @Get('status')
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
