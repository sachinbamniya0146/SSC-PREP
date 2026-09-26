import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { VocabUploadService } from './vocab-upload.service';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

@Controller('vocab/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MODERATOR')
export class VocabAdminController {
  constructor(
    private readonly upload: VocabUploadService,
    private readonly prisma: PrismaService,
  ) {}

  // "admin vocab ke questions ko bhi excel se... upload kar sake, jesa PYQ ka
  // scene hai same vesa hi" — see Vocabulary_30Words_Import.xlsx for the
  // exact two-sheet (Words + Questions) format this expects.
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadExcel(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('Multipart field "file" (.xlsx) is required');
    return this.upload.uploadFromExcel(file.buffer);
  }

  @Get('words')
  async listWords(@Query('q') q?: string) {
    const words = await this.prisma.vocabWord.findMany({
      where: q ? { word: { contains: q, mode: 'insensitive' } } : undefined,
      orderBy: { orderIndex: 'asc' },
      include: { _count: { select: { questions: true, progress: true } } },
    });
    return words.map((w) => ({
      id: w.id,
      slug: w.slug,
      word: w.word,
      orderIndex: w.orderIndex,
      isActive: w.isActive,
      questionCount: w._count.questions,
      studentsProgressing: w._count.progress,
    }));
  }

  @Put('words/:id')
  async updateWord(@Param('id') id: string, @Body() body: { orderIndex?: number; isActive?: boolean }) {
    const existing = await this.prisma.vocabWord.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('Word not found');
    const data: { orderIndex?: number; isActive?: boolean } = {};
    if (body.orderIndex !== undefined) data.orderIndex = Number(body.orderIndex);
    if (body.isActive !== undefined) data.isActive = !!body.isActive;
    return this.prisma.vocabWord.update({ where: { id }, data });
  }

  // Deleting a word cascades its questions AND every student's progress row
  // for it (onDelete: Cascade in schema.prisma) — used for cleaning up a
  // mis-imported word, not for routine editing (use PUT to just deactivate).
  @Delete('words/:id')
  async deleteWord(@Param('id') id: string) {
    const existing = await this.prisma.vocabWord.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('Word not found');
    await this.prisma.vocabWord.delete({ where: { id } });
    return { deleted: true };
  }
}
