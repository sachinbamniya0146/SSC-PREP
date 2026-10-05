// Vocabulary bulk import (NEW — Sep 2026)
//
// "admin vocab ke questions ko bhi excel se... upload kar sake... jesa PYQ ka
// scene hai same vesa hi": a dedicated two-sheet Excel importer, mirroring
// the shape (and the "re-uploading is safe, matched-and-updated not
// duplicated" idempotency) of bank-upload.service.ts's question importer,
// but for the Vocabulary tables instead of Subject/Chapter/Topic/Question.
//
// Sheet 1 "Words"     — one row per word (full learning content).
// Sheet 2 "Questions" — one row per quiz question; `wordSlug` links it back.
// See Vocabulary_30Words_Import.xlsx's "Instructions" sheet for the exact
// column contract this parser expects.
import { BadRequestException, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { restoreArchivedProgress } from './vocab-unlock-memory';
import { PrismaService } from '../prisma/prisma.service';

export type VocabSkipCode =
  | 'DUPLICATE_WORD' | 'MISSING_MEANING' | 'DUPLICATE_QUESTION' | 'MISSING_ANSWER'
  | 'MISSING_SOLUTION' | 'MISSING_OPTIONS' | 'MISSING_FIELD' | 'UNKNOWN_WORD';

export interface VocabWordReport {
  word: string;
  wordStatus: 'OK' | 'DUPLICATE' | 'MISSING_MEANING';
  questionsCreated: number;
  rejected: Partial<Record<VocabSkipCode, number>>;
}

export interface VocabUploadResult {
  success: boolean;
  dryRun: boolean;
  wordsCreated: number;
  wordsUpdated: number; // existing words whose content was refreshed from the sheet (hidden ones are re-activated)
  wordsSkipped: number;
  questionsCreated: number;
  questionsUpdated: number; // existing questions (same word + same text) whose options / answer / solution were refreshed
  questionsSkipped: number;
  errors: { sheet: string; row: number; error: string }[];
  skipped: { sheet: string; row: number; word: string; code: VocabSkipCode; message: string }[];
  wordReport: VocabWordReport[];
}

// case/space/punctuation-insensitive key used for duplicate detection
function normText(s: string): string {
  return String(s ?? '').toLowerCase().replace(/[\s\u00a0]+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Template headers mark required columns with a trailing '*' (e.g. 'word*',
// 'meaningHindi*') for human readability. xlsx's sheet_to_json keeps that
// '*' as part of the literal header string, so a row's key is 'word*', not
// 'word'. Try the plain key first, then the '*'-suffixed variant, so both
// a hand-typed plain header and the starred template header resolve.
function cell(row: any, key: string): string {
  let v = row[key];
  if (v === undefined || v === null) v = row[`${key}*`];
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

function optionalCell(row: any, key: string): string | null {
  const v = cell(row, key);
  return v ? v : null;
}

@Injectable()
export class VocabUploadService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ready-to-fill Excel template (Words + Questions + Instructions sheets)
   * matching exactly what uploadFromExcel() parses — so a Vocabulary editor
   * never has to guess the columns.
   */
  buildTemplate(): Buffer {
    const wb = XLSX.utils.book_new();

    const wordsHeader = [
      'word*', 'slug', 'orderIndex', 'partOfSpeech', 'pronunciation',
      'meaningHindi*', 'meaningEnglish*', 'memoryTrick', 'etymology',
      'registerNote', 'examTrendNote', 'confusingPairNote',
      'exampleSentenceEn1', 'exampleSentenceHi1',
      'exampleSentenceEn2', 'exampleSentenceHi2',
      'exampleSentenceEn3', 'exampleSentenceHi3',
      'synonymsJson', 'antonymsJson',
    ];
    const wordsRow = [
      'Abate', 'abate', 1, 'verb', '/əˈbeɪt/',
      'कम होना / घटना', 'To become less intense or widespread', 'A-bate: bait kam ho gaya', '',
      '', 'SSC CGL 2019', 'abate vs abet',
      'The storm began to abate.', 'तूफान कम होने लगा।',
      '', '', '', '',
      '["subside","diminish"]', '["intensify","increase"]',
    ];
    const wsWords = XLSX.utils.aoa_to_sheet([wordsHeader, wordsRow]);
    XLSX.utils.book_append_sheet(wb, wsWords, 'Words');

    const qHeader = ['wordSlug*', 'questionText*', 'optionA*', 'optionB*', 'optionC*', 'optionD*', 'correctAnswer*', 'explanation', 'questionType'];
    const qRow = [
      'abate', 'Choose the word closest in meaning to "ABATE".', 'Subside', 'Intensify', 'Ignore', 'Postpone', 'A',
      'Abate means to become less intense — "subside" is the closest.', 'SYNONYM',
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([qHeader, qRow]), 'Questions');

    const notes = [
      ['Vocabulary bulk import — instructions'],
      ['1. Sheet "Words": one row per word. Columns marked * are required.'],
      ['2. Sheet "Questions": one row per quiz question. wordSlug must match a word\'s slug (slug defaults to the lower-case word).'],
      ['3. correctAnswer must be A, B, C or D.'],
      ['4. synonymsJson / antonymsJson must be a JSON list, e.g. ["a","b"] — or leave empty.'],
      ['5. Jo word / question pehle se system me hai (same word, same question text) wo duplicate nahi banta — uska content Excel ke naye data se UPDATE ho jata hai. Khali cell purani value ko nahi mitata. Answer key ya solution missing ho to question upload nahi hota — report me dikhta hai.'],
      ['6. You can upload only the Questions sheet to add questions to words that already exist.'],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(notes), 'Instructions');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  /**
   * Import rules (Oct 2026):
   *  - A word that already exists (same slug OR same word text, case-insensitive)
   *    is UPDATED in place from the sheet (meanings, notes, examples, synonyms ...). Only non-empty cells
   *    overwrite; slug, position (orderIndex) and every student's progress are never touched. A hidden word
   *    is re-activated. A word that appears twice in the same file is SKIPPED and reported.
   *  - A question that already exists (same word + same text) is UPDATED (options, answer, solution, type).
   *  - A question is SKIPPED and reported when: answer key missing/invalid,
   *    solution (explanation) missing, any option missing, or it appears twice in the same file.
   *  - dryRun=true validates everything and writes nothing.
   * Every skip lands in `skipped` (with a reason code) and in `wordReport`
   * (per-word summary: "word X: 3 questions rejected: 2 solution missing ...").
   */
  async uploadFromExcel(buffer: Buffer, dryRun = false): Promise<VocabUploadResult> {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch {
      throw new BadRequestException('Excel file padhi nahi ja saki — file corrupt ho sakti hai.');
    }

    const wordsSheet = workbook.Sheets['Words'];
    const questionsSheet = workbook.Sheets['Questions'];
    if (!wordsSheet && !questionsSheet) {
      throw new BadRequestException(
        `Is file me 'Words' ya 'Questions' naam ki sheet nahi mili. Sheets mili: ${workbook.SheetNames.join(', ')}`,
      );
    }

    const result: VocabUploadResult = {
      success: true,
      dryRun,
      wordsCreated: 0,
      wordsUpdated: 0,
      wordsSkipped: 0,
      questionsCreated: 0,
      questionsUpdated: 0,
      questionsSkipped: 0,
      errors: [],
      skipped: [],
      wordReport: [],
    };
    const report = new Map<string, VocabWordReport>();
    const rep = (word: string): VocabWordReport => {
      let r = report.get(word);
      if (!r) { r = { word, wordStatus: 'OK', questionsCreated: 0, rejected: {} }; report.set(word, r); }
      return r;
    };
    const skipQ = (row: number, word: string, code: VocabSkipCode, message: string) => {
      result.questionsSkipped++;
      result.skipped.push({ sheet: 'Questions', row, word, code, message });
      const r = rep(word);
      r.rejected[code] = (r.rejected[code] ?? 0) + 1;
    };

    // ---- Words sheet ----
    const existingWords = await this.prisma.vocabWord.findMany({ select: { id: true, slug: true, word: true, isActive: true, orderIndex: true } });
    const slugToId = new Map<string, string>(existingWords.map((w) => [w.slug, w.id]));
    const wordSlugsThisFile = new Set<string>();
    const wordTextsThisFile = new Set<string>();

    // Content fields of a sheet row that should overwrite an existing word. Empty cells are left alone.
    const buildWordUpdate = (row: any): Record<string, any> => {
      const data: Record<string, any> = {};
      for (const k of ['meaningHindi', 'meaningEnglish', 'partOfSpeech', 'pronunciation', 'memoryTrick', 'etymology', 'registerNote', 'examTrendNote', 'confusingPairNote']) {
        const v = optionalCell(row, k);
        if (v !== null) data[k] = v;
      }
      const examples: { en: string; hi: string }[] = [];
      for (const n of [1, 2, 3]) {
        const en = cell(row, `exampleSentenceEn${n}`);
        const hi = cell(row, `exampleSentenceHi${n}`);
        if (en || hi) examples.push({ en, hi });
      }
      if (examples.length) data.examplesJson = examples as any;
      const synRaw = cell(row, 'synonymsJson');
      const antRaw = cell(row, 'antonymsJson');
      if (synRaw) { try { data.synonymsJson = JSON.parse(synRaw); } catch { throw new Error("'synonymsJson' is not valid JSON"); } }
      if (antRaw) { try { data.antonymsJson = JSON.parse(antRaw); } catch { throw new Error("'antonymsJson' is not valid JSON"); } }
      return data;
    };

    if (wordsSheet) {
      const rows: any[] = XLSX.utils.sheet_to_json(wordsSheet, { defval: '' });
      const toCreate: any[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;
        const wordText = cell(row, 'word');
        try {
          if (!wordText) throw new Error("'word' column is required");
          const slug = cell(row, 'slug') || slugify(wordText);
          if (!slug) throw new Error("word se valid slug nahi ban paya");
          const wordKey = normText(wordText);
          if (wordSlugsThisFile.has(slug) || wordTextsThisFile.has(wordKey)) {
            result.wordsSkipped++;
            result.skipped.push({
              sheet: 'Words', row: rowNum, word: wordText, code: 'DUPLICATE_WORD',
              message: 'Ye word isi file me pehle bhi aa chuka hai — skip kiya',
            });
            rep(wordText).wordStatus = 'DUPLICATE';
            continue;
          }
          // Word already in the system (active OR hidden): refresh its content from the sheet, never a second copy.
          // Position, slug and all student progress stay as they are; a hidden word comes back with progress intact.
          const existing = existingWords.find((w) => w.slug === slug || normText(w.word) === wordKey);
          if (existing) {
            const data = buildWordUpdate(row);
            if (!existing.isActive) data.isActive = true;
            if (!dryRun && Object.keys(data).length) await this.prisma.vocabWord.update({ where: { id: existing.id }, data });
            existing.isActive = true;
            slugToId.set(slug, existing.id); // Questions sheet may use the sheet's slug
            wordSlugsThisFile.add(existing.slug);
            wordSlugsThisFile.add(slug);
            wordTextsThisFile.add(wordKey);
            result.wordsUpdated++;
            rep(wordText).wordStatus = 'OK';
            continue;
          }
          const meaningHindi = cell(row, 'meaningHindi');
          const meaningEnglish = cell(row, 'meaningEnglish');
          if (!meaningHindi || !meaningEnglish) {
            result.wordsSkipped++;
            result.skipped.push({ sheet: 'Words', row: rowNum, word: wordText, code: 'MISSING_MEANING', message: "'meaningHindi' aur 'meaningEnglish' dono zaroori hain — word skip hua" });
            rep(wordText).wordStatus = 'MISSING_MEANING';
            continue;
          }
          const orderIndexRaw = cell(row, 'orderIndex');
          const orderIndex = orderIndexRaw ? parseInt(orderIndexRaw, 10) : Number.MAX_SAFE_INTEGER;
          if (Number.isNaN(orderIndex)) throw new Error("'orderIndex' must be a number");

          const examples: { en: string; hi: string }[] = [];
          for (const n of [1, 2, 3]) {
            const en = cell(row, `exampleSentenceEn${n}`);
            const hi = cell(row, `exampleSentenceHi${n}`);
            if (en || hi) examples.push({ en, hi });
          }
          let synonyms: unknown = [];
          let antonyms: unknown = [];
          const synRaw = cell(row, 'synonymsJson');
          const antRaw = cell(row, 'antonymsJson');
          try { synonyms = synRaw ? JSON.parse(synRaw) : []; } catch { throw new Error("'synonymsJson' is not valid JSON"); }
          try { antonyms = antRaw ? JSON.parse(antRaw) : []; } catch { throw new Error("'antonymsJson' is not valid JSON"); }

          toCreate.push({
            slug,
            word: wordText,
            orderIndex,
            partOfSpeech: optionalCell(row, 'partOfSpeech'),
            pronunciation: optionalCell(row, 'pronunciation'),
            meaningHindi,
            meaningEnglish,
            memoryTrick: optionalCell(row, 'memoryTrick'),
            etymology: optionalCell(row, 'etymology'),
            registerNote: optionalCell(row, 'registerNote'),
            examTrendNote: optionalCell(row, 'examTrendNote'),
            confusingPairNote: optionalCell(row, 'confusingPairNote'),
            examplesJson: examples as any,
            synonymsJson: synonyms as any,
            antonymsJson: antonyms as any,
          });
          wordSlugsThisFile.add(slug);
          wordTextsThisFile.add(wordKey);
          rep(wordText);
        } catch (e) {
          result.errors.push({ sheet: 'Words', row: rowNum, error: e instanceof Error ? e.message : String(e) });
        }
      }
      // New words ALWAYS go to the END of the list (after the highest existing orderIndex), in the order the sheet
      // asks for. The sheet's orderIndex only orders the new words among themselves — it can never slot a word
      // in front of ones students already unlocked or reuse an existing number.
      if (toCreate.length) {
        const maxOrder = existingWords.reduce((m, w) => Math.max(m, w.orderIndex ?? 0), 0);
        const sorted = toCreate.map((w, i) => ({ w, i })).sort((a, b) => (a.w.orderIndex - b.w.orderIndex) || (a.i - b.i));
        sorted.forEach((x, n) => { x.w.orderIndex = maxOrder + 1 + n; });
      }
      // one round trip instead of one-per-word
      if (toCreate.length) {
        if (!dryRun) {
          for (let i = 0; i < toCreate.length; i += 200) {
            await this.prisma.vocabWord.createMany({ data: toCreate.slice(i, i + 200), skipDuplicates: true });
          }
          const fresh = await this.prisma.vocabWord.findMany({ where: { slug: { in: toCreate.map((w) => w.slug) } }, select: { id: true, slug: true } });
          for (const w of fresh) slugToId.set(w.slug, w.id);
          // A word that was hard-deleted earlier comes back with every student's unlock/mastery restored.
          const textBySlug = new Map(toCreate.map((w) => [w.slug, w.word as string]));
          for (const w of fresh) await restoreArchivedProgress(this.prisma, w.id, textBySlug.get(w.slug) ?? '');
        } else {
          for (const w of toCreate) slugToId.set(w.slug, `dry:${w.slug}`);
        }
        result.wordsCreated = toCreate.length;
      }
    }

    // ---- Questions sheet ----
    if (questionsSheet) {
      const rows: any[] = XLSX.utils.sheet_to_json(questionsSheet, { defval: '' });
      const realWordIds = [...new Set(rows.map((r) => slugToId.get(cell(r, 'wordSlug'))).filter((x): x is string => !!x && !x.startsWith('dry:')))];
      const existingQ = realWordIds.length
        ? await this.prisma.vocabQuestion.findMany({ where: { wordId: { in: realWordIds } }, select: { id: true, wordId: true, questionText: true } })
        : [];
      // existing question (same word + same normalised text) -> its id, so the sheet row UPDATES it instead of duplicating
      const existingQByKey = new Map<string, string>();
      for (const q of existingQ) {
        const k = `${q.wordId}::${normText(q.questionText)}`;
        if (!existingQByKey.has(k)) existingQByKey.set(k, q.id);
      }
      const seenInFile = new Set<string>();
      const toCreateQ: any[] = [];
      const toUpdateQ: { id: string; data: Record<string, any> }[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;
        const wordSlug = cell(row, 'wordSlug');
        const wordLabel = wordSlug || '(wordSlug khali)';
        try {
          if (!wordSlug) { skipQ(rowNum, wordLabel, 'MISSING_FIELD', "'wordSlug' khali hai"); continue; }
          const wordId = slugToId.get(wordSlug);
          if (!wordId) { skipQ(rowNum, wordLabel, 'UNKNOWN_WORD', `wordSlug '${wordSlug}' kisi word se match nahi hua (spelling check karein, ya Words sheet me pehle add karein)`); continue; }

          const questionText = cell(row, 'questionText');
          if (!questionText) { skipQ(rowNum, wordLabel, 'MISSING_FIELD', 'questionText khali hai'); continue; }
          const optA = cell(row, 'optionA'), optB = cell(row, 'optionB'), optC = cell(row, 'optionC'), optD = cell(row, 'optionD');
          if (!optA || !optB || !optC || !optD) { skipQ(rowNum, wordLabel, 'MISSING_OPTIONS', 'Char options (A-D) me se koi khali hai'); continue; }
          const correctAnswer = cell(row, 'correctAnswer').toUpperCase();
          if (!['A', 'B', 'C', 'D'].includes(correctAnswer)) {
            skipQ(rowNum, wordLabel, 'MISSING_ANSWER', correctAnswer ? `Answer key galat hai ("${correctAnswer}")` : 'Answer key (correctAnswer) missing hai');
            continue;
          }
          const explanation = optionalCell(row, 'explanation');
          if (!explanation) { skipQ(rowNum, wordLabel, 'MISSING_SOLUTION', 'Solution/explanation missing hai'); continue; }

          const key = `${wordId}::${normText(questionText)}`;
          if (seenInFile.has(key)) { skipQ(rowNum, wordLabel, 'DUPLICATE_QUESTION', 'Ye question isi file me pehle bhi aa chuka hai — skip kiya'); continue; }
          seenInFile.add(key);

          const optionsJson = [
            { key: 'A', text: optA }, { key: 'B', text: optB }, { key: 'C', text: optC }, { key: 'D', text: optD },
          ] as any;
          const questionType = optionalCell(row, 'questionType');

          const existingId = existingQByKey.get(key);
          if (existingId) {
            // already in the system -> refresh it from the sheet (questionType only when the sheet gives one)
            const data: Record<string, any> = { questionText, optionsJson, correctAnswer, explanation };
            if (questionType !== null) data.questionType = questionType;
            toUpdateQ.push({ id: existingId, data });
            continue;
          }

          toCreateQ.push({ wordId, questionText, optionsJson, correctAnswer, explanation, questionType, _label: wordLabel });
        } catch (e) {
          result.errors.push({ sheet: 'Questions', row: rowNum, error: e instanceof Error ? e.message : String(e) });
        }
      }

      if (toUpdateQ.length) {
        if (!dryRun) {
          for (let i = 0; i < toUpdateQ.length; i += 100) {
            await this.prisma.$transaction(
              toUpdateQ.slice(i, i + 100).map((u) => this.prisma.vocabQuestion.update({ where: { id: u.id }, data: u.data })),
            );
          }
        }
        result.questionsUpdated = toUpdateQ.length;
      }

      if (toCreateQ.length) {
        if (!dryRun) {
          const data = toCreateQ.map(({ _label, ...rest }) => rest);
          for (let i = 0; i < data.length; i += 300) {
            await this.prisma.vocabQuestion.createMany({ data: data.slice(i, i + 300) });
          }
        }
        for (const q of toCreateQ) rep(q._label).questionsCreated++;
        result.questionsCreated = toCreateQ.length;
      }
    }

    result.wordReport = [...report.values()].filter(
      (r) => r.wordStatus !== 'OK' || Object.keys(r.rejected).length > 0,
    );
    result.success = result.errors.length === 0 && result.skipped.length === 0;
    return result;
  }
}
