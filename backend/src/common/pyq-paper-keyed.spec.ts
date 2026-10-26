import { dedupeKeyedPaperRows } from './pyq-paper';

const d = (n: number) => new Date(2026, 0, 1, 0, 0, n);
const row = (id: string, text: string, sec: number, no?: number | null) => ({ id, questionText: text, createdAt: d(sec), paperQuestionNo: no });

describe('dedupeKeyedPaperRows', () => {
  it('drops duplicate text (oldest wins) and orders by printed question number', () => {
    const out = dedupeKeyedPaperRows([row('b', 'Q two', 2, 2), row('a', 'Q one', 1, 1), row('dup', 'q  one', 3, 9)], 300);
    expect(out.map((r) => r.id)).toEqual(['a', 'b']);
  });
  it('rows without a number go after numbered rows, in upload order', () => {
    const out = dedupeKeyedPaperRows([row('x', 'x', 1, null), row('y', 'y', 2, 5), row('z', 'z', 3, null)], 300);
    expect(out.map((r) => r.id)).toEqual(['y', 'x', 'z']);
  });
  it('is capped by the given ceiling, not 100', () => {
    const rows = Array.from({ length: 150 }, (_, i) => row(`r${i}`, `text ${i}`, i, i + 1));
    expect(dedupeKeyedPaperRows(rows, 300)).toHaveLength(150);
    expect(dedupeKeyedPaperRows(rows, 120)).toHaveLength(120);
  });
});
