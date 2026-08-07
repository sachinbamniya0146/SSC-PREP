import { Module } from '@nestjs/common';
import { BankService } from './bank.service';
import { BankController } from './bank.controller';

@Module({
  controllers: [BankController],
  providers: [BankService],
  exports: [BankService],
})
export class BankModule {}
