import { Module } from '@nestjs/common';
import { PdfExportController } from './pdf-export.controller';
import { ChapterPdfController } from './chapter-pdf.controller';
import { PdfExportService } from './pdf-export.service';
import { PdfRenderer } from './pdf-renderer';

@Module({
  controllers: [PdfExportController, ChapterPdfController],
  providers: [PdfExportService, PdfRenderer],
  // BUGFIX (bonus grep — module-registration gap, same family as the
  // missing meilisearch-index worker and the missing TestsService export
  // found earlier in this audit): PdfRenderer (the raw HTML→PDF Chromium
  // wrapper) was never exported, only PdfExportService was. TelegramModule
  // needs PdfRenderer directly for Requirement 5 (attempt PDFs) — those
  // aren't a template/chapter PDF, so PdfExportService's existing methods
  // don't cover them, but the underlying renderer + pdf-templates.ts
  // building blocks are exactly what the spec says to reuse.
  exports: [PdfExportService, PdfRenderer],
})
export class PdfExportModule {}
