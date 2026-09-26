import { Module } from '@nestjs/common';
import { VocabService } from './vocab.service';
import { VocabController } from './vocab.controller';
import { VocabUploadService } from './vocab-upload.service';
import { VocabAdminController } from './vocab-admin.controller';

@Module({
  controllers: [VocabController, VocabAdminController],
  providers: [VocabService, VocabUploadService],
  exports: [VocabService],
})
export class VocabModule {}
