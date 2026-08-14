import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * RedisModule — provides a shared ioredis client (cache, sessions, OTP,
 * rate-limit counters, BullMQ backing store).
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        const host = config.get<string>('REDIS_HOST') || 'localhost';
        const port = config.get<number>('REDIS_PORT') || 6379;
        const password = config.get<string>('REDIS_PASSWORD') || '';
        const client = new Redis({
          host,
          port,
          password: password || undefined,
          lazyConnect: false,
          maxRetriesPerRequest: null,
          retryStrategy: (times) => Math.min(times * 200, 2000),
        });
        client.on('error', (err) => {
          // Log but do not crash the app — Redis is non-fatal for auth OTP
          // fallbacks, though session enforcement needs it.
          // eslint-disable-next-line no-console
          console.error('[redis] connection error:', err.message);
        });
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
