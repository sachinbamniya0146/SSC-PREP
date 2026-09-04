/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

@Injectable()
export class S3Service {
  private client: S3Client;
  private bucket: string;
  private publicUrlBase: string;

  constructor(private config: ConfigService) {
    // BUGFIX (Session 24 — "S3 upload silently does nothing" root cause):
    // this constructor used to read S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY,
    // but env.validation.ts validates (and every deployment actually sets)
    // S3_BUCKET_NAME / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY. The names
    // never matched, so this.config.get() always returned undefined here —
    // credentials silently fell back to '' and the bucket silently fell
    // back to the hard-coded 'ssc-prep-hub' default, no matter what was
    // actually configured in .env. Any putObject() call was therefore
    // either hitting the wrong bucket or failing auth — with no visible
    // error until something tried to actually READ the uploaded file back.
    // Fixed to read the same names env.validation.ts validates.
    this.client = new S3Client({
      region: this.config.get('S3_REGION') || 'auto',
      endpoint: this.config.get('S3_ENDPOINT') || undefined,
      credentials: {
        accessKeyId: this.config.get('S3_ACCESS_KEY_ID') || '',
        secretAccessKey: this.config.get('S3_SECRET_ACCESS_KEY') || '',
      },
    });
    this.bucket = this.config.get('S3_BUCKET_NAME') || 'ssc-prep-hub';
    this.publicUrlBase = (this.config.get('S3_PUBLIC_URL_BASE') || '').replace(/\/+$/, '');
  }

  async headObject(key: string) {
    const cmd = new HeadObjectCommand({ Bucket: this.bucket, Key: key });
    return this.client.send(cmd);
  }

  async getObject(key: string) {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return this.client.send(cmd);
  }

  async putObject(key: string, body: Buffer | Readable, contentType?: string) {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body as any,
      ContentType: contentType,
    });
    return this.client.send(cmd);
  }

  async deleteObject(key: string) {
    const cmd = new DeleteObjectCommand({ Bucket: this.bucket, Key: key });
    return this.client.send(cmd);
  }

  async getPresignedUploadUrl(key: string, expiresIn = 3600) {
    const cmd = new PutObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, cmd, { expiresIn });
  }

  async getPresignedDownloadUrl(key: string, expiresIn = 3600) {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, cmd, { expiresIn });
  }

  /**
   * Session 24 — upload a file and get back a URL a browser can load
   * directly (no auth header), for use as questionImageUrl / an option's
   * imageUrl on a diagram-type reasoning question (mirror image, figure
   * series, embedded figure, paper-folding, dice/clock — anything that
   * isn't a simple Venn diagram and genuinely needs a real picture).
   *
   * If S3_PUBLIC_URL_BASE is configured (recommended for production — a
   * public bucket URL or CDN domain), returns a PERMANENT link. If it's
   * blank, falls back to a 7-day presigned URL so this still works in dev
   * — but that link WILL expire, so production deployments should set
   * S3_PUBLIC_URL_BASE rather than rely on the fallback long-term.
   */
  async uploadQuestionImage(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.putObject(key, body, contentType);
    if (this.publicUrlBase) {
      return `${this.publicUrlBase}/${key}`;
    }
    return this.getPresignedDownloadUrl(key, 60 * 60 * 24 * 7); // 7 days
  }
}
