/* eslint-disable @typescript-eslint/no-explicit-any */
// Practice-question Excel template (Oct 15 2026, Task B): built from the SAME column list the upload parser reads
// (bank-template.ts), with real dropdowns, Hinglish hints on every header, worked examples, instructions and the live
// reference IDs. SheetJS writes the content (+ header comments); dropdowns and the frozen header row are injected into
// the sheet XML with JSZip (SheetJS community edition cannot write data validation).
import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { PrismaService } from '../prisma/prisma.service';
import { ANSWER_LIST, DIFFICULTY_LIST, MIXED_COLUMNS, MIXED_PYQ_ONLY_KEYS, PRACTICE_COLUMNS, SHIFT_LIST, TIER_LIST, TIER_PAPER_LIST, ValidationSpec, buildDataValidationsXml, headerLabel, injectSheetXml } from './bank-template';

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

  /**
   * S37 (29 Oct 2026): the "PYQ + Practice" template - ONE Excel for PYQ rows and practice rows. Same 34 columns, same order as
   * the Master Package sheet. Reference IDs now also list every Topic and Sub-topic of the database (so the exact names can be
   * copied) and the exams come straight from the database: a newly created exam appears here at once.
   */
  async buildMixed(): Promise<Buffer> {
    const [exams, subjects, chapters, topics, subTopics] = await Promise.all([
      this.prisma.exam.findMany({ select: { slug: true, name: true, code: true }, orderBy: { name: 'asc' } }),
      this.prisma.subject.findMany({ select: { id: true, slug: true, name: true, nameHindi: true }, orderBy: { name: 'asc' } }),
      this.prisma.chapter.findMany({ select: { id: true, slug: true, name: true, nameHindi: true, subjectId: true }, orderBy: [{ subjectId: 'asc' }, { name: 'asc' }] }),
      this.prisma.topic.findMany({ select: { id: true, slug: true, name: true, nameHindi: true, chapterId: true }, orderBy: [{ chapterId: 'asc' }, { name: 'asc' }] }),
      this.prisma.subTopic.findMany({ select: { slug: true, name: true, nameHindi: true, topicId: true }, orderBy: [{ topicId: 'asc' }, { name: 'asc' }] }),
    ]);
    const subjectSlug = new Map(subjects.map((s) => [s.id, s.slug]));
    const chapterSlug = new Map(chapters.map((c) => [c.id, c.slug]));
    const topicSlug = new Map(topics.map((t) => [t.id, t.slug]));

    const headers = MIXED_COLUMNS.map(headerLabel);
    const idx = (k: string) => MIXED_COLUMNS.findIndex((c) => c.key === k);
    const wb = XLSX.utils.book_new();

    // 1) Questions: header only
    const ws = XLSX.utils.aoa_to_sheet([headers]);
    ws['!cols'] = MIXED_COLUMNS.map((c) => ({ wch: c.width }));
    MIXED_COLUMNS.forEach((c, i) => {
      const addr = XLSX.utils.encode_cell({ r: 0, c: i });
      const pyqOnly = MIXED_PYQ_ONLY_KEYS.includes(c.key);
      if (ws[addr]) (ws[addr] as any).c = [{ a: 'SSC Prep Hub', t: `${c.required ? '[REQUIRED] ' : pyqOnly ? '[PYQ rows only] ' : '[optional] '}${c.hint}${c.example ? `\nExample: ${c.example}` : ''}` }];
    });
    XLSX.utils.book_append_sheet(wb, ws, 'Questions');

    // 2) Examples: one PYQ row, one practice row (never uploaded - the upload reads the first sheet only)
    const firstExam = exams[0]?.slug ?? 'exam-cgl';
    const firstSubject = subjects.find((x) => /quant/i.test(x.slug))?.slug ?? subjects[0]?.slug ?? 'sub-quantitative_aptitude';
    const firstChapter = chapters.find((c) => subjectSlug.get(c.subjectId) === firstSubject && /percent/i.test(c.slug))?.slug ?? chapters[0]?.slug ?? 'chap-percentage-quantitative_aptitude';
    const base = MIXED_COLUMNS.map((c) => c.example);
    const put = (row: string[], k: string, v: string) => { row[idx(k)] = v; };
    const pyq = [...base];
    put(pyq, 'examId', firstExam); put(pyq, 'subjectId', firstSubject); put(pyq, 'chapterId', firstChapter);
    put(pyq, 'questionText', 'EXAMPLE ONLY (PYQ row): What is 20% of 150?');
    const practice = [...base];
    put(practice, 'examId', firstExam); put(practice, 'subjectId', firstSubject); put(practice, 'chapterId', firstChapter);
    put(practice, 'questionText', 'EXAMPLE ONLY (practice row): What is 25% of 240?');
    put(practice, 'questionTextHindi', '240 का 25% क्या है?');
    put(practice, 'optionA', '50'); put(practice, 'optionA_Hindi', '50'); put(practice, 'optionB', '60'); put(practice, 'optionB_Hindi', '60');
    put(practice, 'optionC', '70'); put(practice, 'optionC_Hindi', '70'); put(practice, 'optionD', '80'); put(practice, 'optionD_Hindi', '80');
    put(practice, 'explanation', 'Detailed Logical Explanation:\n1. 25% of 240 = 240 × 25 / 100 = 60');
    put(practice, 'explanationHindi', 'विस्तृत तार्किक व्याख्या:\n1. 240 का 25% = 240 × 25 / 100 = 60');
    for (const k of MIXED_PYQ_ONLY_KEYS) put(practice, k, ''); // a practice row has no paper columns at all
    put(practice, 'marks', '1'); put(practice, 'negativeMarks', '0.25');
    const exWs = XLSX.utils.aoa_to_sheet([headers, pyq, practice]);
    exWs['!cols'] = ws['!cols'];
    XLSX.utils.book_append_sheet(wb, exWs, 'Examples');

    // 3) Columns guide
    const guide: string[][] = [['#', 'Column', 'Needed?', 'PYQ row / Practice row', 'What to write', 'Example']];
    MIXED_COLUMNS.forEach((c, i) => {
      const pyqOnly = MIXED_PYQ_ONLY_KEYS.includes(c.key);
      guide.push([String(i + 1), c.key, c.required ? 'YES' : 'optional', pyqOnly ? 'PYQ: fill - Practice: EMPTY' : 'both', c.hint, c.example]);
    });
    const gWs = XLSX.utils.aoa_to_sheet(guide);
    gWs['!cols'] = [{ wch: 4 }, { wch: 20 }, { wch: 10 }, { wch: 26 }, { wch: 100 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, gWs, 'Columns guide');

    // 4) Instructions
    const ins = [
      ['SSC Prep Hub - PYQ + Practice in ONE Excel (29 Oct 2026)'],
      [''],
      ['RULE OF THE FILE'],
      ['1. One row = one question. A row with a year / examDate is a PYQ. A row with BOTH empty is a practice question. You can mix both kinds in one file.'],
      ['2. PYQ row: examId, examTier, examDate, year, shift (when printed), questionNo (when known). The site puts all rows of the same exam + tier + date + shift into ONE mock.'],
      ['3. Practice row: leave year, shift, paperCode, examDate, examTier, tierPaper and questionNo EMPTY (they are ignored anyway). Fill chapterId + topicId + subTopicId: practice questions are counted per sub-topic (target 100 each).'],
      ['4. Students never see the exam date. They see Year -> Shift -> Set. Only the admin sees dates.'],
      [''],
      ['SHIFT / QUESTION NUMBER'],
      ['5. Shift 1, 2, 3 and 4 are all accepted. Morning = Shift 1, Afternoon = Shift 2, Evening = Shift 3 - ONLY when the source prints the session. Never guess.'],
      ['6. questionNo = the number printed in the ORIGINAL paper. A serial number of a chapter compilation (Q200-Q300 ...) is NOT a paper number: leave it EMPTY. Empty is allowed - the mock then follows the upload order.'],
      [''],
      ['OTHER EXAMS (Railway, Selection Post, Delhi Police ...)'],
      ['7. examId must exist in the database. If it is not in the Reference IDs sheet: Admin -> Exams -> "Add common exams" (or "Add exam"), download this template again, then upload.'],
      ['8. Railway CBT-1 = TIER_1, CBT-2 = TIER_2. Marks and negative marks are those of THAT exam (do not copy the CGL numbers).'],
      [''],
      ['CONTENT'],
      ['9. Hindi: Maths / Reasoning / General Awareness need questionTextHindi (and Hindi options + solution). Without it the question is saved but students do NOT see it. English subject: question and options stay English only, the Hindi goes only in explanationHindi.'],
      ['10. Image-based, figure and non-verbal questions: do not put them in this file. The admin adds them by hand (Admin -> Questions -> Add).'],
      ['11. Every question needs a solution. A row without a solution is not uploaded.'],
      ['12. Admin screens: before choosing a chapter / topic / sub-topic the admin sees the questions already uploaded there, so the same question is not made twice.'],
      [''],
      ['BEFORE YOU UPLOAD'],
      ['13. Use "Check only (nothing will be saved)". It shows: PYQ rows, practice rows, which papers (exam . tier . date . shift) the PYQ rows join, how many practice questions each sub-topic gets (already N / 100), unknown exams and rows without Hindi.'],
      [''],
      ['Sheets: Questions (fill in here) . Examples . Columns guide . Reference IDs (exam / subject / chapter / topic / sub-topic) . Lists (dropdown data, do not change)'],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ins), 'Instructions');

    // 5) Reference IDs (live from the database)
    const ref: string[][] = [['Type', 'Slug (write this)', 'Name (English)', 'Name (हिंदी)', 'Parent slug', 'Code']];
    for (const e of exams) ref.push(['Exam', e.slug, e.name, '', '', e.code ?? '']);
    for (const s of subjects) ref.push(['Subject', s.slug, s.name, s.nameHindi || '', '', '']);
    for (const c of chapters) ref.push(['Chapter', c.slug, c.name, c.nameHindi || '', subjectSlug.get(c.subjectId) ?? '', '']);
    for (const t of topics) ref.push(['Topic', t.slug, t.name, t.nameHindi || '', chapterSlug.get(t.chapterId) ?? '', '']);
    for (const t of subTopics) ref.push(['Sub-topic', t.slug, t.name, t.nameHindi || '', topicSlug.get(t.topicId) ?? '', '']);
    const rWs = XLSX.utils.aoa_to_sheet(ref);
    rWs['!cols'] = [{ wch: 10 }, { wch: 40 }, { wch: 44 }, { wch: 34 }, { wch: 40 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, rWs, 'Reference IDs');

    // 6) Lists (dropdown sources)
    const n = Math.max(exams.length, subjects.length, chapters.length, ANSWER_LIST.length, DIFFICULTY_LIST.length, SHIFT_LIST.length);
    const lists: string[][] = [['examId', 'subjectId', 'chapterId', 'correctAnswer', 'difficulty', 'shift', 'examTier', 'tierPaper']];
    for (let i = 0; i < n; i++) lists.push([exams[i]?.slug ?? '', subjects[i]?.slug ?? '', chapters[i]?.slug ?? '', ANSWER_LIST[i] ?? '', DIFFICULTY_LIST[i] ?? '', SHIFT_LIST[i] ?? '', TIER_LIST[i] ?? '', TIER_PAPER_LIST[i] ?? '']);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(lists), 'Lists');

    const raw = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    // dropdowns + frozen header on sheet 1
    const rng = (letter: string, count: number) => `Lists!$${letter}$2:$${letter}$${Math.max(2, count + 1)}`;
    const specs: ValidationSpec[] = [
      { col: idx('examId'), formula: rng('A', exams.length), title: 'examId', message: 'Choose the exam (full list in the Reference IDs sheet). A new exam must be created in Admin -> Exams first.', strict: false },
      { col: idx('subjectId'), formula: rng('B', subjects.length), title: 'subjectId', message: 'Choose the subject.', strict: false },
      { col: idx('chapterId'), formula: rng('C', chapters.length), title: 'chapterId', message: 'Choose the chapter (the exact chapter name also works).', strict: false },
      { col: idx('correctAnswer'), formula: '"A,B,C,D"', title: 'correctAnswer', message: 'Only A, B, C or D.', strict: true },
      { col: idx('difficulty'), formula: '"EASY,MEDIUM,HARD"', title: 'difficulty', message: 'EASY, MEDIUM or HARD.', strict: true },
      { col: idx('shift'), formula: rng('F', SHIFT_LIST.length), title: 'shift', message: 'Shift 1 / 2 / 3 / 4 - empty when the source does not print the shift, and always empty on a practice row.', strict: false },
      { col: idx('examTier'), formula: rng('G', TIER_LIST.length), title: 'examTier', message: 'TIER_1 or TIER_2 - empty on a practice row.', strict: false },
      { col: idx('tierPaper'), formula: rng('H', TIER_PAPER_LIST.length), title: 'tierPaper', message: 'PAPER_1 / PAPER_2 / PAPER_3 (optional).', strict: false },
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
