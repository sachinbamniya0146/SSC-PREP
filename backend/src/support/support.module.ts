import { Module } from '@nestjs/common';
import { SupportController } from './support.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SupportController],
})
export class SupportModule {}