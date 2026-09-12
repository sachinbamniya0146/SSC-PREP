import { Module } from '@nestjs/common';
import { BankService } from './bank.service';
import { BankController } from './bank.controller';
import { BankUploadController } from './bank-upload.controller';
import { BankUploadService } from './bank-upload.service';
import { QuestionBankPracticeService } from './question-bank-practice.service';
import { TaxonomyImportService } from './taxonomy-import.service';

// BUG FIX (audit round 3): BankUploadService was never listed as a provider
// here, and BankUploadController didn't exist before — so the entire
// bulk-question-upload feature (Excel/CSV/JSON/Word import with duplicate
// detection) was unreachable dead code. Both are now registered.
//
// TaxonomyImportService (new) — bulk syllabus/taxonomy importer used by
// BankUploadController's POST /bank/admin/upload/syllabus-excel route.
@Module({
  controllers: [BankController, BankUploadController],
  providers: [BankService, QuestionBankPracticeService, BankUploadService, TaxonomyImportService],
  exports: [BankService, QuestionBankPracticeService, BankUploadService, TaxonomyImportService],
})
export class BankModule {}
