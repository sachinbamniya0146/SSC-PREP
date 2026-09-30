import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { S3Service } from './s3.service';

/**
 * Permanent, cache-friendly URLs for question / option images:
 *   GET /api/v1/media/question-images/<uuid>.png
 * Works for a PRIVATE R2/S3 bucket (no expiring presigned links) and for
 * images that were saved on local disk before R2 was configured.
 * Public on purpose (question figures are not secret) and excluded from the
 * global 60-req/min throttle — one test page can load dozens of figures.
 */
@Controller('media')
@Public()
@SkipThrottle()
export class MediaController {
  constructor(private readonly s3: S3Service) {}

  @Get('question-images/:file')
  async questionImage(@Param('file') file: string, @Res() res: Response) {
    const key = `question-images/${file}`;
    const media = await this.s3.getMedia(key);
    if (!media) throw new NotFoundException('Image not found');

    res.setHeader('Content-Type', media.contentType);
    if (media.contentLength) res.setHeader('Content-Length', String(media.contentLength));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    // helmet() defaults to same-origin, which would block <img> tags served from another origin.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (media.contentType === 'image/svg+xml') {
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    }
    media.body.on('error', () => {
      if (!res.headersSent) res.status(404).end();
      else res.destroy();
    });
    media.body.pipe(res);
  }
}
