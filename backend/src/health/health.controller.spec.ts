/* eslint-disable @typescript-eslint/no-explicit-any */
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

const okPrisma: any = { $queryRaw: async () => [{ '?column?': 1 }] };
const redisOk: any = { ping: async () => 'PONG' };

describe('GET /health', () => {
  it('all fine -> ok, with ai snapshot, no secrets', async () => {
    const ai: any = { healthSnapshot: async () => ({ worker: 'on', lastTickSecAgo: 3, keysActive: 2, pendingJobs: 0, boot: 'x' }) };
    const r: any = await new HealthController(okPrisma, redisOk, ai).check();
    expect(r.status).toBe('ok');
    expect(r.checks).toMatchObject({ db: 'ok', redis: 'ok' });
    expect(JSON.stringify(r)).not.toMatch(/sk-or|apiKey/i);
  });
  it('redis down or worker stalled -> degraded but still 200', async () => {
    const r1: any = await new HealthController(okPrisma, { ping: async () => { throw new Error('x'); } } as any, undefined).check();
    expect(r1.status).toBe('degraded');
    const ai: any = { healthSnapshot: async () => ({ worker: 'stalled', lastTickSecAgo: 999, keysActive: 0, pendingJobs: 1, boot: null }) };
    expect(((await new HealthController(okPrisma, redisOk, ai).check()) as any).status).toBe('degraded');
  });
  it('database down -> 503', async () => {
    const bad: any = { $queryRaw: async () => { throw new Error('db'); } };
    await expect(new HealthController(bad, redisOk, undefined).check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('works with no dependencies injected (old behaviour)', async () => {
    expect(((await new HealthController().check()) as any).status).toBe('ok');
  });
});
