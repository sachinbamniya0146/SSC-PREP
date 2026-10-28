import { decideAuto, mergeAutoPublish, pushRun, recency, validateAutoPublish } from './auto-publish.util';

const live = (year: number | null = 2025, examDate: string | null = null) => ({ year, examDate, live: true });

describe('auto-publish rules', () => {
  it('same question in another paper (shift / date / year) is kept in BOTH papers', () => {
    const d = decideAuto({ matchType: 'SIMILAR', differences: ['shift', 'examDate'], existing: live(2024), candidate: live(2025), includeSimilar: false });
    expect(d?.action).toBe('KEEP_BOTH');
  });

  it('a different paper with a changed answer is a real conflict: a person decides', () => {
    expect(decideAuto({ matchType: 'SIMILAR', differences: ['shift', 'correctAnswer'], existing: live(), candidate: live(), includeSimilar: true })).toBeNull();
    expect(decideAuto({ matchType: 'SIMILAR', differences: ['year', 'options'], existing: live(), candidate: live(), includeSimilar: true })).toBeNull();
  });

  it('an identical copy keeps the existing question (students keep their bookmarks and history)', () => {
    expect(decideAuto({ matchType: 'EXACT', differences: [], existing: live(), candidate: live(), includeSimilar: false })?.action).toBe('KEEP_EXISTING');
  });

  it('if the old copy is not live, the new one is published', () => {
    expect(decideAuto({ matchType: 'EXACT', differences: [], existing: { year: 2024, examDate: null, live: false }, candidate: live(), includeSimilar: false })?.action).toBe('KEEP_NEW');
    expect(decideAuto({ matchType: 'EXACT', differences: [], existing: null, candidate: live(), includeSimilar: false })?.action).toBe('KEEP_NEW');
  });

  it('similar copies are left to a person unless the admin allowed it - and never when the question or answer differs', () => {
    expect(decideAuto({ matchType: 'SIMILAR', differences: ['explanation'], existing: live(), candidate: live(), includeSimilar: false })).toBeNull();
    expect(decideAuto({ matchType: 'SIMILAR', differences: ['explanation'], existing: live(), candidate: live(), includeSimilar: true })?.action).toBe('KEEP_NEW');
    expect(decideAuto({ matchType: 'SIMILAR', differences: ['explanation', 'correctAnswer'], existing: live(), candidate: live(), includeSimilar: true })).toBeNull();
    expect(decideAuto({ matchType: 'SIMILAR', differences: ['questionText'], existing: live(), candidate: live(), includeSimilar: true })).toBeNull();
  });

  it('a better solution on an OLDER paper does not replace a newer paper question', () => {
    const d = decideAuto({ matchType: 'SIMILAR', differences: ['explanation'], existing: live(2025), candidate: live(2022), includeSimilar: true });
    expect(d?.action).toBe('KEEP_EXISTING');
  });

  it('recency compares exam date first, then year', () => {
    expect(recency({ year: 2025, examDate: '2025-09-01' }, { year: 2025, examDate: '2025-08-01' })).toBe(1);
    expect(recency({ year: 2023, examDate: null }, { year: 2024, examDate: null })).toBe(-1);
    expect(recency({ year: null, examDate: null }, { year: 2024, examDate: null })).toBe(0);
  });

  it('settings and run log', () => {
    expect(mergeAutoPublish(null)).toEqual({ enabled: true, afterHours: 24, includeSimilar: false });
    const cur = mergeAutoPublish(null);
    expect(validateAutoPublish(cur, { afterHours: 500 }).ok).toBe(false);
    expect(validateAutoPublish(cur, { enabled: 'yes' }).ok).toBe(false);
    const ok = validateAutoPublish(cur, { afterHours: 6 });
    expect(ok.ok && ok.config.afterHours).toBe(6);
    let log: any[] = [];
    for (let i = 0; i < 25; i++) log = pushRun(log, { at: String(i), trigger: 'auto', keptNew: 0, keptExisting: 0, keptBoth: 0, needsHuman: 0, failed: 0 });
    expect(log.length).toBe(20);
    expect(log[0].at).toBe('24');
  });
});
