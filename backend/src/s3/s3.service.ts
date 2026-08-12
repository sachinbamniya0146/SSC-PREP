import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

@Injectable()
export class S3Service {
  private client: S3Client;
  private bucket: string;

  constructor(private config: ConfigService) {
    this.client = new S3Client({
      region: this.config.get('S3_REGION') || 'us-east-1',
      endpoint: this.config.get('S3_ENDPOINT'),
      credentials: {
        accessKeyId: this.config.get('S3_ACCESS_KEY') || '',
        secretAccessKey: this.config.get('S3_SECRET_KEY') || '',
      },
    });
    this.bucket = this.config.get('S3_BUCKET') || 'ssc-prep-hub';
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
}