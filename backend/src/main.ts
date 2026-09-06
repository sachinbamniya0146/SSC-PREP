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
      //
      // FIX (found during a production CORS incident — signup/login on
      // https://sscprephub.in returned 500 "Not allowed by CORS" because the
      // production .env was missing FRONTEND_URL, so this fell back to
      // 'http://localhost:3000', which the real browser origin
      // (https://sscprephub.in) never matches):
      //   1. The fallback default is now the real production domain instead
      //      of a dev localhost URL, so a missing/forgotten FRONTEND_URL in
      //      production fails SAFE (site keeps working) instead of failing
      //      closed (every browser request rejected). Local dev is
      //      unaffected — 'http://localhost:3001'/'http://127.0.0.1:3001'
      //      (the actual dev frontend port per docker-compose.yml) and the
      //      LAN-IP allowance below still cover it regardless of this
      //      default.
      //   2. Still strongly recommended: set FRONTEND_URL explicitly in the
      //      production .env — this default is a safety net, not a
      //      substitute for correct configuration.
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        const frontendUrl = process.env.FRONTEND_URL || 'https://sscprephub.in';
        const allowList = [
          frontendUrl,
          frontendUrl.replace('localhost', '127.0.0.1'),
          // Add www variant for production
          frontendUrl.replace('https://', 'https://www.'),
          frontendUrl.replace('https://', 'https://www.').replace('localhost', '127.0.0.1'),
          // Local dev — docker-compose.yml maps the dev frontend container
          // to host port 3001 (see "frontend" service, ports: 3001:3000)
          'http://localhost:3000',
          'http://127.0.0.1:3000',
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
        // FIX: previously this threw an Error which the 'cors' package
        // propagates to Express's default error handler — NestJS then
        // returns a raw, unhelpful 500 "Internal server error" for a
        // rejected CORS preflight (this is what was actually observed in
        // production: OPTIONS .../auth/signup -> 500). A rejected origin
        // should fail the CORS check (no ACAO header, browser blocks the
        // request client-side — the standard, expected CORS-denied
        // behavior) without a server-side 500. Logging server-side for
        // visibility, but not throwing.
        logger.warn(`CORS: rejected origin "${origin}" (allowed: ${frontendUrl} and its variants)`);
        callback(null, false);
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
  const server = await app.listen(port);

  // BUGFIX ("bulk Excel upload — bahut der tak Uploading dikhta hai, kuch
  // nahi hota"): Node's default HTTP server request timeout is 300s (5 min)
  // in modern Node, but on some Node/setups it can be as low as 120s — and
  // either way it sits UNDER the 600s nginx proxy_read_timeout just raised
  // for the /bank/admin/upload/ route (see nginx/conf.d/*.conf). A slightly
  // slow multi-hundred-row bulk upload could still get cut off by the
  // backend itself before nginx's longer timeout ever came into play.
  // Raise both to comfortably exceed the nginx timeout so nginx is always
  // the (generous) outer bound, never the backend's own default.
  server.setTimeout(650_000); // 650s — a hair above nginx's 600s
  server.keepAliveTimeout = 650_000;
  server.headersTimeout = 660_000; // must be > keepAliveTimeout per Node docs

  logger.log(`SSC Prep Hub API running at http://localhost:${port}/api/v1`);
}

bootstrap();
