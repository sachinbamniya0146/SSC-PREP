import * as fs from 'fs';
import * as path from 'path';
import { stripAdminOnlyFields } from './student-safe';

describe('admin-only paper fields never reach a student', () => {
  it('removes examDate and paperCode, also from the highlighted copy', () => {
    const hit = { id: 'q1', year: 2025, shift: 'Shift 2', paperCode: 'SSC-CGL-T-I-12-Sep-2025-S2', examDate: '2025-09-12', _formatted: { id: 'q1', paperCode: 'SSC-CGL-T-I-12-Sep-2025-S2', questionText: '<mark>x</mark>' } };
    const out = stripAdminOnlyFields(hit) as Record<string, any>;
    expect(out).toEqual({ id: 'q1', year: 2025, shift: 'Shift 2', _formatted: { id: 'q1', questionText: '<mark>x</mark>' } });
    expect(hit.paperCode).toBe('SSC-CGL-T-I-12-Sep-2025-S2'); // the original is untouched
  });

  it('a hit without those fields passes through unchanged', () => {
    expect(stripAdminOnlyFields({ id: 'q2', year: null })).toEqual({ id: 'q2', year: null });
  });

  it('the public search endpoint really uses it (source check)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'search', 'search.service.ts'), 'utf8');
    expect(src).toContain('stripAdminOnlyFields');
  });
});
