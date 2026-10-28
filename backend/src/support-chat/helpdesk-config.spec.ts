import {
  DEFAULT_HELPDESK_CONFIG,
  canReopen,
  cleanContext,
  defaultPriorityFor,
  mergeHelpdeskConfig,
  normalizeCategory,
  normalizePriority,
  shouldAutoClose,
  slaState,
  tooManyMessages,
  validateHelpdeskInput,
  waitingMinutes,
} from './helpdesk-config';

const NOW = Date.parse('2026-10-29T12:00:00Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe('help desk rules', () => {
  it('categories and priorities fall back safely', () => {
    expect(normalizeCategory('payment')).toBe('PAYMENT');
    expect(normalizeCategory('nonsense')).toBe('GENERAL');
    expect(normalizePriority('urgent')).toBe('URGENT');
    expect(normalizePriority('x')).toBeNull();
    expect(defaultPriorityFor('PAYMENT')).toBe('HIGH');
    expect(defaultPriorityFor('TEST')).toBe('NORMAL');
  });

  it('waiting time: only when the student wrote last on an OPEN ticket', () => {
    expect(waitingMinutes({ status: 'OPEN', createdAt: ago(100), lastStudentMessageAt: ago(30), lastStaffMessageAt: null }, NOW)).toBe(30);
    expect(waitingMinutes({ status: 'OPEN', createdAt: ago(100), lastStudentMessageAt: ago(30), lastStaffMessageAt: ago(10) }, NOW)).toBeNull();
    expect(waitingMinutes({ status: 'OPEN', createdAt: ago(100), lastStudentMessageAt: ago(5), lastStaffMessageAt: ago(50) }, NOW)).toBe(5);
    expect(waitingMinutes({ status: 'RESOLVED', createdAt: ago(100), lastStudentMessageAt: ago(30) }, NOW)).toBeNull();
    expect(waitingMinutes({ status: 'OPEN', createdAt: ago(100) }, NOW)).toBeNull();
  });

  it('reply-target state', () => {
    expect(slaState(null, 120)).toBe('none');
    expect(slaState(10, 120)).toBe('ok');
    expect(slaState(60, 120)).toBe('due');
    expect(slaState(121, 120)).toBe('late');
  });

  it('reopen window', () => {
    expect(canReopen('RESOLVED', ago(60 * 24 * 2), 7, NOW)).toBe(true);
    expect(canReopen('RESOLVED', ago(60 * 24 * 8), 7, NOW)).toBe(false);
    expect(canReopen('OPEN', ago(10), 7, NOW)).toBe(false);
    expect(canReopen('RESOLVED', ago(10), 0, NOW)).toBe(false);
  });

  it('auto-close: staff replied last and the student stayed silent', () => {
    const day = 60 * 24;
    expect(shouldAutoClose({ status: 'OPEN', createdAt: ago(20 * day), lastStudentMessageAt: ago(10 * day), lastStaffMessageAt: ago(8 * day) }, 7, NOW)).toBe(true);
    expect(shouldAutoClose({ status: 'OPEN', createdAt: ago(20 * day), lastStudentMessageAt: ago(1 * day), lastStaffMessageAt: ago(8 * day) }, 7, NOW)).toBe(false); // student wrote after
    expect(shouldAutoClose({ status: 'OPEN', createdAt: ago(20 * day), lastStudentMessageAt: ago(10 * day), lastStaffMessageAt: ago(2 * day) }, 7, NOW)).toBe(false); // too recent
    expect(shouldAutoClose({ status: 'OPEN', createdAt: ago(20 * day), lastStudentMessageAt: ago(10 * day) }, 7, NOW)).toBe(false); // staff never answered
  });

  it('context: keeps known keys, trims, drops a page that is not a path', () => {
    expect(cleanContext({ page: '/results/abc', attemptId: 'a1', evil: 'x' })).toEqual({ page: '/results/abc', attemptId: 'a1' });
    expect(cleanContext({ page: 'http://evil.com' })).toBeNull();
    expect(cleanContext(null)).toBeNull();
    expect(cleanContext({ questionNo: 4521 })).toEqual({ questionNo: 4521 });
  });

  it('flood guard', () => {
    const base = NOW;
    expect(tooManyMessages([base - 1000, base - 2000], base)).toBe(false);
    expect(tooManyMessages(Array.from({ length: 8 }, (_, i) => base - i * 1000), base)).toBe(true);
    expect(tooManyMessages(Array.from({ length: 8 }, (_, i) => base - 61_000 - i), base)).toBe(false);
  });

  it('settings: defaults, range checks, saved replies need a title and text', () => {
    expect(mergeHelpdeskConfig(null).slaMinutes).toBe(DEFAULT_HELPDESK_CONFIG.slaMinutes);
    expect(mergeHelpdeskConfig({ slaMinutes: 99999 }).slaMinutes).toBe(DEFAULT_HELPDESK_CONFIG.slaMinutes);
    const cur = mergeHelpdeskConfig(null);
    expect(validateHelpdeskInput(cur, { slaMinutes: 1 }).ok).toBe(false);
    expect(validateHelpdeskInput(cur, { canned: [{ title: 'x', text: '' }] }).ok).toBe(false);
    const ok = validateHelpdeskInput(cur, { slaMinutes: 60, canned: [{ title: 'Hello', text: 'Hi there' }, { title: 'Hello', text: 'Again' }] });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.config.slaMinutes).toBe(60);
      expect(ok.config.autoCloseDays).toBe(cur.autoCloseDays); // untouched
      expect(new Set(ok.config.canned.map((c) => c.id)).size).toBe(2); // same title -> still unique ids
    }
  });
});
