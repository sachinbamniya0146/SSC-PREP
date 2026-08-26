import { Module } from '@nestjs/common';
import { AdminApiKeyController } from './admin-api-keys.controller';
import { AdminApiKeyService } from './admin-api-keys.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AdminApiKeyController],
  providers: [AdminApiKeyService],
  exports: [AdminApiKeyService],
})
export class AdminApiKeyModule {}
