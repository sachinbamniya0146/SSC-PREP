import { configuredApiProviders, parseBraveJson, parseGoogleCseJson, parseSearxJson } from './pyq-date-search.service';

describe('search API parsers', () => {
  it('brave', () => {
    const h = parseBraveJson({ web: { results: [{ title: 'SSC CGL <b>2024</b>', url: 'https://example.com/a', description: 'Held on 9 Sep 2024' }, { title: 'x', url: 'http://localhost/x', description: '' }] } });
    expect(h).toHaveLength(1);
    expect(h[0].title).toBe('SSC CGL 2024');
    expect(h[0].snippet).toContain('9 Sep 2024');
  });
  it('google cse + searx + junk', () => {
    expect(parseGoogleCseJson({ items: [{ title: 'T', link: 'https://a.b/c', snippet: 'S' }] })[0].url).toBe('https://a.b/c');
    expect(parseSearxJson({ results: [{ title: 'T', url: 'https://a.b/c', content: 'S' }] })[0].snippet).toBe('S');
    expect(parseBraveJson(null)).toEqual([]);
    expect(parseSearxJson({ results: 'nope' })).toEqual([]);
  });
  it('configuredApiProviders reports names only', () => {
    expect(configuredApiProviders({ BRAVE_SEARCH_API_KEY: 'k', GOOGLE_CSE_KEY: 'a', GOOGLE_CSE_CX: 'b', SEARXNG_URL: 'https://s.example' } as never)).toEqual(['brave', 'google-cse', 'searxng']);
    expect(configuredApiProviders({ GOOGLE_CSE_KEY: 'a' } as never)).toEqual([]);
  });
});

import { isValidIsoDate } from './pyq-date.util';
describe('isValidIsoDate (A2: no future dates)', () => {
  const now = Date.UTC(2026, 9, 15);
  it('accepts past, rejects future / impossible', () => {
    expect(isValidIsoDate('2025-09-12', 2010, now)).toBe(true);
    expect(isValidIsoDate('2026-10-16', 2010, now)).toBe(true); // IST tolerance
    expect(isValidIsoDate('2026-12-01', 2010, now)).toBe(false);
    expect(isValidIsoDate('2025-02-30', 2010, now)).toBe(false);
    expect(isValidIsoDate('2005-01-01', 2010, now)).toBe(false);
  });
});

import { orderProviders, isQuotaError } from './pyq-date-search.service';
describe('provider order + quota guard', () => {
  it('self-hosted searxng comes first, capped APIs after', () => {
    expect(orderProviders(['google-cse', 'brave', 'searxng'])).toEqual(['searxng', 'brave', 'google-cse']);
  });
  it('detects quota / refused key errors only', () => {
    expect(isQuotaError('api/429')).toBe(true);
    expect(isQuotaError('api/402')).toBe(true);
    expect(isQuotaError('api/500')).toBe(false);
    expect(isQuotaError('blocked/200')).toBe(false);
  });
});
