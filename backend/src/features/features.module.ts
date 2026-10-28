import { Global, Module } from '@nestjs/common';
import { FeaturesService } from './features.service';
import { FeaturesAdminController, FeaturesPublicController } from './features.controller';

/** Global on purpose: any module can `assertEnabled('flag')` without importing this one. */
@Global()
@Module({
  providers: [FeaturesService],
  controllers: [FeaturesPublicController, FeaturesAdminController],
  exports: [FeaturesService],
})
export class FeaturesModule {}
