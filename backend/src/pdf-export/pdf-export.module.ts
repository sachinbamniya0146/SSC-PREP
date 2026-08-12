import { Module } from '@nestjs/common';
import { PdfExportController } from './pdf-export.controller';
import { ChapterPdfController } from './chapter-pdf.controller';
import { PdfExportService } from './pdf-export.service';
import { PdfRenderer } from './pdf-renderer';

@Module({
  controllers: [PdfExportController, ChapterPdfController],
  providers: [PdfExportService, PdfRenderer],
  exports: [PdfExportService],
})
export class PdfExportModule {}
