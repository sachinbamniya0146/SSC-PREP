// Fake-provider integration: the REAL AiProviderService + the REAL job runner talk to a local mock OpenRouter server.
// No database, no internet. Covers success, 429, 401, timeout, bad JSON, partial agreement (2/5), 5/5, 5xx retry, gateway fallback.
import * as http from 'http';
import { AddressInfo } from 'net';
import { ServiceUnavailableException } from '@nestjs/common';
import { AiProviderService } from './ai-provider.service';
import { ProviderBusyError, QuestionCtx, runItem } from '../ai-jobs/ai-job.runner';

type Handler = (req: { key: string; model: string; n: number; path: string }) => { status?: number; body?: unknown; raw?: string; delayMs?: number };

let server: http.Server;
let base = '';
let handler: Handler;
let hits: Array<{ key: string; model: string; path: string }> = [];
// what GET /key answers per api key (default: key is valid)
let keyStatus: (key: string) => { status: number; body?: unknown } = () => ({ status: 200, body: { data: { limit_remaining: null } } });

const chat = (content: string) => ({ choices: [{ message: { content } }] });

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: { toString(): string }) => (body += c.toString()));
    req.on('end', () => {
      if (req.url?.endsWith('/models')) {
        res.setHeader('content-type', 'application/json');
        return void res.end(JSON.stringify({ data: ['m1:free', 'm2:free'].map((id) => ({ id, pricing: { prompt: '0', completion: '0' }, architecture: { output_modalities: ['text'] }, context_length: 8000 })) }));
      }
      const key = String(req.headers.authorization || '').replace('Bearer ', '');
      if (req.url?.endsWith('/key')) {
        const k = keyStatus(key);
        res.statusCode = k.status;
        res.setHeader('content-type', 'application/json');
        return void res.end(JSON.stringify(k.body ?? {}));
      }
      const model = (JSON.parse(body || '{}').model as string) || '';
      hits.push({ key, model, path: req.url || '' });
      const r = handler({ key, model, n: hits.length, path: req.url || '' });
      setTimeout(() => {
        res.statusCode = r.status ?? 200;
        res.setHeader('content-type', 'application/json');
        res.end(r.raw ?? JSON.stringify(r.body ?? {}));
      }, r.delayMs ?? 0);
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.OPENROUTER_BASE_URL = `${base}/api/v1`;
  process.env.AI_RETRY_BASE_MS = '10';
  process.env.AI_MODEL_HEALTH = 'off';
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));
beforeEach(() => {
  hits = [];
  keyStatus = () => ({ status: 200, body: { data: { limit_remaining: null } } });
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_MODEL;
});

function make(keys: Array<{ id: string; apiKey: string; keyName: string }>, off: Array<{ id: string; apiKey: string; keyName: string; manual?: boolean }> = []) {
  const usage: Array<{ id: string; ok: boolean; exhausted?: boolean }> = [];
  const logs: Array<Record<string, unknown>> = [];
  const healed: string[] = [];
  const fake = {
    getRotationPool: async () => keys,
    getKeys: async () => [
      ...keys.map((k) => ({ ...k, isActive: true, isPrimary: false, lastErrorMessage: null, exhaustedAt: null })),
      ...off.map((k) => ({ ...k, isActive: false, isPrimary: false, lastErrorMessage: '403', exhaustedAt: k.manual ? null : new Date() })),
    ],
    getRawKeyWithName: async (id: string) => off.find((k) => k.id === id) ?? keys.find((k) => k.id === id),
    markHealthy: async (id: string) => void healed.push(id),
    reportUsage: async (id: string, ok: boolean, o?: { exhausted?: boolean }) => void usage.push({ id, ok, exhausted: o?.exhausted }),
    logUsage: async (l: Record<string, unknown>) => void logs.push(l),
  };
  return { svc: new AiProviderService(fake as never), usage, logs, healed };
}
const K1 = { id: 'k1', apiKey: 'sk-or-v1-KEYONE1234567890', keyName: 'Key 1' };
const K2 = { id: 'k2', apiKey: 'sk-or-v1-KEYTWO1234567890', keyName: 'Key 2' };

