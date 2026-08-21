import { Module } from '@nestjs/common';
import { MocksService } from './mocks.service';
import { MocksController } from './mocks.controller';
import { MockTestService } from './mock-test.service';
import { MockTestController } from './mock-test.controller';

@Module({
  providers: [MocksService, MockTestService],
  controllers: [MocksController, MockTestController],
  exports: [MocksService, MockTestService],
})
export class MocksModule {}
