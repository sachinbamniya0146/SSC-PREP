// Feature controller: every on/off switch the admin can flip without a deploy.
// Pure helpers (no Nest / Prisma imports) so the rules can be unit-tested on their own.

export type FlagGroup = 'student' | 'business';

export interface FlagDef {
  key: string;
  label: string;
  hint: string;
  group: FlagGroup;
  default: boolean;
  /** true = the API itself refuses when off. false = only the screens hide it. */
  server: boolean;
}

/** The registry. Adding a flag = one line here; the admin page, the public API and the validator all follow. */
export const FLAG_DEFS: FlagDef[] = [
  { key: 'signup', label: 'New registrations', hint: 'Off = signup is closed (existing students still log in).', group: 'business', default: true, server: true },
  { key: 'purchases', label: 'Buying plans', hint: 'Off = checkout is paused (use during a payment-gateway problem).', group: 'business', default: true, server: true },
  { key: 'referral', label: 'Refer & Earn', hint: 'Off = the Refer & Earn page and invite links are hidden.', group: 'business', default: true, server: false },
  { key: 'helpDesk', label: 'Help desk', hint: 'Off = students cannot open new tickets (open ones can still be answered).', group: 'student', default: true, server: true },
  { key: 'bookmarks', label: 'Question bookmarks', hint: 'The star on every question, in tests and in the review.', group: 'student', default: true, server: true },
  { key: 'leaderboard', label: 'Leaderboard', hint: 'XP leaderboard page and the per-test toppers list.', group: 'student', default: true, server: true },
  { key: 'stateRank', label: 'State rank', hint: 'Rank among students of the same state on the result page.', group: 'student', default: true, server: false },
  { key: 'vocabulary', label: 'Vocabulary', hint: 'Daily vocabulary hub.', group: 'student', default: true, server: false },
  { key: 'studyPlan', label: 'Study plan', hint: 'Study plan board and daily targets.', group: 'student', default: true, server: false },
  { key: 'dailyGoal', label: 'Daily goal bar', hint: 'Daily questions goal on the dashboard.', group: 'student', default: true, server: false },
  { key: 'celebrations', label: 'Purchase celebration', hint: 'Gift + confetti after a successful payment.', group: 'student', default: true, server: false },
];

export type AnnouncementLevel = 'info' | 'warn' | 'danger';

export interface Announcement {
  enabled: boolean;
  text: string;
  level: AnnouncementLevel;
  link: string;
  linkLabel: string;
  /** ISO string or '' (= never expires). */
  expiresAt: string;
}

export interface FeatureState {
  flags: Record<string, boolean>;
  announcement: Announcement;
}

export const FEATURES_KEY = 'features.config';

export const DEFAULT_ANNOUNCEMENT: Announcement = {
  enabled: false,
  text: '',
  level: 'info',
  link: '',
  linkLabel: '',
  expiresAt: '',
};

export function defaultFlags(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const d of FLAG_DEFS) out[d.key] = d.default;
  return out;
}

export const DEFAULT_FEATURE_STATE: FeatureState = {
  flags: defaultFlags(),
  announcement: { ...DEFAULT_ANNOUNCEMENT },
};

const LEVELS: AnnouncementLevel[] = ['info', 'warn', 'danger'];
const MAX_TEXT = 300;

function cleanAnnouncement(raw: unknown): Announcement {
  const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const level = LEVELS.includes(a.level as AnnouncementLevel) ? (a.level as AnnouncementLevel) : 'info';
  const text = typeof a.text === 'string' ? a.text.trim().slice(0, MAX_TEXT) : '';
  const link = typeof a.link === 'string' ? a.link.trim().slice(0, 300) : '';
  const linkLabel = typeof a.linkLabel === 'string' ? a.linkLabel.trim().slice(0, 40) : '';
  let expiresAt = '';
  if (typeof a.expiresAt === 'string' && a.expiresAt.trim()) {
    const t = Date.parse(a.expiresAt);
    expiresAt = Number.isNaN(t) ? '' : new Date(t).toISOString();
  }
  return { enabled: a.enabled === true && text.length > 0, text, level, link: isSafeLink(link) ? link : '', linkLabel, expiresAt };
}