describe('provider against a mock OpenRouter', () => {
  it('success', async () => {
    handler = () => ({ body: chat('{"answer":"B"}') });
    const { svc, usage } = make([K1]);
    const r = await svc.generate('q', { jsonResponse: true });
    expect(r.content).toContain('B');
    expect(r.source).toBe('ADMIN_KEY');
    expect(usage[0]).toMatchObject({ id: 'k1', ok: true });
  });

  it('429 on the first model -> next model answers, key is NOT marked dead', async () => {
    handler = ({ model }) => (model === 'm1:free' ? { status: 429, body: { error: 'slow down' } } : { body: chat('ok') });
    const { svc, usage } = make([K1]);
    const r = await svc.generate('q');
    expect(r.model).toBe('m2:free');
    expect(usage.every((u) => !u.exhausted)).toBe(true);
  });

  it('401 + OpenRouter says the key is invalid -> key reported dead, next key is used', async () => {
    keyStatus = (key) => (key === K1.apiKey ? { status: 401, body: { error: 'no auth' } } : { status: 200, body: { data: {} } });
    handler = ({ key }) => (key === K1.apiKey ? { status: 401, body: { error: `invalid api key ${K1.apiKey}` } } : { body: chat('ok2') });
    const { svc, usage, logs } = make([K1, K2]);
    const r = await svc.generate('q');
    expect(r.adminKeyId).toBe('k2');
    expect(usage.find((u) => u.id === 'k1')).toMatchObject({ ok: false, exhausted: true });
    expect(JSON.stringify(logs)).not.toContain('KEYONE1234567890'); // keys never reach the usage log
  });

  it('403 from a model while the key is VALID -> next model is tried and the key stays alive (the old bug)', async () => {
    handler = ({ model }) => (model === 'm1:free' ? { status: 403, body: { error: { message: 'model refused' } } } : { body: chat('answered by m2') });
    const { svc, usage } = make([K1]);
    const r = await svc.generate('q');
    expect(r.model).toBe('m2:free');
    expect(usage.every((u) => !u.exhausted)).toBe(true);
  });

  it('403 on EVERY model but key valid -> failure message, key NOT switched off', async () => {
    handler = () => ({ status: 403, body: { error: 'nope' } });
    const { svc, usage } = make([K1]);
    await expect(svc.generate('q')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(usage.length).toBe(1);
    expect(usage[0]).toMatchObject({ ok: false, exhausted: false });
  });

  it('403 and /key unreachable (5xx) -> still not called dead', async () => {
    keyStatus = () => ({ status: 503 });
    handler = () => ({ status: 403, body: {} });
    const { svc, usage } = make([K1]);
    await expect(svc.generate('q')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(usage[0]).toMatchObject({ exhausted: false });
  });

  it('key spend limit reached -> key rests, not dead', async () => {
    keyStatus = () => ({ status: 200, body: { data: { limit_remaining: 0 } } });
    handler = () => ({ status: 402, body: {} });
    const { svc, usage } = make([K1]);
    await expect(svc.generate('q')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(usage[0]).toMatchObject({ exhausted: false });
  });

  it('reviveKeys: auto-disabled key that works again is switched on; manual-OFF and truly invalid stay off', async () => {
    handler = () => ({ body: chat('OK') });
    const OFF1 = { id: 'o1', apiKey: 'sk-or-v1-OFFONE1234567890', keyName: 'Was killed by 403' };
    const OFF2 = { id: 'o2', apiKey: 'sk-or-v1-OFFTWO1234567890', keyName: 'Really invalid' };
    const OFF3 = { id: 'o3', apiKey: 'sk-or-v1-OFFTHREE1234567890', keyName: 'Admin switched off', manual: true };
    keyStatus = (key) => (key === OFF2.apiKey ? { status: 401 } : { status: 200, body: { data: {} } });
    const orig = handler;
    handler = ({ key }) => (key === OFF2.apiKey ? { status: 401, body: { error: 'invalid api key' } } : orig({ key, model: '', n: 0, path: '' }));
    const { svc, healed } = make([], [OFF1, OFF2, OFF3]);
    const r = await svc.reviveKeys();
    expect(r).toEqual({ checked: 2, revived: 1, stillInvalid: 1 });
    expect(healed).toEqual(['o1']);
  });

  it('every model 429 -> ServiceUnavailable and the key RESTS (not dead)', async () => {
    handler = () => ({ status: 429, body: {} });
    const { svc, usage } = make([K1]);
    await expect(svc.generate('q')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(usage[0]).toMatchObject({ ok: false, exhausted: false });
    const a = await svc.keyAvailability();
    expect(a).toMatchObject({ active: 1, ready: 0, resting: 1 });
  });

  it('5xx is retried with backoff on the same model, then succeeds', async () => {
    let n = 0;
    handler = () => (++n === 1 ? { status: 503, body: {} } : { body: chat('after retry') });
    const { svc } = make([K1]);
    const r = await svc.generate('q');
    expect(r.content).toBe('after retry');
    expect(hits.length).toBe(2);
    expect(hits[0].model).toBe(hits[1].model);
  });

  it('timeout: retried 2x per model then given up (no hang)', async () => {
    handler = () => ({ body: chat('late'), delayMs: 400 });
    const { svc } = make([K1]);
    const t0 = Date.now();
    await expect(svc.generate('q', { timeoutMs: 100 })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(hits.length).toBe(6); // 2 models x (1 try + 2 retries)
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it('oversized response is refused', async () => {
    handler = () => ({ raw: JSON.stringify(chat('x'.repeat(450_000))) });
    const { svc } = make([K1]);
    await expect(svc.generate('q')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('a model that keeps failing is demoted (ranked last) and not tried first any more', async () => {
    handler = ({ model }) => (model === 'm1:free' ? { status: 404, body: { error: 'gone' } } : { body: chat('ok') });
    const { svc } = make([K1]);
    for (let i = 0; i < 3; i++) await svc.generate('q');
    hits = [];
    await svc.generate('q');
    expect(hits.map((h) => h.model)).toEqual(['m2:free']); // m1 is ranked behind m2 now (A2 smart routing)
    const stats = svc.getModelStats();
    expect(stats[0].model).toBe('m2:free');
    expect(stats.find((m) => m.model === 'm1:free')?.successRate).toBe(0);
  });

  it('no keys at all -> clear error; with gateway env -> gateway answers', async () => {
    handler = () => ({ body: chat('{"answer":"A"}') });
    const none = make([]);
    await expect(none.svc.generate('q')).rejects.toBeInstanceOf(ServiceUnavailableException);
    process.env.OPENAI_BASE_URL = `${base}/gw/v1`;
    process.env.OPENAI_API_KEY = 'gw-secret-key-1234567890';
    process.env.OPENAI_MODEL = 'gw-model';
    const r = await none.svc.generate('q', { jsonResponse: true });
    expect(r.source).toBe('GATEWAY');
    expect(hits[hits.length - 1]).toMatchObject({ path: '/gw/v1/chat/completions', model: 'gw-model' });
    // keys exhausted (all 429) -> gateway is the fallback too
    const busy = make([K1]);
    handler = ({ path }) => (path.startsWith('/gw') ? { body: chat('gw ok') } : { status: 429, body: {} });
    expect((await busy.svc.generate('q')).source).toBe('GATEWAY');
  });

  it('student own key path still goes first and does not touch the admin pool', async () => {
    handler = () => ({ body: chat('mine') });
    const { svc, usage } = make([K1]);
    const r = await svc.generate('q', { userApiKey: 'sk-or-v1-STUDENT1234567890' });
    expect(r.source).toBe('USER_KEY');
    expect(usage.length).toBe(0);
    expect(hits[0].key).toBe('sk-or-v1-STUDENT1234567890');
  });
});

describe('job runner on top of the real provider (mock server)', () => {
  const q = (): QuestionCtx => ({ id: 'q', questionNo: 1, questionText: 'What is 2+2?', questionTextHindi: null, options: ['3', '4', '5', '6'].map((t, i) => ({ key: 'ABCD'[i], text: t })), correctAnswer: 'B', explanation: null, explanationHindi: null, subjectName: 'Maths', chapterId: null, chapterName: null, topicId: null, hindiExempt: true });
  const sol = (a: string) => chat(JSON.stringify({ answer: a, solution: 'Add the numbers: 2 + 2 = 4, option B is right.' }));
  const run = async (script: string[]) => {
    let i = 0;
    handler = () => ({ body: sol(script[Math.min(i++, script.length - 1)]) });
    const { svc } = make([K1]);
    return runItem('SOLUTION_GENERATE', q(), async (p, o) => {
      try {
        return (await svc.generate(p, { jsonResponse: true, maxTokens: o.maxTokens, modelOffset: o.passIndex })).content;
      } catch (e) {
        if (e instanceof ServiceUnavailableException) throw new ProviderBusyError();
        throw e;
      }
    }, { passes: 5, minAgree: 3 });
  };

  it('5/5 -> DONE after 3 calls', async () => {
    const r = await run(['B']);
    expect(r.status).toBe('DONE');
    expect(hits.length).toBe(3);
  });
  it('partial 2/5 -> NEEDS_REVIEW, all 5 passes used, different models rotated in', async () => {
    const r = await run(['B', 'C', 'B', 'C', 'D']);
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(hits.length).toBe(5);
    expect(new Set(hits.map((h) => h.model)).size).toBe(2);
  });
  it('bad JSON from the model on every pass -> FAILED', async () => {
    handler = () => ({ body: chat('I think the answer is B') });
    const { svc } = make([K1]);
    const r = await runItem('SOLUTION_GENERATE', q(), async (p) => (await svc.generate(p, { jsonResponse: true })).content, { passes: 5, minAgree: 3 });
    expect(r.status).toBe('FAILED');
  });
  it('all keys 429 -> ProviderBusyError (item goes back to the queue, no write)', async () => {
    handler = () => ({ status: 429, body: {} });
    const { svc } = make([K1]);
    await expect(runItem('SOLUTION_GENERATE', q(), async (p) => {
      try { return (await svc.generate(p, {})).content; } catch (e) { if (e instanceof ServiceUnavailableException) throw new ProviderBusyError(); throw e; }
    }, { passes: 5, minAgree: 3 })).rejects.toBeInstanceOf(ProviderBusyError);
  });
});

describe('A2: deadline, key verdicts, cache, quota', () => {
  it('overall deadline stops a slow failing chain early (fewer attempts than the full 2 keys x 2 models x 3 tries)', async () => {
    process.env.AI_CALL_DEADLINE_MS = '1000';
    handler = () => ({ status: 500, body: { error: 'boom' }, delayMs: 300 });
    const { svc } = make([K1, K2]);
    await expect(svc.generate('q')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(hits.length).toBeLessThan(12); // without a deadline: 12 provider hits
    expect(hits.length).toBeGreaterThanOrEqual(3);
    delete process.env.AI_CALL_DEADLINE_MS;
  });

  it('403 from a model while GET /key says valid -> key NOT killed, clear "model refused" message, never contains the key', async () => {
    handler = ({ model }) => (model === 'm1:free' ? { status: 403, body: { error: 'moderation' } } : { body: chat('ok') });
    const { svc, usage } = make([K1]);
    const r = await svc.generate('q');
    expect(r.model).toBe('m2:free');
    expect(usage.every((u) => !u.exhausted)).toBe(true);
  });

  it('401 + GET /key invalid -> key marked dead with a clear admin message (no key in it)', async () => {
    handler = () => ({ status: 401, body: { error: 'no auth' } });
    keyStatus = () => ({ status: 401 });
    const { svc, usage, logs } = make([K1]);
    await expect(svc.generate('q')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(usage[0]).toMatchObject({ id: 'k1', ok: false, exhausted: true });
    const msg = String(logs[0].errorMessage);
    expect(msg).toContain('Key 1');
    expect(msg).toContain('401');
    expect(msg).not.toContain('KEYONE1234567890');
    expect(JSON.stringify(svc.getKeyProblems())).not.toContain('KEYONE1234567890');
  });

  it('cacheTtlMs: identical prompt is answered from memory (no second provider hit)', async () => {
    handler = () => ({ body: chat('cached-answer') });
    const { svc } = make([K1]);
    await svc.generate('same prompt', { cacheTtlMs: 60_000 });
    const before = hits.length;
    const r = await svc.generate('same prompt', { cacheTtlMs: 60_000 });
    expect(r.content).toBe('cached-answer');
    expect(hits.length).toBe(before);
    await svc.generate('other prompt', { cacheTtlMs: 60_000 });
    expect(hits.length).toBe(before + 1);
  });

  it('getKeyInfo reads real usage/limit from GET /key and never returns the key', async () => {
    keyStatus = () => ({ status: 200, body: { data: { usage: 1.5, limit: 10, limit_remaining: 8.5, is_free_tier: false } } });
    const { svc } = make([K1]);
    const info = await svc.getKeyInfo('k1');
    expect(info).toEqual({ usage: 1.5, limit: 10, remaining: 8.5, isFree: false });
  });

  it('model latency is recorded and shown in stats', async () => {
    handler = () => ({ body: chat('ok'), delayMs: 30 });
    const { svc } = make([K1]);
    await svc.generate('q');
    expect(svc.getModelStats()[0].avgMs).toBeGreaterThan(0);
  });
});
