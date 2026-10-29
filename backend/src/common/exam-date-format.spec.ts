import { parseExamDate, dmyToIso, isoToDmy, tryParseExamDate } from './exam-date-format';
import { buildUpdateBody, examDateValidation, buildDataValidationsXml } from '../bank/bank-template';

const NOW = Date.UTC(2026, 9, 30); // 30 Oct 2026

describe('parseExamDate - DD/MM/YYYY is the ONLY accepted format', () => {
  it('accepts DD/MM/YYYY and returns the stored YYYY-MM-DD', () => {
    expect(parseExamDate('12/09/2025', NOW)).toBe('2025-09-12');
    expect(parseExamDate(' 01/01/2024 ', NOW)).toBe('2024-01-01');
    expect(parseExamDate('29/02/2024', NOW)).toBe('2024-02-29'); // leap day
    expect(parseExamDate('05/06/2025', NOW)).toBe('2025-06-05'); // day first: 5 June, never 6 May
  });
  it('blank is allowed (practice row)', () => {
    expect(parseExamDate('', NOW)).toBeUndefined();
    expect(parseExamDate('   ', NOW)).toBeUndefined();
    expect(parseExamDate(undefined, NOW)).toBeUndefined();
    expect(parseExamDate(null, NOW)).toBeUndefined();
  });
  it.each([
    '2025-09-12', '12-09-2025', '12.09.2025', '12 Sep 2025', 'September 12, 2025', '5/6/2025', '5/06/2025', '05/6/2025',
    '12/09/25', '12/9/2025', '2025/09/12', '12/09/2025 10:00', '12/09', '12092025', '45912', '45912.0', 'abc',
  ])('rejects %s', (v: string) => {
    expect(() => parseExamDate(v, NOW)).toThrow(/DD\/MM\/YYYY/);
  });
  it('rejects days that do not exist', () => {
    expect(() => parseExamDate('31/04/2025', NOW)).toThrow(/does not exist/);
    expect(() => parseExamDate('29/02/2025', NOW)).toThrow(/does not exist/);
    expect(() => parseExamDate('00/01/2025', NOW)).toThrow();
    expect(() => parseExamDate('12/13/2025', NOW)).toThrow(); // month 13 = the classic US-order mistake
    expect(() => parseExamDate('12/09/1999', NOW)).toThrow();
  });
  it('rejects a date in the future but allows today and tomorrow (IST tolerance)', () => {
    expect(() => parseExamDate('02/11/2026', NOW)).toThrow(/future/);
    expect(parseExamDate('30/10/2026', NOW)).toBe('2026-10-30');
    expect(parseExamDate('31/10/2026', NOW)).toBe('2026-10-31');
  });
  it('tells the admin what to write when the wrong text is unambiguous', () => {
    expect(() => parseExamDate('2025-09-12', NOW)).toThrow(/Write 12\/09\/2025 instead/);
    expect(() => parseExamDate('12-09-2025', NOW)).toThrow(/Write 12\/09\/2025 instead/);
    expect(() => parseExamDate('3 Mar 2025', NOW)).toThrow(/Write 03\/03\/2025 instead/);
  });
  it('never guesses an ambiguous single-digit date', () => {
    try { parseExamDate('5/6/2025', NOW); throw new Error('should have thrown'); } catch (e) { expect(String((e as Error).message)).not.toMatch(/instead/); }
  });
  it('explains an Excel date value (number or Date object)', () => {
    expect(() => parseExamDate('45912', NOW)).toThrow(/Excel date VALUE/);
    expect(() => parseExamDate(new Date(), NOW)).toThrow(/Format the examDate column as Text/);
  });
  it('tryParseExamDate never throws', () => {
    expect(tryParseExamDate('12/09/2025', NOW)).toBe('2025-09-12');
    expect(tryParseExamDate('2025-09-12', NOW)).toBeNull();
    expect(tryParseExamDate('', NOW)).toBeNull();
  });
});

describe('dmyToIso / isoToDmy', () => {
  it('round trip', () => {
    expect(isoToDmy('2025-09-12')).toBe('12/09/2025');
    expect(dmyToIso('12/09/2025')).toBe('2025-09-12');
    expect(dmyToIso(isoToDmy('2024-02-29'))).toBe('2024-02-29');
  });
  it('junk gives empty / null', () => {
    expect(isoToDmy(null)).toBe('');
    expect(isoToDmy('12/09/2025')).toBe('');
    expect(dmyToIso('2025-09-12')).toBeNull();
  });
});

describe('bulk-update sheet (edit by ID)', () => {
  const headerMap = { examDate: 0 } as Record<string, number>;
  it('valid DD/MM/YYYY becomes the stored date', () => {
    const r = buildUpdateBody(headerMap, ['12/09/2025'], [], false);
    expect(r.problems).toEqual([]);
    expect(r.body.examDate).toBe('2025-09-12');
  });
  it('anything else is a problem and is not sent', () => {
    const r = buildUpdateBody(headerMap, ['2025-09-12'], [], false);
    expect(r.problems.join(' ')).toMatch(/DD\/MM\/YYYY/);
    expect(r.body.examDate).toBeUndefined();
  });
});

describe('Excel validation rule for the examDate column', () => {
  it('is a custom rule on the right column and is XML-safe', () => {
    const xml = buildDataValidationsXml([examDateValidation(12)]);
    expect(xml).toContain('type="custom"');
    expect(xml).toContain('sqref="M2:M5000"');
    expect(xml).toContain('M2'); // formula written for the first data row
    expect(xml).not.toMatch(/<formula1>[^<]*[<>][^<]*<\/formula1>/); // < and > are escaped
    expect(xml).toContain('errorStyle="stop"');
  });
});
