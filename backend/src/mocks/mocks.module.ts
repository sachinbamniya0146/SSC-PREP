import { Module } from '@nestjs/common';
import { MocksService } from './mocks.service';
import { MocksController } from './mocks.controller';

@Module({
  providers: [MocksService],
  controllers: [MocksController],
  exports: [MocksService],
})
export class MocksModule {}
