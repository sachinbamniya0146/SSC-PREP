/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import * as bodyParser from 'body-parser';
import { AppModule } from './app.module';

// Global BigInt JSON serialization fix for Prisma BigInt fields (Telegram chatId)
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use(compression()); // gzip all API responses — fast
  // Keep the RAW body for Razorpay webhook signature verification (v3 §1) —
  // HMAC must be computed over the exact bytes received.
  app.use(
    bodyParser.json({
      limit: '500mb',  // Increased for very large PDFs (365MB+)
      verify: (req: any, _res: any, buf: Buffer) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(bodyParser.urlencoded({ limit: '500mb', extended: true }));
  app.use(
    cors({
      // 2026-08-12: restrict to allow-list. Dev allows LAN IPs for phone testing.
      // Production: set FRONTEND_URL env var to your domain.
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const allowList = [
          frontendUrl,
          frontendUrl.replace('localhost', '127.0.0.1'),
          // Add www variant for production
          frontendUrl.replace('https://', 'https://www.'),
          frontendUrl.replace('https://', 'https://www.').replace('localhost', '127.0.0.1'),
          // Docker maps frontend 3000->3001, so allow both
          'http://localhost:3001',
          'http://127.0.0.1:3001',
        ];
        // Allow non-browser clients (curl, mobile apps) with no origin
        if (!origin) return callback(null, true);
        // Check exact match
        if (allowList.includes(origin)) return callback(null, true);
        // Allow LAN CIDR ranges for phone hotspot testing (common ranges)
        const lanPrefixes = ['192.168.', '10.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.'];
        const isLan = lanPrefixes.some((prefix) => origin.startsWith(`http://${prefix}`) || origin.startsWith(`https://${prefix}`));
        if (isLan) return callback(null, true);
        callback(new Error('Not allowed by CORS'), false);
      },
      credentials: true,
    }),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = Number(process.env.PORT) || 4000;
  await app.listen(port);
  logger.log(`SSC Prep Hub API running at http://localhost:${port}/api/v1`);
}

bootstrap();
