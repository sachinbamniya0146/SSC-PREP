import { Module } from '@nestjs/common';
import { WeakTopicService } from './weak-topic.service';
import { WeakTopicController } from './weak-topic.controller';

@Module({
  controllers: [WeakTopicController],
  providers: [WeakTopicService],
  exports: [WeakTopicService],
})
export class WeakTopicModule {}
