/**
 * SSC Prep Hub — Hindi translation job for the question bank.
 *
 * Fills questionTextHindi / explanationHindi for questions that only have
 * English, using a free-tier LLM endpoint (default: deepseek-v4-flash-free
 * via opencode-zen; Gemini fallback via auth.json credential pool).
 *
 * Per v2 Rule 7, ALL AI-generated text is tagged translationStatus =
 * AUTO_UNVERIFIED — NEVER presented as verified/human fact. A human admin
 * must review before trusting it in the live pool.
 *
 * Rate-limit aware: 429/5xx → exponential backoff + retry; resumes from where
 * it stopped (idempotent by translationStatus filter).
 *
 * Run: node scripts/translate-hindi.mjs [--limit N] [--dry-run]
 *      TRANSLATE_PROVIDER=zen|gemini node scripts/translate-hindi.mjs
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';

const db = new PrismaClient();
const LIMIT = process.argv.includes('--dry-run')
  ? 1
  : Number(process.argv[process.argv.indexOf('--limit') + 1] || 100000);
const DRY = process.argv.includes('--dry-run');
const PROVIDER = process.env.TRANSLATE_PROVIDER || 'zen';

const ZEN = {
  base: process.env.ZEN_BASE_URL || 'https://opencode.ai/zen/v1',
  model: process.env.ZEN_MODEL || 'deepseek-v4-flash-free',
};

function loadGemini() {
  const auth = JSON.parse(readFileSync('/Users/sachin/.hermes/auth.json', 'utf-8'));
  const pool = (auth.credential_pool || {}).gemini || [];
  return pool.filter((x) => x.access_token || x.api_key || x.secret);
}
const GEMINI_KEYS = loadGemini();

const PROMPT = (q, opts, expl) => `Translate this SSC exam question into natural Hindi. Keep numbers, options, option letters and any code/letter-sequences EXACTLY as-is. Return STRICT JSON only, no markdown, no extra text:
{"question_hi": "...", "options_hi": ["opt A hindi", "opt B hindi", "opt C hindi", "opt D hindi"], "explanation_hi": "..."}

ENGLISH QUESTION:
${q}

OPTIONS:
A: ${opts[0]}
B: ${opts[1]}
C: ${opts[2]}
D: ${opts[3]}

ENGLISH EXPLANATION:
${expl || '(none)'}`;

async function callZen(text) {
  const r = await fetch(`${ZEN.base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ZEN.model,
      messages: [
        { role: 'system', content: 'You translate SSC exam questions to Hindi. Output JSON only.' },
        { role: 'user', content: text },
      ],
      max_tokens: 1024,
      temperature: 0.2,
    }),
  });
  if (r.status === 429 || r.status >= 500) throw new Error(`zen HTTP ${r.status}`);
  if (!r.ok) throw new Error(`zen HTTP ${r.status}`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content || '';
}

async function callGemini(text) {
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const entry = GEMINI_KEYS[attempt % GEMINI_KEYS.length];
    const key = entry.access_token || entry.api_key || entry.secret;
    const base = (entry.base_url || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
    const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
    try {
      const r = await fetch(`${base}/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
        }),
      });
      if (r.status === 429) {
        lastErr = new Error('429');
        await sleep(3000 * (attempt + 1));
        continue;
      }
      if (!r.ok) { lastErr = new Error(`gemini HTTP ${r.status}`); await sleep(1500); continue; }
      const j = await r.json();
      return j.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (e) { lastErr = e; await sleep(1000); }
  }
  throw lastErr || new Error('gemini failed');
}

async function callLLM(text) {
  if (PROVIDER === 'gemini') return callGemini(text);
  try {
    return await callZen(text);
  } catch (zenErr) {
    if (GEMINI_KEYS.length) {
      try { return await callGemini(text); } catch { /* fall through */ }
    }
    throw zenErr;
  }
}

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const todo = await db.question.findMany({
    where: { translationStatus: 'AUTO_UNVERIFIED', questionTextHindi: null },
    select: { id: true, questionText: true, optionsJson: true, explanation: true },
    take: LIMIT,
  });
  console.log(`[${PROVIDER}] To translate: ${todo.length} (limit ${LIMIT})`);

  let done = 0;
  let failed = 0;
  for (const q of todo) {
    const opts = Array.isArray(q.optionsJson) ? q.optionsJson.map((o) => o.text || '') : [];
    if (opts.length < 4) { failed++; continue; }
    try {
      const raw = await callLLM(PROMPT(q.questionText, opts, q.explanation || ''));
      const parsed = extractJson(raw);
      if (!parsed?.question_hi) { failed++; continue; }
      const optsHi = Array.isArray(parsed.options_hi) && parsed.options_hi.length >= 4
        ? parsed.options_hi
        : null;
      const optionsJson = optsHi
        ? q.optionsJson.map((o, i) => ({ ...o, text: optsHi[i] || o.text }))
        : q.optionsJson;
      if (!DRY) {
        await db.question.update({
          where: { id: q.id },
          data: {
            questionTextHindi: parsed.question_hi,
            optionsJson,
            explanationHindi: parsed.explanation_hi || null,
            translationStatus: 'AUTO_UNVERIFIED',
          },
        });
      }
      done++;
      if (done % 20 === 0) console.log(`  ${done} done...`);
      await sleep(400); // polite rate limit
    } catch (e) {
      failed++;
      if (failed <= 3) console.error(`  FAIL ${q.id}: ${e.message}`);
    }
  }
  console.log(`[${PROVIDER}] Done: ${done} | failed: ${failed}${DRY ? ' (dry-run, nothing written)' : ''}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());