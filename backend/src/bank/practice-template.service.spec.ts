/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from 'fs';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { PracticeTemplateService } from './practice-template.service';
import { PRACTICE_COLUMNS, headerLabel } from './bank-template';

const prisma: any = {
  exam: { findMany: async () => [{ slug: 'ssc-cgl', name: 'SSC CGL' }, { slug: 'ssc-chsl', name: 'SSC CHSL' }] },
  subject: { findMany: async () => [{ id: 's1', slug: 'quant', name: 'Quant', nameHindi: 'गणित' }] },
  chapter: { findMany: async () => [{ slug: 'percentage', name: 'Percentage', nameHindi: 'प्रतिशत', subjectId: 's1' }, { slug: 'ratio', name: 'Ratio', nameHindi: null, subjectId: 's1' }] },
};

describe('PracticeTemplateService', () => {
  it('builds a real xlsx: header row = parser columns, dropdowns injected, other sheets present', async () => {
    const buf = await new PracticeTemplateService(prisma).build();
    if (process.env.DUMP_TEMPLATE) fs.writeFileSync(process.env.DUMP_TEMPLATE, buf);
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Questions', 'Examples', 'Columns guide', 'Instructions', 'Reference IDs', 'Lists']);
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['Questions'], { header: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(PRACTICE_COLUMNS.map(headerLabel));
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(xml).toContain('<dataValidations count="5">');
    expect(xml).toContain('Lists!$A$2:$A$3'); // 2 exams
    expect(xml).toContain('Lists!$C$2:$C$3'); // 2 chapters
    expect(xml).toContain('state="frozen"');
    const at = xml.indexOf('<dataValidations');
    expect(at).toBeGreaterThan(xml.indexOf('</sheetData>'));
    for (const later of ['<ignoredErrors', '<legacyDrawing', '<pageMargins']) if (xml.includes(later)) expect(at).toBeLessThan(xml.indexOf(later));
    const ref = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['Reference IDs'], { header: 1 });
    expect(ref.some((r) => r[1] === 'percentage')).toBe(true);
  });
});
