import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiProviderModule } from '../ai-provider/ai-provider.module';
import { AdminApiKeyModule } from '../admin-api-keys/admin-api-keys.module';
import { PyqDateModule } from '../pyq-dates/pyq-date.module';
import { AiJobController } from './ai-job.controller';
import { AiJobService } from './ai-job.service';
import { AiSystemCheckService } from './ai-system-check.service';

@Module({
  imports: [PrismaModule, AiProviderModule, AdminApiKeyModule, PyqDateModule],
  controllers: [AiJobController],
  providers: [AiJobService, AiSystemCheckService],
  exports: [AiJobService],
})
export class AiJobsModule {}
