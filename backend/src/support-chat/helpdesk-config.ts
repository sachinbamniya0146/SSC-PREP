// Help desk rules (pure helpers - no Nest / Prisma imports so they can be unit-tested on their own).

export const TICKET_CATEGORIES = ['GENERAL', 'PAYMENT', 'TEST', 'QUESTION', 'ACCOUNT', 'TECHNICAL'] as const;
export const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export function normalizeCategory(raw: unknown): TicketCategory {
  const v = String(raw ?? '').toUpperCase().trim();
  return (TICKET_CATEGORIES as readonly string[]).includes(v) ? (v as TicketCategory) : 'GENERAL';
}

export function normalizePriority(raw: unknown): TicketPriority | null {
  const v = String(raw ?? '').toUpperCase().trim();
  return (TICKET_PRIORITIES as readonly string[]).includes(v) ? (v as TicketPriority) : null;
}

/** Money problems are looked at first. */
export function defaultPriorityFor(category: TicketCategory): TicketPriority {
  return category === 'PAYMENT' ? 'HIGH' : 'NORMAL';
}

export interface CannedReply {
  id: string;
  title: string;
  text: string;
}

export interface HelpdeskConfig {
  /** A student message left unanswered longer than this is flagged "late" in the inbox. */
  slaMinutes: number;
  /** A ticket where staff replied last and the student stayed silent this many days is closed automatically. */
  autoCloseDays: number;
  /** A student can bring a resolved ticket back (just by writing again) for this many days. */
  reopenDays: number;
  canned: CannedReply[];
}

export const HELPDESK_KEY = 'helpdesk.config';

export const DEFAULT_CANNED: CannedReply[] = [
  {
    id: 'payment-pending',
    title: 'Payment pending / not activated',
    text: 'Thanks for reaching out. We are checking your payment now. If the amount was debited, your plan activates automatically within a few minutes (the bank sometimes delays the confirmation). Please send the order id / UTR from your bank SMS if it is still not active after 30 minutes.',
  },
  {
    id: 'refund-policy',
    title: 'Refund policy',
    text: 'Refunds follow our Refund Policy (/refund). A plan can be refunded within 7 days only if you have not used the premium content. If you want to request one, tell us the order id and the reason and we will review it.',
  },
  {
    id: 'wrong-answer',
    title: 'Wrong answer / explanation reported',
    text: 'Thank you for reporting this - it really helps every student. We are verifying the question against the official answer key and will correct it within 24 hours if it is wrong. You will see the fix in the test review.',
  },
  {
    id: 'test-submit',
    title: 'Test did not submit / score missing',
    text: 'Sorry for the trouble. Your answers are saved on our server as you go, so nothing is lost. Please open Results and check the latest attempt. If it is missing, send us the test name and the time you took it and we will recover it.',
  },
  {
    id: 'login',
    title: 'Cannot log in',
    text: 'Please use "Forgot password" on the login page to reset your password. If you signed up with Google, use "Continue with Google". If it still fails, tell us the email you registered with.',
  },
  {
    id: 'thanks-close',
    title: 'Closing - anything else?',
    text: 'Glad we could help! I am marking this ticket as resolved. If you need anything else, just reply here within 7 days and it will reopen.',
  },
];

export const DEFAULT_HELPDESK_CONFIG: HelpdeskConfig = {
  slaMinutes: 120,
  autoCloseDays: 7,
  reopenDays: 7,
  canned: DEFAULT_CANNED,
};

const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback;
};

function cleanCanned(raw: unknown): CannedReply[] {
  if (!Array.isArray(raw)) return DEFAULT_CANNED;
  const out: CannedReply[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const title = typeof o.title === 'string' ? o.title.trim().slice(0, 80) : '';
    const text = typeof o.text === 'string' ? o.text.trim().slice(0, 2000) : '';
    if (!title || !text) continue;
    let id = typeof o.id === 'string' && /^[a-z0-9-]{1,40}$/i.test(o.id) ? o.id : title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'reply';
    while (seen.has(id)) id = `${id}-x`;
    seen.add(id);
    out.push({ id, title, text });
    if (out.length >= 40) break;
  }
  return out;
}

