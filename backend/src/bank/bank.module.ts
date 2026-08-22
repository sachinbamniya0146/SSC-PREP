import { Module } from '@nestjs/common';
import { BankService } from './bank.service';
import { BankController } from './bank.controller';
import { QuestionBankPracticeService } from './question-bank-practice.service';

@Module({
  controllers: [BankController],
  providers: [BankService, QuestionBankPracticeService],
  exports: [BankService, QuestionBankPracticeService],
})
export class BankModule {}
