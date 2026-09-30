import { Module, Global } from '@nestjs/common';
import { S3Service } from './s3.service';
import { MediaController } from './media.controller';

@Global()
@Module({
  controllers: [MediaController],
  providers: [S3Service],
  exports: [S3Service],
})
export class S3Module {}
