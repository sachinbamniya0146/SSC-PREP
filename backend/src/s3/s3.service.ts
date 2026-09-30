/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';

const MEDIA_KEY_RE = /^question-images\/[A-Za-z0-9._-]+\.(png|jpe?g|webp|svg|gif)$/i;
const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

export interface StorageHealth {
  ok: boolean;
  mode: 's3' | 'local';
  configured: boolean;
  bucket: string | null;
  endpointHost: string | null;
  publicUrlBase: string | null;
  imageUrlStrategy: 'public-base' | 'backend-proxy' | 'local-disk';
  canWrite: boolean;
  canRead: boolean;
  canDelete: boolean;
  error?: string;
  hints: string[];
}

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private client: S3Client;
  private bucket: string;
  private publicUrlBase: string;
  private endpoint: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private localDir: string;
  private mediaBase: string;

  constructor(private config: ConfigService) {
    // BUGFIX (Session 24 — "S3 upload silently does nothing" root cause):
    // this constructor used to read S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY,
    // but env.validation.ts validates (and every deployment actually sets)
    // S3_BUCKET_NAME / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY. Fixed to read
    // the same names env.validation.ts validates.
    //
    // Sep 29 2026 — image-question upload hardening:
    //  * values are .trim()-ed (a pasted key with a trailing newline gives
    //    the same silent "SignatureDoesNotMatch" as a wrong key),
    //  * forcePathStyle when a custom endpoint (Cloudflare R2 / MinIO) is set,
    //  * if S3 is NOT configured, images fall back to local disk instead of
    //    failing (so "upload image" always works, even before R2 is set up),
    //  * a private bucket no longer produces links that expire after 7 days:
    //    without S3_PUBLIC_URL_BASE images are served through the backend's
    //    permanent /api/v1/media/... proxy route (see media.controller.ts).
    this.endpoint = String(this.config.get('S3_ENDPOINT') || '').trim();
    this.accessKeyId = String(this.config.get('S3_ACCESS_KEY_ID') || '').trim();
    this.secretAccessKey = String(this.config.get('S3_SECRET_ACCESS_KEY') || '').trim();
    this.bucket = String(this.config.get('S3_BUCKET_NAME') || '').trim();
    this.publicUrlBase = String(this.config.get('S3_PUBLIC_URL_BASE') || '').trim().replace(/\/+$/, '');
    this.localDir = String(process.env.UPLOADS_DIR || '').trim() || path.join(process.cwd(), 'uploads');
    // nginx only serves the MAIN domain (proxying /api/v1/), so the media host
    // defaults to FRONTEND_URL in production — NOT BACKEND_PUBLIC_URL (an
    // api.* host that may not exist). Local dev talks to the backend directly.
    const mediaHost = String(
      process.env.MEDIA_PUBLIC_BASE ||
        (process.env.NODE_ENV === 'production' ? process.env.FRONTEND_URL : `http://localhost:${process.env.PORT || 4000}`) ||
        '',
    )
      .trim()
      .replace(/\/+$/, '');
    this.mediaBase = `${mediaHost}/api/v1/media`;

    this.client = new S3Client({
      region: String(this.config.get('S3_REGION') || '').trim() || 'auto',
      endpoint: this.endpoint || undefined,
      forcePathStyle: !!this.endpoint,
      credentials: { accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey },
    });

    if (!this.isConfigured()) {
      this.logger.warn(
        'S3/R2 storage is not fully configured (need S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET_NAME [+ S3_ENDPOINT for R2]). ' +
          `Question images will be stored on local disk at ${this.localDir} until it is.`,
      );
    }
  }

  isConfigured(): boolean {
    return !!(this.accessKeyId && this.secretAccessKey && this.bucket);
  }

  mode(): 's3' | 'local' {
    return this.isConfigured() ? 's3' : 'local';
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

  // ---------------------------------------------------------------- local disk
  private localPathFor(key: string): string {
    const full = path.resolve(this.localDir, key);
    // Never let a crafted key escape the uploads directory.
    if (!full.startsWith(path.resolve(this.localDir) + path.sep)) throw new Error('Invalid storage key');
    return full;
  }

  private async writeLocal(key: string, body: Buffer) {
    const full = this.localPathFor(key);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, body);
  }

  // -------------------------------------------------------------- image upload
  /**
   * Upload one question/option image and return a URL a browser can load
   * with no auth header.
   *
   * URL strategy (permanent in every case — nothing expires):
   *  1. S3_PUBLIC_URL_BASE set  -> `${base}/${key}` (public bucket / CDN),
   *  2. S3 configured, no base  -> `/api/v1/media/${key}` backend proxy,
   *  3. S3 not configured       -> file kept on local disk, same proxy URL.
   */
  async uploadQuestionImage(key: string, body: Buffer, contentType: string): Promise<string> {
    if (this.isConfigured()) {
      try {
        await this.putObject(key, body, contentType);
      } catch (e: any) {
        this.logger.error(`R2/S3 upload failed for ${key}: ${e?.name || ''} ${e?.message || e}`);
        throw new Error(this.explainS3Error(e));
      }
      return this.publicUrlBase ? `${this.publicUrlBase}/${key}` : `${this.mediaBase}/${key}`;
    }
    await this.writeLocal(key, body);
    return `${this.mediaBase}/${key}`;
  }

  /** Turns a cryptic AWS-SDK error into a sentence an admin can act on. */
  explainS3Error(e: any): string {
    const name = String(e?.name || e?.Code || '');
    const status = e?.$metadata?.httpStatusCode;
    if (/SignatureDoesNotMatch/i.test(name)) return 'Storage login failed: S3_SECRET_ACCESS_KEY (or a stray space/newline in the keys) is wrong.';
    if (/InvalidAccessKeyId/i.test(name)) return 'Storage login failed: S3_ACCESS_KEY_ID is wrong.';
    if (/NoSuchBucket/i.test(name)) return `Storage bucket "${this.bucket}" was not found — check S3_BUCKET_NAME.`;
    if (/AccessDenied/i.test(name) || status === 403) return 'Storage access denied — the R2/S3 API token needs Object Read & Write permission on this bucket.';
    if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|TimeoutError/i.test(String(e?.code || name))) return 'Cannot reach the storage endpoint — check S3_ENDPOINT (R2: https://<account-id>.r2.cloudflarestorage.com).';
    if (/Invalid URL|endpoint/i.test(String(e?.message))) return 'S3_ENDPOINT is invalid — it must be a full https:// URL.';
    return `Image storage upload failed: ${e?.message || name || 'unknown error'}`;
  }

  // ------------------------------------------------------------- media serving
  static isSafeMediaKey(key: string): boolean {
    return MEDIA_KEY_RE.test(key) && !key.includes('..');
  }

  static contentTypeForKey(key: string): string {
    const ext = key.split('.').pop()?.toLowerCase() || '';
    return CONTENT_TYPES[ext] || 'application/octet-stream';
  }

  /** Stream an already-uploaded image back (used by the public /media route). */
  async getMedia(key: string): Promise<{ body: Readable; contentType: string; contentLength?: number } | null> {
    if (!S3Service.isSafeMediaKey(key)) return null;
    const fallbackType = S3Service.contentTypeForKey(key);

    // A file may live on local disk (uploaded before R2 was configured) even
    // when S3 is configured now — check disk first, then the bucket.
    try {
      const full = this.localPathFor(key);
      const stat = await fs.promises.stat(full);
      if (stat.isFile()) return { body: fs.createReadStream(full), contentType: fallbackType, contentLength: stat.size };
    } catch {
      /* not on disk */
    }
    if (!this.isConfigured()) return null;
    try {
      const obj = await this.getObject(key);
      if (!obj.Body) return null;
      return {
        body: obj.Body as Readable,
        contentType: obj.ContentType && obj.ContentType !== 'binary/octet-stream' ? obj.ContentType : fallbackType,
        contentLength: obj.ContentLength,
      };
    } catch (e: any) {
      if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null;
      this.logger.warn(`media fetch failed for ${key}: ${e?.name || ''} ${e?.message || e}`);
      return null;
    }
  }

  // ------------------------------------------------------------------ health
  /** Real write -> read -> delete round trip, so a misconfigured bucket is caught before an admin uploads 500 images. */
  async healthCheck(): Promise<StorageHealth> {
    const hints: string[] = [];
    let endpointHost: string | null = null;
    try {
      endpointHost = this.endpoint ? new URL(this.endpoint).host : null;
    } catch {
      hints.push('S3_ENDPOINT is not a valid URL. For Cloudflare R2 use https://<account-id>.r2.cloudflarestorage.com');
    }
    const base: StorageHealth = {
      ok: false,
      mode: this.mode(),
      configured: this.isConfigured(),
      bucket: this.bucket || null,
      endpointHost,
      publicUrlBase: this.publicUrlBase || null,
      imageUrlStrategy: !this.isConfigured() ? 'local-disk' : this.publicUrlBase ? 'public-base' : 'backend-proxy',
      canWrite: false,
      canRead: false,
      canDelete: false,
      hints,
    };

    if (!this.isConfigured()) {
      hints.push('Set S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET_NAME (and S3_ENDPOINT for R2) in the VPS .env, then restart the backend.');
      hints.push(`Until then images are saved on local disk (${this.localDir}) — make sure that folder is a persistent volume.`);
      try {
        await this.writeLocal('question-images/.health-probe.png', Buffer.from('ok'));
        await fs.promises.unlink(this.localPathFor('question-images/.health-probe.png'));
        base.canWrite = base.canRead = base.canDelete = true;
        base.ok = true;
      } catch (e: any) {
        base.error = `Local disk is not writable: ${e?.message || e}`;
      }
      return base;
    }

    if (this.config.get('S3_REGION') && !this.endpoint) hints.push('S3_ENDPOINT is empty — fine for AWS S3, but Cloudflare R2 needs it (this was the cause of failing image uploads).');
    if (!this.endpoint) hints.push('No S3_ENDPOINT: requests go to AWS S3. If your bucket is on Cloudflare R2 set S3_ENDPOINT.');
    if (!this.publicUrlBase) hints.push('S3_PUBLIC_URL_BASE is empty — images are served via the backend /api/v1/media proxy (permanent, but uses your VPS bandwidth). For best speed enable an R2 public domain and set S3_PUBLIC_URL_BASE.');

    const probeKey = `question-images/.health-probe-${Date.now()}.png`;
    try {
      await this.putObject(probeKey, Buffer.from('ok'), 'image/png');
      base.canWrite = true;
      const got = await this.getObject(probeKey);
      base.canRead = !!got.Body;
      await this.deleteObject(probeKey);
      base.canDelete = true;
      base.ok = base.canWrite && base.canRead && base.canDelete;
    } catch (e: any) {
      base.error = this.explainS3Error(e);
      this.logger.warn(`storage health check failed: ${e?.name || ''} ${e?.message || e}`);
    }
    return base;
  }
}