/** Only same-site paths or https links: a javascript: / data: link in a banner would be an XSS hole. */
export function isSafeLink(link: string): boolean {
  if (!link) return true;
  if (link.startsWith('/') && !link.startsWith('//')) return true;
  return /^https:\/\/[^\s]+$/i.test(link);
}

/** Stored JSON -> full state. Unknown flags are dropped, missing ones fall back to their default (so a new flag is on/off as declared). */
export function mergeFeatureState(raw: unknown): FeatureState {
  const base = defaultFlags();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const stored = (r.flags && typeof r.flags === 'object' ? r.flags : {}) as Record<string, unknown>;
  for (const d of FLAG_DEFS) {
    if (typeof stored[d.key] === 'boolean') base[d.key] = stored[d.key] as boolean;
  }
  return { flags: base, announcement: cleanAnnouncement(r.announcement) };
}

export type ValidateResult = { ok: true; state: FeatureState } | { ok: false; error: string };

/** Admin input applied on top of the CURRENT state (send only what changed). Unknown flag names are an error (a typo must not silently do nothing). */
export function applyFeatureInput(current: FeatureState, input: unknown): ValidateResult {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Send the settings as a JSON object.' };
  const r = input as Record<string, unknown>;
  const known = new Set(FLAG_DEFS.map((d) => d.key));
  if (r.flags !== undefined) {
    if (!r.flags || typeof r.flags !== 'object') return { ok: false, error: '"flags" must be an object.' };
    for (const [k, v] of Object.entries(r.flags as Record<string, unknown>)) {
      if (!known.has(k)) return { ok: false, error: `Unknown feature "${k}".` };
      if (typeof v !== 'boolean') return { ok: false, error: `"${k}" must be true or false.` };
    }
  }
  if (r.announcement !== undefined && (typeof r.announcement !== 'object' || r.announcement === null)) {
    return { ok: false, error: '"announcement" must be an object.' };
  }
  const ann = r.announcement as Record<string, unknown> | undefined;
  if (ann) {
    if (typeof ann.text === 'string' && ann.text.trim().length > MAX_TEXT) return { ok: false, error: `Announcement is too long (max ${MAX_TEXT} characters).` };
    if (typeof ann.link === 'string' && ann.link.trim() && !isSafeLink(ann.link.trim())) {
      return { ok: false, error: 'Announcement link must start with / or https://' };
    }
    // The text that will really be stored: the one sent now, else the one already saved (so "just turn it on" works).
    const finalText = typeof ann.text === 'string' ? ann.text.trim() : current.announcement.text.trim();
    if (ann.enabled === true && !finalText) {
      return { ok: false, error: 'Write the announcement text before turning it on.' };
    }
    if (typeof ann.expiresAt === 'string' && ann.expiresAt.trim() && Number.isNaN(Date.parse(ann.expiresAt))) {
      return { ok: false, error: 'Announcement expiry date is not valid.' };
    }
  }
  const flags = { ...current.flags, ...((r.flags as Record<string, boolean> | undefined) ?? {}) };
  const announcement = ann ? cleanAnnouncement({ ...current.announcement, ...ann }) : current.announcement;
  return { ok: true, state: { flags, announcement } };
}

/** What a student's browser may see: expired announcements are removed on the server so every device agrees. */
export function publicView(state: FeatureState, now: number = Date.now()): FeatureState {
  const a = state.announcement;
  const expired = a.expiresAt ? Date.parse(a.expiresAt) <= now : false;
  return { flags: state.flags, announcement: expired || !a.enabled ? { ...DEFAULT_ANNOUNCEMENT } : a };
}
