import { Controller, Post, Param, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { PdfExportService } from './pdf-export.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

/**
 * v3 §7 — Chapter PDF (₹1 one-time purchase). Auth required; entitlement
 * (ChapterPurchase SUCCESS or ACTIVE subscription) enforced server-side.
 */
@Controller('pdf/chapter')
@UseGuards(JwtAuthGuard)
export class ChapterPdfController {
  constructor(private service: PdfExportService) {}

  @Post(':chapterId/generate')
  async generate(
    @CurrentUser() user: { userId: string },
    @Param('chapterId') chapterId: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.service.generateChapterPdf(user.userId, chapterId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}