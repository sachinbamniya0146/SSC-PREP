import { Module } from '@nestjs/common';
import { VocabService } from './vocab.service';
import { VocabController } from './vocab.controller';
import { VocabUploadService } from './vocab-upload.service';
import { VocabAdminController } from './vocab-admin.controller';
import { VocabRevisionService } from './vocab-revision.service';

@Module({
  controllers: [VocabController, VocabAdminController],
  providers: [VocabService, VocabUploadService, VocabRevisionService],
  exports: [VocabService, VocabRevisionService],
})
export class VocabModule {}
