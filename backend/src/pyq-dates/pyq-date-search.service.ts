import { Injectable, Logger } from '@nestjs/common';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { decodeEntities, findDateMentions, normText, stripHtml } from './pyq-date.util';

/**
 * Internet search for the PYQ date-mapping worker (NEW Oct 7 2026).
 *
 * Why not "OpenRouter web plugin": OpenRouter's free models cannot browse the internet by themselves,
 * and its web-search plugin is billed per search against account credit (it is NOT free). So the
 * search is done here, for free, by this server; the FREE OpenRouter model then only READS the
 * evidence (titles, snippets and the relevant part of the pages) and extracts the exam date.
 */

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOutcome {
  hits: SearchHit[];
  engine: string | null;
  /** true when every engine failed / was blocked (as opposed to "searched fine, 0 results") */
  failed: boolean;
  error?: string;
}

export interface Evidence {
  text: string; // what the AI reads
  sources: Array<{ url: string; title: string }>;
  hits: number;
  strong: boolean; // the question text itself was found on at least one fetched page
  failed: boolean;
  engine: string | null;
  error?: string;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const SEARCH_GAP_MS = 1300; // be polite: never hammer a search engine
const SEARCH_CACHE_MS = 6 * 3600 * 1000;
const PAGE_CACHE_MS = 12 * 3600 * 1000;
const MAX_PAGE_BYTES = 700 * 1024;
const SKIP_FETCH_HOSTS = ['youtube.com', 'youtu.be', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com', 'pinterest.com', 'play.google.com', 'apps.apple.com', 't.me'];

// ------------------------------- pure parsers (exported for tests) -------------------------------

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? m[1] ?? m[2] ?? '' : null;
}

/** Unwraps search-engine redirect links (duckduckgo /l/?uddg=..., bing /ck/a?u=a1<base64>). */
export function cleanResultUrl(href: string): string | null {
  let h = decodeEntities(String(href || '').trim());
  if (!h) return null;
  if (h.startsWith('//')) h = `https:${h}`;
  try {
    const u = new URL(h, 'https://duckduckgo.com');
    if (/duckduckgo\.com$/i.test(u.hostname) && u.pathname.startsWith('/l/')) {
      const real = u.searchParams.get('uddg');
      return real ? cleanResultUrl(real) : null;
    }
    if (/(^|\.)bing\.com$/i.test(u.hostname) && u.pathname.startsWith('/ck/')) {
      const enc = u.searchParams.get('u');
      if (enc && enc.length > 2) {
        const b64 = enc.slice(2).replace(/-/g, '+').replace(/_/g, '/');
        const decoded = Buffer.from(b64, 'base64').toString('utf8');
        return /^https?:\/\//i.test(decoded) ? decoded : null;
      }
      return null;
    }
    if (!/^https?:$/i.test(u.protocol)) return null;
    if (/(^|\.)(duckduckgo|bing)\.com$/i.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function parseDdgHtml(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const anchors = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)];
  const titleIdx: Array<{ i: number; tag: string; inner: string; end: number }> = [];
  const snipIdx: Array<{ i: number; inner: string }> = [];
  for (const a of anchors) {
    const full = a[0];
    const openEnd = full.indexOf('>');
    const tag = full.slice(0, openEnd + 1);
    const cls = attr(tag, 'class') || '';
    const inner = full.slice(openEnd + 1, full.length - 4);
    if (/\bresult__a\b/.test(cls)) titleIdx.push({ i: a.index ?? 0, tag, inner, end: (a.index ?? 0) + full.length });
    else if (/\bresult__snippet\b/.test(cls)) snipIdx.push({ i: a.index ?? 0, inner });
  }
  // snippets can also be <div|td class="result__snippet">
  for (const m of html.matchAll(/<(?:div|td|span)\b[^>]*class\s*=\s*["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|td|span)>/gi)) {
    snipIdx.push({ i: m.index ?? 0, inner: m[1] });
  }
  snipIdx.sort((a, b) => a.i - b.i);
  for (let n = 0; n < titleIdx.length; n++) {
    const t = titleIdx[n];
    const url = cleanResultUrl(attr(t.tag, 'href') || '');
    if (!url) continue;
    const nextStart = n + 1 < titleIdx.length ? titleIdx[n + 1].i : Infinity;
    const sn = snipIdx.find((s) => s.i > t.i && s.i < nextStart);
    hits.push({ title: stripHtml(t.inner).slice(0, 200), url, snippet: sn ? stripHtml(sn.inner).slice(0, 500) : '' });
  }
  return hits;
}

export function parseDdgLite(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const links: Array<{ i: number; url: string; title: string }> = [];
  for (const a of html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    const full = a[0];
    const openEnd = full.indexOf('>');
    const tag = full.slice(0, openEnd + 1);
    const cls = attr(tag, 'class') || '';
    if (!/result-link/.test(cls)) continue;
    const url = cleanResultUrl(attr(tag, 'href') || '');
    if (url) links.push({ i: a.index ?? 0, url, title: stripHtml(full.slice(openEnd + 1, full.length - 4)).slice(0, 200) });
  }
  const snippets = [...html.matchAll(/<td\b[^>]*class\s*=\s*["'][^"']*result-snippet[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi)].map((m) => ({ i: m.index ?? 0, text: stripHtml(m[1]).slice(0, 500) }));
  for (let n = 0; n < links.length; n++) {
    const nextStart = n + 1 < links.length ? links[n + 1].i : Infinity;
    const sn = snippets.find((s) => s.i > links[n].i && s.i < nextStart);
    hits.push({ title: links[n].title, url: links[n].url, snippet: sn?.text ?? '' });
  }
  return hits;
}

export function parseBing(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const blocks = html.split(/<li\b[^>]*class\s*=\s*["'][^"']*\bb_algo\b[^"']*["'][^>]*>/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/li>/i)[0];
    const h2 = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(block);
    if (!h2) continue;
    const a = /<a\b[^>]*>[\s\S]*?<\/a>/i.exec(h2[1]);
    if (!a) continue;
    const tag = a[0].slice(0, a[0].indexOf('>') + 1);
    const url = cleanResultUrl(attr(tag, 'href') || '');
    if (!url) continue;
    const title = stripHtml(a[0]).slice(0, 200);
    const p = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    hits.push({ title, url, snippet: p ? stripHtml(p[1]).slice(0, 500) : '' });
  }
  return hits;
}

/** true when the engine answered with a bot-check page instead of results */
export function looksBlocked(html: string): boolean {
  const t = html.slice(0, 6000).toLowerCase();
  return t.includes('anomaly') || t.includes('captcha') || t.includes('unusual traffic') || t.includes('are you a human') || t.includes('challenge-form');
}

/** public-internet check so a hostile search result can never make the server call its own network */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
  if (isIP(h) === 4) {
    const [a, b] = h.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (isIP(h) === 6) {
    return h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h.startsWith('::ffff:');
  }
  return false;
}

export function pageToText(html: string): { title: string; text: string } {
  const title = stripHtml((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '').slice(0, 200);
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|footer|form|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|br|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  const text = decodeEntities(body.replace(/<[^>]*>/g, ' '))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
  return { title, text };
}

/**
 * Finds the question inside the page text and returns what is around it: the page head, the text near
 * the question and the date mention that stands closest BEFORE the question (SSC PYQ pages normally
 * print "12 Sep 2025 Shift 1" as a heading above the questions).
 */
export function extractPageEvidence(text: string, questionKey: string, budget = 2200): { block: string; matched: boolean } {
  const head = text.slice(0, 450).replace(/\s+/g, ' ');
  // normalised copy with an index map back to the original text
  const norm: string[] = [];
  const map: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i].toLowerCase();
    if (/[\p{L}\p{N}]/u.test(ch)) {
      norm.push(ch);
      map.push(i);
      lastSpace = false;
    } else if (!lastSpace) {
      norm.push(' ');
      map.push(i);
      lastSpace = true;
    }
  }
  const hay = norm.join('');
  const tryKeys = [questionKey, questionKey.split(' ').slice(0, 7).join(' '), questionKey.split(' ').slice(-6).join(' ')].filter((k) => k.length >= 18);
  let at = -1;
  for (const k of tryKeys) {
    at = hay.indexOf(k);
    if (at >= 0) break;
  }
  if (at < 0) {
    // no match: head + the few date mentions that sit near typical exam keywords
    const near = findDateMentions(text.slice(0, 20000), 30)
      .filter((d) => /shift|exam|held|conducted|paper|cgl|chsl|cpo|mts|gd/i.test(text.slice(Math.max(0, d.index - 80), d.index + 80)))
      .slice(0, 3)
      .map((d) => text.slice(Math.max(0, d.index - 90), d.index + 70).replace(/\s+/g, ' '));
    return { block: [`HEAD: ${head}`, ...near.map((n) => `DATE_CONTEXT: ${n}`)].join('\n').slice(0, budget), matched: false };
  }
  const pos = map[Math.min(at, map.length - 1)];
  const before = text.slice(Math.max(0, pos - 1500), pos);
  const around = text.slice(Math.max(0, pos - 300), pos + 350).replace(/\s+/g, ' ');
  const mentions = findDateMentions(text.slice(0, pos), 800);
  const closest = mentions.length ? mentions[mentions.length - 1] : null;
  const closestCtx = closest ? text.slice(Math.max(0, closest.index - 110), closest.index + closest.raw.length + 90).replace(/\s+/g, ' ') : '';
  const beforeDates = findDateMentions(before, 20)
    .slice(-3)
    .map((d) => before.slice(Math.max(0, d.index - 70), d.index + d.raw.length + 50).replace(/\s+/g, ' '));
  const parts = [`HEAD: ${head}`, 'QUESTION_FOUND_ON_THIS_PAGE: YES', `NEAR_QUESTION: ${around}`];
  if (closestCtx) parts.push(`NEAREST_DATE_ABOVE_QUESTION: ${closestCtx}`);
  for (const b of beforeDates) parts.push(`DATE_CONTEXT: ${b}`);
  return { block: parts.join('\n').slice(0, budget), matched: true };
}

// ------------------------------- service -------------------------------

@Injectable()
export class PyqDateSearchService {
  private readonly logger = new Logger(PyqDateSearchService.name);
  private readonly searchCache = new Map<string, { at: number; out: SearchOutcome }>();
  private readonly pageCache = new Map<string, { at: number; title: string; text: string | null }>();
  private chain: Promise<unknown> = Promise.resolve();
  private lastSearchAt = 0;

  /** one search at a time, with a pause between searches (shared by every pass of every question) */
  private schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const wait = this.lastSearchAt + SEARCH_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        return await fn();
      } finally {
        this.lastSearchAt = Date.now();
      }
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async fetchText(url: string, init: RequestInit, timeoutMs = 12000): Promise<{ status: number; text: string }> {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': UA, 'Accept-Language': 'en-IN,en;q=0.9,hi;q=0.6', ...(init.headers as Record<string, string> | undefined) } });
    const text = await res.text();
    return { status: res.status, text };
  }

  /** web search with fallbacks: DuckDuckGo html -> DuckDuckGo lite -> Bing */
  async search(query: string): Promise<SearchOutcome> {
    const key = query.toLowerCase();
    const cached = this.searchCache.get(key);
    if (cached && Date.now() - cached.at < SEARCH_CACHE_MS) return cached.out;

    const out = await this.schedule(async (): Promise<SearchOutcome> => {
      const errors: string[] = [];
      const engines: Array<{ name: string; run: () => Promise<SearchHit[]> }> = [
        {
          name: 'duckduckgo',
          run: async () => {
            const r = await this.fetchText('https://html.duckduckgo.com/html/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ q: query, kl: 'in-en' }).toString() });
            if (r.status !== 200 || looksBlocked(r.text)) throw new Error(`blocked/${r.status}`);
            return parseDdgHtml(r.text);
          },
        },
        {
          name: 'duckduckgo-lite',
          run: async () => {
            const r = await this.fetchText('https://lite.duckduckgo.com/lite/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ q: query, kl: 'in-en' }).toString() });
            if (r.status !== 200 || looksBlocked(r.text)) throw new Error(`blocked/${r.status}`);
            return parseDdgLite(r.text);
          },
        },
        {
          name: 'bing',
          run: async () => {
            const r = await this.fetchText(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en&cc=IN`, { method: 'GET' });
            if (r.status !== 200 || looksBlocked(r.text)) throw new Error(`blocked/${r.status}`);
            return parseBing(r.text);
          },
        },
      ];
      for (const e of engines) {
        try {
          const hits = await e.run();
          if (hits.length > 0) return { hits: hits.slice(0, 8), engine: e.name, failed: false };
          errors.push(`${e.name}: 0 results`);
        } catch (err) {
          errors.push(`${e.name}: ${(err as Error)?.message || 'error'}`);
        }
      }
      const allZero = errors.every((x) => x.endsWith('0 results'));
      return { hits: [], engine: null, failed: !allZero, error: errors.join(' | ') };
    });

    if (!out.failed) {
      this.searchCache.set(key, { at: Date.now(), out });
      if (this.searchCache.size > 400) this.searchCache.delete(this.searchCache.keys().next().value as string);
    } else {
      this.logger.warn(`Search failed for "${query.slice(0, 60)}": ${out.error}`);
    }
    return out;
  }

  private async safeUrl(url: string): Promise<boolean> {
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return false;
      if (isPrivateHost(u.hostname)) return false;
      if (SKIP_FETCH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) return false;
      if (/\.(pdf|docx?|xlsx?|pptx?|zip|rar|jpe?g|png|gif|webp|mp4|mp3)(\?|$)/i.test(u.pathname)) return false;
      if (!isIP(u.hostname)) {
        const addrs = await lookup(u.hostname, { all: true });
        if (addrs.length === 0 || addrs.some((a) => isPrivateHost(a.address))) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private async fetchPage(url: string): Promise<{ title: string; text: string } | null> {
    const cached = this.pageCache.get(url);
    if (cached && Date.now() - cached.at < PAGE_CACHE_MS) return cached.text ? { title: cached.title, text: cached.text } : null;
    let result: { title: string; text: string } | null = null;
    try {
      if (await this.safeUrl(url)) {
        const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(9000), headers: { 'User-Agent': UA, 'Accept-Language': 'en-IN,en;q=0.9', Accept: 'text/html,application/xhtml+xml' } });
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        const finalHost = (() => {
          try {
            return new URL(res.url || url).hostname;
          } catch {
            return '';
          }
        })();
        if (res.ok && (ct.includes('text/html') || ct.includes('text/plain') || ct === '') && !isPrivateHost(finalHost) && res.body) {
          const reader = res.body.getReader();
          const chunks: Buffer[] = [];
          let size = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done || !value) break;
            size += value.length;
            chunks.push(Buffer.from(value));
            if (size >= MAX_PAGE_BYTES) {
              await reader.cancel().catch(() => undefined);
              break;
            }
          }
          const parsed = pageToText(Buffer.concat(chunks).toString('utf8'));
          if (parsed.text.length > 200) result = parsed;
        }
      }
    } catch {
      result = null;
    }
    this.pageCache.set(url, { at: Date.now(), title: result?.title ?? '', text: result?.text ?? null });
    if (this.pageCache.size > 200) this.pageCache.delete(this.pageCache.keys().next().value as string);
    return result;
  }

  /**
   * Search + read the top pages -> one evidence text for the AI.
   * `questionKey` is the normalised first words of the question (used to find it inside pages).
   */
  async gather(query: string, questionKey: string, opts: { maxPages?: number; budget?: number } = {}): Promise<Evidence> {
    const out = await this.search(query);
    if (out.hits.length === 0) {
      return { text: '', sources: [], hits: 0, strong: false, failed: out.failed, engine: out.engine, error: out.error };
    }
    const budget = opts.budget ?? 7000;
    const maxPages = opts.maxPages ?? 3;
    const toFetch = out.hits.slice(0, Math.max(maxPages + 2, 5)).filter((h) => !SKIP_FETCH_HOSTS.some((s) => h.url.includes(s)));
    const pages = new Map<string, { title: string; text: string } | null>();
    const selected = toFetch.slice(0, maxPages);
    await Promise.all(selected.map(async (h) => pages.set(h.url, await this.fetchPage(h.url))));

    let strong = false;
    const sections: string[] = [];
    const sources: Array<{ url: string; title: string }> = [];
    out.hits.forEach((h, i) => {
      const idx = i + 1;
      let sec = `[${idx}] URL: ${h.url}\nTITLE: ${h.title}\nSNIPPET: ${h.snippet}`;
      const page = pages.get(h.url);
      if (page) {
        const ev = extractPageEvidence(page.text, questionKey);
        if (ev.matched) strong = true;
        sec += `\n${ev.block}`;
      }
      sections.push(sec);
      sources.push({ url: h.url, title: h.title });
    });
    // matched pages first, then everything else, cut to the budget
    sections.sort((a, b) => Number(b.includes('QUESTION_FOUND_ON_THIS_PAGE: YES')) - Number(a.includes('QUESTION_FOUND_ON_THIS_PAGE: YES')));
    let text = '';
    for (const s of sections) {
      if (text.length + s.length + 2 > budget) {
        const left = budget - text.length - 2;
        if (left > 300) text += `${s.slice(0, left)}\n\n`;
        break;
      }
      text += `${s}\n\n`;
    }
    return { text: text.trim(), sources, hits: out.hits.length, strong, failed: false, engine: out.engine };
  }

  /** admin "Test search" button: shows what the server can reach, without using any AI key */
  async diagnose(query: string) {
    const out = await this.search(query);
    return { engine: out.engine, failed: out.failed, error: out.error ?? null, count: out.hits.length, hits: out.hits.slice(0, 6), normalizedQuery: normText(query) };
  }
}
