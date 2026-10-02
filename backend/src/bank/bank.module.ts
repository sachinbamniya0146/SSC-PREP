import { Module } from '@nestjs/common';
import { BankService } from './bank.service';
import { BankController } from './bank.controller';
import { BankUploadController } from './bank-upload.controller';
import { BankUploadService } from './bank-upload.service';
import { QuestionBankPracticeService } from './question-bank-practice.service';
import { TaxonomyImportService } from './taxonomy-import.service';
import { BankAdminService } from './bank-admin.service';
import { BankAdminController } from './bank-admin.controller';
import { BankUploadJobController } from './bank-upload-job.controller';
import { BankUploadJobService } from './bank-upload-job.service';

// BUG FIX (audit round 3): BankUploadService was never listed as a provider
// here, and BankUploadController didn't exist before — so the entire
// bulk-question-upload feature (Excel/CSV/JSON/Word import with duplicate
// detection) was unreachable dead code. Both are now registered.
//
// TaxonomyImportService (new) — bulk syllabus/taxonomy importer used by
// BankUploadController's POST /bank/admin/upload/syllabus-excel route.
@Module({
  controllers: [BankController, BankUploadController, BankUploadJobController, BankAdminController],
  providers: [BankService, QuestionBankPracticeService, BankUploadService, BankUploadJobService, TaxonomyImportService, BankAdminService],
  exports: [BankService, QuestionBankPracticeService, BankUploadService, TaxonomyImportService, BankAdminService],
})
export class BankModule {}
