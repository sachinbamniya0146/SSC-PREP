import { Module } from '@nestjs/common';
import { BankService } from './bank.service';
import { BankController } from './bank.controller';
import { BankUploadController } from './bank-upload.controller';
import { BankUploadService } from './bank-upload.service';
import { QuestionBankPracticeService } from './question-bank-practice.service';

// BUG FIX (audit round 3): BankUploadService was never listed as a provider
// here, and BankUploadController didn't exist before — so the entire
// bulk-question-upload feature (Excel/CSV/JSON/Word import with duplicate
// detection) was unreachable dead code. Both are now registered.
@Module({
  controllers: [BankController, BankUploadController],
  providers: [BankService, QuestionBankPracticeService, BankUploadService],
  exports: [BankService, QuestionBankPracticeService, BankUploadService],
})
export class BankModule {}
