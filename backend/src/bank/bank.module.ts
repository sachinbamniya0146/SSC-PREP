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
import { QuestionEditController } from './question-edit.controller';
import { QuestionEditService } from './question-edit.service';
import { DuplicateReviewController } from './duplicate-review.controller';
import { DuplicateReviewService } from './duplicate-review.service';
import { AiProviderModule } from '../ai-provider/ai-provider.module';
import { WeakTopicModule } from '../weak-topics/weak-topic.module';

// BUG FIX (audit round 3): BankUploadService was never listed as a provider
// here, and BankUploadController didn't exist before — so the entire
// bulk-question-upload feature (Excel/CSV/JSON/Word import with duplicate
// detection) was unreachable dead code. Both are now registered.
//
// TaxonomyImportService (new) — bulk syllabus/taxonomy importer used by
// BankUploadController's POST /bank/admin/upload/syllabus-excel route.
@Module({
  imports: [AiProviderModule, WeakTopicModule],
  controllers: [BankController, BankUploadController, BankUploadJobController, BankAdminController, QuestionEditController, DuplicateReviewController],
  providers: [BankService, QuestionBankPracticeService, BankUploadService, BankUploadJobService, TaxonomyImportService, BankAdminService, QuestionEditService, DuplicateReviewService],
  exports: [BankService, QuestionBankPracticeService, BankUploadService, TaxonomyImportService, BankAdminService, QuestionEditService],
})
export class BankModule {}
