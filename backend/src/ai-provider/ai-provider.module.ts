import { Module } from '@nestjs/common';
import { AiProviderService } from './ai-provider.service';
import { AiProviderController } from './ai-provider.controller';
import { AdminApiKeyModule } from '../admin-api-keys/admin-api-keys.module';

@Module({
  imports: [AdminApiKeyModule],
  controllers: [AiProviderController],
  providers: [AiProviderService],
  exports: [AiProviderService],
})
export class AiProviderModule {}