export function mergeHelpdeskConfig(raw: unknown): HelpdeskConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    slaMinutes: num(r.slaMinutes, 5, 10080, DEFAULT_HELPDESK_CONFIG.slaMinutes),
    autoCloseDays: num(r.autoCloseDays, 1, 90, DEFAULT_HELPDESK_CONFIG.autoCloseDays),
    reopenDays: num(r.reopenDays, 0, 90, DEFAULT_HELPDESK_CONFIG.reopenDays),
    canned: r.canned === undefined ? DEFAULT_CANNED : cleanCanned(r.canned),
  };
}

export type HelpdeskValidate = { ok: true; config: HelpdeskConfig } | { ok: false; error: string };

export function validateHelpdeskInput(current: HelpdeskConfig, input: unknown): HelpdeskValidate {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Send the settings as a JSON object.' };
  const r = input as Record<string, unknown>;
  const check = (key: string, min: number, max: number, label: string): string | null => {
    if (r[key] === undefined) return null;
    const n = Number(r[key]);
    return Number.isFinite(n) && n >= min && n <= max ? null : `${label} must be between ${min} and ${max}.`;
  };
  const e1 = check('slaMinutes', 5, 10080, 'Reply target (minutes)');
  const e2 = check('autoCloseDays', 1, 90, 'Auto-close days');
  const e3 = check('reopenDays', 0, 90, 'Reopen days');
  const err = e1 || e2 || e3;
  if (err) return { ok: false, error: err };
  if (r.canned !== undefined) {
    if (!Array.isArray(r.canned)) return { ok: false, error: '"canned" must be a list.' };
    for (const c of r.canned) {
      const o = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
      if (typeof o.title !== 'string' || !o.title.trim() || typeof o.text !== 'string' || !o.text.trim()) {
        return { ok: false, error: 'Every saved reply needs a title and a text.' };
      }
    }
  }
  return { ok: true, config: mergeHelpdeskConfig({ ...current, ...r }) };
}

export interface ConvTimes {
  status: string;
  createdAt: Date | string;
  lastStudentMessageAt?: Date | string | null;
  lastStaffMessageAt?: Date | string | null;
}

const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : 0);

/** Minutes the student has been waiting for an answer, or null when nobody is waiting (resolved / staff replied last). */
export function waitingMinutes(c: ConvTimes, now: number = Date.now()): number | null {
  if (c.status !== 'OPEN') return null;
  const student = ms(c.lastStudentMessageAt);
  if (!student) return null; // ticket exists but the student has not written yet
  if (ms(c.lastStaffMessageAt) >= student) return null;
  return Math.max(0, Math.floor((now - student) / 60000));
}

export type SlaState = 'none' | 'ok' | 'due' | 'late';

/** ok < 50% of the target, due = last half, late = over the target. */
export function slaState(waiting: number | null, slaMinutes: number): SlaState {
  if (waiting == null) return 'none';
  if (waiting > slaMinutes) return 'late';
  if (waiting >= slaMinutes / 2) return 'due';
  return 'ok';
}

export function canReopen(status: string, resolvedAt: Date | string | null | undefined, reopenDays: number, now: number = Date.now()): boolean {
  if (status !== 'RESOLVED') return false;
  if (!resolvedAt) return true;
  return now - ms(resolvedAt) <= reopenDays * 86_400_000;
}

/** Staff replied last and the student has been silent for `days` days. */
export function shouldAutoClose(c: ConvTimes, days: number, now: number = Date.now()): boolean {
  if (c.status !== 'OPEN') return false;
  const staff = ms(c.lastStaffMessageAt);
  if (!staff) return false;
  if (ms(c.lastStudentMessageAt) > staff) return false;
  return now - staff > days * 86_400_000;
}

/** Ticket context sent by the browser: keep a few known keys, short strings only. */
export function cleanContext(raw: unknown): Record<string, string | number> | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const out: Record<string, string | number> = {};
  const str = (k: string, max: number) => {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, max);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  };
  str('page', 200);
  str('attemptId', 80);
  str('orderId', 80);
  str('questionNo', 20);
  str('testTitle', 120);
  if (typeof out.page === 'string' && !out.page.startsWith('/')) delete out.page;
  return Object.keys(out).length ? out : null;
}

export function previewText(s: string, n = 80): string {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Flood guard for students: at most `max` messages inside `windowMs`. */
export function tooManyMessages(recentTimestamps: number[], now: number, max = 8, windowMs = 60_000): boolean {
  return recentTimestamps.filter((t) => now - t < windowMs).length >= max;
}
