import { Controller, Get, Inject, Optional, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import Redis from 'ioredis';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/**
 * GET /health  (public, no secrets)
 *  - 200 {status:'ok'|'degraded'} when the API process + database answer; 503 only when the DATABASE is down.
 *  - `checks` shows db / redis so a monitor (or the docker healthcheck) sees the real state.
 */
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  @Public()
  @Get()
  async check() {
    const checks: Record<string, unknown> = {};
    let db = true;
    let degraded = false;
    if (this.prisma) {
      try {
        await withTimeout(this.prisma.$queryRaw`SELECT 1`, 3000);
        checks.db = 'ok';
      } catch {
        checks.db = 'down';
        db = false;
      }
    }
    if (this.redis) {
      try {
        await withTimeout(this.redis.ping(), 2000);
        checks.redis = 'ok';
      } catch {
        checks.redis = 'down';
        degraded = true;
      }
    }
    const body = { status: !db ? 'down' : degraded ? 'degraded' : 'ok', service: 'ssc-prep-hub-api', timestamp: new Date().toISOString(), uptimeSec: Math.round(process.uptime()), checks };
    if (!db) throw new ServiceUnavailableException(body);
    return body;
  }
}
