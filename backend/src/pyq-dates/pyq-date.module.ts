import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BankModule } from '../bank/bank.module';
import { PyqDateController } from './pyq-date.controller';
import { PyqExportController } from './pyq-export.controller';
import { PyqDateService } from './pyq-date.service';
import { PyqExportService } from './pyq-export.service';

@Module({
  imports: [PrismaModule, BankModule],
  controllers: [PyqDateController, PyqExportController],
  providers: [PyqDateService, PyqExportService],
  exports: [PyqDateService],
})
export class PyqDateModule {}
