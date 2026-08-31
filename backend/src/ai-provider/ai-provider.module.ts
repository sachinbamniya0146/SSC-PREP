import { Module } from '@nestjs/common';
import { AiProviderService } from './ai-provider.service';
import { AdminApiKeyModule } from '../admin-api-keys/admin-api-keys.module';

@Module({
  imports: [AdminApiKeyModule],
  providers: [AiProviderService],
  exports: [AiProviderService],
})
export class AiProviderModule {}
