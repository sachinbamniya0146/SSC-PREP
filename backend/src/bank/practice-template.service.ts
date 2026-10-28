/* eslint-disable @typescript-eslint/no-explicit-any */
// Practice-question Excel template (Oct 15 2026, Task B): built from the SAME column list the upload parser reads
// (bank-template.ts), with real dropdowns, Hinglish hints on every header, worked examples, instructions and the live
// reference IDs. SheetJS writes the content (+ header comments); dropdowns and the frozen header row are injected into
// the sheet XML with JSZip (SheetJS community edition cannot write data validation).
import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { PrismaService } from '../prisma/prisma.service';
import { ANSWER_LIST, DIFFICULTY_LIST, PRACTICE_COLUMNS, ValidationSpec, buildDataValidationsXml, headerLabel, injectSheetXml } from './bank-template';

@Injectable()
export class PracticeTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async build(): Promise<Buffer> {
    const [exams, subjects, chapters] = await Promise.all([
      this.prisma.exam.findMany({ select: { slug: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.subject.findMany({ select: { id: true, slug: true, name: true, nameHindi: true }, orderBy: { name: 'asc' } }),
      this.prisma.chapter.findMany({ select: { slug: true, name: true, nameHindi: true, subjectId: true }, orderBy: [{ subjectId: 'asc' }, { name: 'asc' }] }),
    ]);
    const subjectSlug = new Map(subjects.map((s) => [s.id, s.slug]));

    const wb = XLSX.utils.book_new();

    // 1) Questions sheet: header row only (nothing here is ever uploaded by accident)
    const headers = PRACTICE_COLUMNS.map(headerLabel);
    const ws = XLSX.utils.aoa_to_sheet([headers]);
    ws['!cols'] = PRACTICE_COLUMNS.map((c) => ({ wch: c.width }));
    PRACTICE_COLUMNS.forEach((c, i) => {
      const addr = XLSX.utils.encode_cell({ r: 0, c: i });
      if (ws[addr]) (ws[addr] as any).c = [{ a: 'SSC Prep Hub', t: `${c.required ? '[REQUIRED] ' : '[optional] '}${c.hint}${c.example ? `\nExample: ${c.example}` : ''}` }];
    });
    XLSX.utils.book_append_sheet(wb, ws, 'Questions');

    // 2) Examples: filled rows to copy from (never uploaded — the upload reads the first sheet only)
    const exAnswer = PRACTICE_COLUMNS.map((c) => c.example);
    const second = PRACTICE_COLUMNS.map((c) => c.example);
    const set = (arr: string[], k: string, v: string) => { arr[PRACTICE_COLUMNS.findIndex((c) => c.key === k)] = v; };
    set(second, 'questionText', 'Who wrote the Indian national anthem?');
    set(second, 'questionTextHindi', 'भारत का राष्ट्रगान किसने लिखा?');
    set(second, 'optionA', 'Bankim Chandra'); set(second, 'optionA_Hindi', 'बंकिम चंद्र');
    set(second, 'optionB', 'Rabindranath Tagore'); set(second, 'optionB_Hindi', 'रवीन्द्रनाथ टैगोर');
    set(second, 'optionC', 'Iqbal'); set(second, 'optionC_Hindi', 'इक़बाल');
    set(second, 'optionD', 'Sarojini Naidu'); set(second, 'optionD_Hindi', 'सरोजिनी नायडू');
    set(second, 'correctAnswer', 'B'); set(second, 'explanation', 'Jana Gana Mana was written by Rabindranath Tagore.'); set(second, 'explanationHindi', 'जन गण मन रवीन्द्रनाथ टैगोर ने लिखा।'); set(second, 'difficulty', 'EASY');
    set(second, 'chapterId', 'history'); set(second, 'subjectId', 'general-awareness'); set(second, 'topicId', ''); set(second, 'marks', '1');
    const update = [...exAnswer];
    set(update, 'id', '3f2504e0-4f89-41d3-9a0c-0305e82c3301  ← ID from an export: this row UPDATES that same question');
    const exWs = XLSX.utils.aoa_to_sheet([headers, exAnswer, second, update]);
    exWs['!cols'] = ws['!cols'];
    XLSX.utils.book_append_sheet(wb, exWs, 'Examples');

    // 3) Columns guide
    const guide: string[][] = [['Column', 'Required?', 'What to write', 'Example']];
    for (const c of PRACTICE_COLUMNS) guide.push([c.key, c.required ? 'YES' : 'optional', c.hint, c.example]);
    const gWs = XLSX.utils.aoa_to_sheet(guide);
    gWs['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 100 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, gWs, 'Columns guide');

    // 4) Instructions
    const ins = [
      ['SSC Prep Hub — Practice Question Upload (Excel)'],
      [''],
      ['HOW TO FILL IT IN'],
      ['1. In the "Questions" sheet write each question in one row. Do not change the header (first row); columns marked * are required.'],
      ['2. Choose examId / subjectId / chapterId / correctAnswer / difficulty from the dropdown (click the cell -> arrow).'],
      ['3. Every question needs a SOLUTION (explanation) — a row without a solution is not uploaded.'],
      ['4. If the Hindi text (questionTextHindi) is empty, the question is saved but students will not see it until Hindi is added.'],
      ['5. A Practice upload has no year / shift / paperCode — these questions go to Practice only, not to PYQ.'],
      ['6. Before uploading, press "Check (nothing will be saved)": it shows how many are new, how many are updates and what is wrong.'],
      [''],
      ['EDITING QUESTIONS THAT ARE ALREADY UPLOADED (update by ID)'],
      ['a. Use "Download (Excel)" in Manage Questions — the first column of the file is the id.'],
      ['b. Change the cells you want to change. Do not touch the id column. An empty cell = "keep as it is" (nothing is erased).'],
      ['c. Upload the same file again — rows that have an id are UPDATED (no duplicate is created). Rows with an empty id become new questions.'],
      ['d. A re-upload does not change the exam / subject / chapter / topic — use "move" in Manage Questions for that.'],
      ['e. Every update saves the old value in the version history.'],
      [''],
      ['Sheets: Questions (fill in here) · Examples (to copy from) · Columns guide · Reference IDs (all slugs) · Lists (dropdown data, do not change)'],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ins), 'Instructions');

    // 5) Reference IDs
    const ref: string[][] = [['Type', 'Slug (write this)', 'Name (English)', 'Name (हिंदी)', 'Parent']];
    for (const e of exams) ref.push(['Exam', e.slug, e.name, '', '']);
    for (const s of subjects) ref.push(['Subject', s.slug, s.name, s.nameHindi || '', '']);
    for (const c of chapters) ref.push(['Chapter', c.slug, c.name, c.nameHindi || '', subjectSlug.get(c.subjectId) ?? '']);
    const rWs = XLSX.utils.aoa_to_sheet(ref);
    rWs['!cols'] = [{ wch: 10 }, { wch: 34 }, { wch: 40 }, { wch: 34 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(wb, rWs, 'Reference IDs');

    // 6) Lists (dropdown sources)
    const rows = Math.max(exams.length, subjects.length, chapters.length, ANSWER_LIST.length, DIFFICULTY_LIST.length);
    const lists: string[][] = [['examId', 'subjectId', 'chapterId', 'correctAnswer', 'difficulty']];
    for (let i = 0; i < rows; i++) lists.push([exams[i]?.slug ?? '', subjects[i]?.slug ?? '', chapters[i]?.slug ?? '', ANSWER_LIST[i] ?? '', DIFFICULTY_LIST[i] ?? '']);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(lists), 'Lists');

    const raw = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    // ---- dropdowns + frozen header on sheet 1 ----
    const col = (k: string) => PRACTICE_COLUMNS.findIndex((c) => c.key === k);
    const rng = (letter: string, n: number) => `Lists!$${letter}$2:$${letter}$${Math.max(2, n + 1)}`;
    const specs: ValidationSpec[] = [
      { col: col('examId'), formula: rng('A', exams.length), title: 'examId', message: 'Choose the exam from the dropdown (full list in the Reference IDs sheet).', strict: false },
      { col: col('subjectId'), formula: rng('B', subjects.length), title: 'subjectId', message: 'Choose the subject from the dropdown.', strict: false },
      { col: col('chapterId'), formula: rng('C', chapters.length), title: 'chapterId', message: 'Choose the chapter from the dropdown (the chapter name also works).', strict: false },
      { col: col('correctAnswer'), formula: '"A,B,C,D"', title: 'correctAnswer', message: 'Only A, B, C or D.', strict: true },
      { col: col('difficulty'), formula: '"EASY,MEDIUM,HARD"', title: 'difficulty', message: 'EASY, MEDIUM ya HARD.', strict: true },
    ];
    const zip = await JSZip.loadAsync(raw);
    const sheetPath = await this.firstSheetPath(zip);
    const xml = await zip.file(sheetPath)!.async('string');
    zip.file(sheetPath, injectSheetXml(xml, buildDataValidationsXml(specs)));
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  /** workbook.xml + its rels say which file is the FIRST sheet (usually xl/worksheets/sheet1.xml) */
  private async firstSheetPath(zip: JSZip): Promise<string> {
    try {
      const wbXml = await zip.file('xl/workbook.xml')!.async('string');
      const rid = /<sheet\b[^>]*r:id="([^"]+)"/.exec(wbXml)?.[1];
      const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
      const tag = rid ? new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*>`).exec(rels)?.[0] : null;
      const target = tag ? /Target="([^"]+)"/.exec(tag)?.[1] : null;
      if (target) return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    } catch {
      /* fall through */
    }
    return 'xl/worksheets/sheet1.xml';
  }
}
