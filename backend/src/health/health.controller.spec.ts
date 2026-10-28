/* eslint-disable @typescript-eslint/no-explicit-any */
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

const okPrisma: any = { $queryRaw: async () => [{ '?column?': 1 }] };
const redisOk: any = { ping: async () => 'PONG' };

describe('GET /health', () => {
  it('all fine -> ok, no secrets', async () => {
    const r: any = await new HealthController(okPrisma, redisOk).check();
    expect(r.status).toBe('ok');
    expect(r.checks).toMatchObject({ db: 'ok', redis: 'ok' });
    expect(JSON.stringify(r)).not.toMatch(/sk-or|apiKey/i);
  });
  it('redis down -> degraded but still 200', async () => {
    const r1: any = await new HealthController(okPrisma, { ping: async () => { throw new Error('x'); } } as any).check();
    expect(r1.status).toBe('degraded');
  });
  it('database down -> 503', async () => {
    const bad: any = { $queryRaw: async () => { throw new Error('db'); } };
    await expect(new HealthController(bad, redisOk).check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('works with no dependencies injected (old behaviour)', async () => {
    expect(((await new HealthController().check()) as any).status).toBe('ok');
  });
});
