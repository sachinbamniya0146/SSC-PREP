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
import { PrismaService } from '../prisma/prisma.service';

export interface VocabUploadResult {
  success: boolean;
  wordsCreated: number;
  wordsUpdated: number;
  questionsCreated: number;
  questionsUpdated: number;
  errors: { sheet: string; row: number; error: string }[];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function cell(row: any, key: string): string {
  const v = row[key];
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

  async uploadFromExcel(buffer: Buffer): Promise<VocabUploadResult> {
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
      wordsCreated: 0,
      wordsUpdated: 0,
      questionsCreated: 0,
      questionsUpdated: 0,
      errors: [],
    };

    // ---- Words sheet: upsert by slug ----
    const slugToId = new Map<string, string>();
    if (wordsSheet) {
      const rows: any[] = XLSX.utils.sheet_to_json(wordsSheet, { defval: '' });
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;
        try {
          const wordText = cell(row, 'word');
          if (!wordText) throw new Error("'word' column is required");
          const slug = cell(row, 'slug') || slugify(wordText);
          const meaningHindi = cell(row, 'meaningHindi');
          const meaningEnglish = cell(row, 'meaningEnglish');
          if (!meaningHindi || !meaningEnglish) throw new Error("'meaningHindi' and 'meaningEnglish' are required");
          const orderIndexRaw = cell(row, 'orderIndex');
          const orderIndex = orderIndexRaw ? parseInt(orderIndexRaw, 10) : 999999;
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
          try {
            synonyms = synRaw ? JSON.parse(synRaw) : [];
          } catch {
            throw new Error("'synonymsJson' is not valid JSON");
          }
          try {
            antonyms = antRaw ? JSON.parse(antRaw) : [];
          } catch {
            throw new Error("'antonymsJson' is not valid JSON");
          }

          const data = {
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
          };

          const existing = await this.prisma.vocabWord.findUnique({ where: { slug } });
          if (existing) {
            await this.prisma.vocabWord.update({ where: { id: existing.id }, data });
            slugToId.set(slug, existing.id);
            result.wordsUpdated++;
          } else {
            const created = await this.prisma.vocabWord.create({ data: { slug, ...data } });
            slugToId.set(slug, created.id);
            result.wordsCreated++;
          }
        } catch (e) {
          result.errors.push({ sheet: 'Words', row: rowNum, error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    // Words not in this upload but already in the DB still need to be
    // resolvable, so the Questions sheet can reference a word that wasn't
    // re-uploaded this time (e.g. adding more questions to an existing word).
    if (questionsSheet) {
      const existingWords = await this.prisma.vocabWord.findMany({ select: { id: true, slug: true } });
      for (const w of existingWords) if (!slugToId.has(w.slug)) slugToId.set(w.slug, w.id);
    }

    // ---- Questions sheet: match by (wordId, questionText), update or create ----
    if (questionsSheet) {
      const rows: any[] = XLSX.utils.sheet_to_json(questionsSheet, { defval: '' });
      // Prefetch existing questions per word so each row is an in-memory
      // lookup, not a query — same N+1 avoidance as the main bank importer.
      const neededWordIds = [...new Set(rows.map((r) => slugToId.get(cell(r, 'wordSlug'))).filter(Boolean))] as string[];
      const existingQuestions = neededWordIds.length
        ? await this.prisma.vocabQuestion.findMany({ where: { wordId: { in: neededWordIds } } })
        : [];
      const existingByKey = new Map(existingQuestions.map((q) => [`${q.wordId}::${q.questionText}`, q]));

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;
        try {
          const wordSlug = cell(row, 'wordSlug');
          if (!wordSlug) throw new Error("'wordSlug' is required");
          const wordId = slugToId.get(wordSlug);
          if (!wordId) throw new Error(`wordSlug '${wordSlug}' does not match any word (check spelling / upload the Words sheet first)`);

          const questionText = cell(row, 'questionText');
          if (!questionText) throw new Error("'questionText' is required");
          const optA = cell(row, 'optionA');
          const optB = cell(row, 'optionB');
          const optC = cell(row, 'optionC');
          const optD = cell(row, 'optionD');
          if (!optA || !optB || !optC || !optD) throw new Error('All four options (optionA-D) are required');
          const correctAnswer = cell(row, 'correctAnswer').toUpperCase();
          if (!['A', 'B', 'C', 'D'].includes(correctAnswer)) throw new Error("'correctAnswer' must be A, B, C or D");

          const data = {
            wordId,
            questionText,
            optionsJson: [
              { key: 'A', text: optA },
              { key: 'B', text: optB },
              { key: 'C', text: optC },
              { key: 'D', text: optD },
            ] as any,
            correctAnswer,
            explanation: optionalCell(row, 'explanation'),
            questionType: optionalCell(row, 'questionType'),
          };

          const key = `${wordId}::${questionText}`;
          const existing = existingByKey.get(key);
          if (existing) {
            await this.prisma.vocabQuestion.update({ where: { id: existing.id }, data });
            result.questionsUpdated++;
          } else {
            await this.prisma.vocabQuestion.create({ data });
            result.questionsCreated++;
          }
        } catch (e) {
          result.errors.push({ sheet: 'Questions', row: rowNum, error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    result.success = result.errors.length === 0;
    return result;
  }
}
