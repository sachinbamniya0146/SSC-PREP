import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiProviderModule } from '../ai-provider/ai-provider.module';
import { AdminApiKeyModule } from '../admin-api-keys/admin-api-keys.module';
import { BankModule } from '../bank/bank.module';
import { PyqDateController } from './pyq-date.controller';
import { PyqExportController } from './pyq-export.controller';
import { PyqDateService } from './pyq-date.service';
import { PyqDateSearchService } from './pyq-date-search.service';
import { PyqExportService } from './pyq-export.service';

@Module({
  imports: [PrismaModule, AiProviderModule, AdminApiKeyModule, BankModule],
  controllers: [PyqDateController, PyqExportController],
  providers: [PyqDateService, PyqDateSearchService, PyqExportService],
  exports: [PyqDateService],
})
export class PyqDateModule {}
