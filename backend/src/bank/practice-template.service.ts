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
      if (ws[addr]) (ws[addr] as any).c = [{ a: 'SSC Prep Hub', t: `${c.required ? '[ZAROORI] ' : '[optional] '}${c.hint}${c.example ? `\nExample: ${c.example}` : ''}` }];
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
    set(update, 'id', '3f2504e0-4f89-41d3-9a0c-0305e82c3301  ← export se aaya ID: is row se wahi question UPDATE hoga');
    const exWs = XLSX.utils.aoa_to_sheet([headers, exAnswer, second, update]);
    exWs['!cols'] = ws['!cols'];
    XLSX.utils.book_append_sheet(wb, exWs, 'Examples');

    // 3) Columns guide
    const guide: string[][] = [['Column', 'Zaroori?', 'Kya likhna hai (Hinglish)', 'Example']];
    for (const c of PRACTICE_COLUMNS) guide.push([c.key, c.required ? 'HAAN' : 'optional', c.hint, c.example]);
    const gWs = XLSX.utils.aoa_to_sheet(guide);
    gWs['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 100 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, gWs, 'Columns guide');

    // 4) Instructions
    const ins = [
      ['SSC Prep Hub — Practice Question Upload (Excel)'],
      [''],
      ['KAISE BHAREIN'],
      ['1. "Questions" sheet me har question ek row me likhein. Header (pehli row) mat badlein; * wale columns zaroori hain.'],
      ['2. examId / subjectId / chapterId / correctAnswer / difficulty dropdown se chunein (cell par click -> teer).'],
      ['3. Har question ke saath SOLUTION (explanation) zaroori hai — bina solution ke row upload nahi hoti.'],
      ['4. Hindi text (questionTextHindi) khali ho to question save hota hai par students ko tab tak nahi dikhta jab tak Hindi na jude.'],
      ['5. Practice upload me year / shift / paperCode nahi hote — ye question PYQ nahi, sirf practice me jata hai.'],
      ['6. Upload se pehle "Check (kuch save nahi hoga)" dabayein: kitne naye, kitne update, kya galat — sab dikhega.'],
      [''],
      ['PEHLE SE UPLOAD QUESTIONS EDIT KARNA (ID se update)'],
      ['a. Manage Questions se "Download (Excel)" karein — file me pehla column id hota hai.'],
      ['b. Jo cell badalna hai badlein. id column mat chhedein. Khali cell = "jaisa hai waisa rahe" (kuch mitta nahi).'],
      ['c. Wahi file dobara upload karein — jin rows me id hai wo UPDATE hongi (duplicate nahi banegi). Jo rows me id khali hai wo naye question banengi.'],
      ['d. Re-upload se exam / subject / chapter / topic nahi badalte — uske liye Manage Questions me "move" karein.'],
      ['e. Har update purani value ko version history me save karta hai.'],
      [''],
      ['Sheets: Questions (yahan bharein) · Examples (copy karne ke liye) · Columns guide · Reference IDs (sab slugs) · Lists (dropdown ka data, mat badlein)'],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ins), 'Instructions');

    // 5) Reference IDs
    const ref: string[][] = [['Type', 'Slug (ye likhein)', 'Naam (English)', 'Naam (हिंदी)', 'Parent']];
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
      { col: col('examId'), formula: rng('A', exams.length), title: 'examId', message: 'Dropdown se exam chunein (Reference IDs sheet me poori list).', strict: false },
      { col: col('subjectId'), formula: rng('B', subjects.length), title: 'subjectId', message: 'Dropdown se subject chunein.', strict: false },
      { col: col('chapterId'), formula: rng('C', chapters.length), title: 'chapterId', message: 'Dropdown se chapter chunein (chapter ka naam bhi chalta hai).', strict: false },
      { col: col('correctAnswer'), formula: '"A,B,C,D"', title: 'correctAnswer', message: 'Sirf A, B, C ya D.', strict: true },
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
