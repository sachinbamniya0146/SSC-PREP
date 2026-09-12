/* eslint-disable @typescript-eslint/no-explicit-any */
// Bulk syllabus importer — reads a bilingual syllabus workbook in the exact
// shape of SSC_Exams_Complete_Syllabus_Hindi.xlsx and upserts it into the
// Subject -> Chapter -> Topic -> SubTopic taxonomy tables.
//
// Expected sheet layout (one sheet per Subject; a sheet literally named
// "Overview" is skipped):
//   row 1: Subject name (English)
//   row 2: Subject name (Hindi)
//   row 3: blank
//   row 4: header — S.No. | Chapter No. | Chapter | Topic | Sub-Topic
//   row 5+: data rows. Chapter No. / Chapter are only filled in on the FIRST
//           row of a new chapter (the rest look blank because they're
//           visually merged in Excel); Topic and Sub-Topic are given on
//           every row. Every Chapter/Topic/Sub-Topic cell holds both
//           languages as "English\nHindi" (two lines in one cell).
//   ends at the first fully-blank row, or the trailing
//   "Total Chapters: N | Total Topics/Sub-Topics Listed: M" summary row.
//
// Idempotent: safe to re-run on the same file (or an edited version of it)
// any number of times. Subject is matched on its slug, Chapter on
// (subjectId, slug), Topic on (chapterId, slug), SubTopic on (topicId, slug)
// — matching the unique constraints added in the
// 20260912_add_taxonomy_hindi_and_subtopic_unique migration — so nothing is
// duplicated; existing rows just get their name/nameHindi refreshed.
import { Injectable, BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { cacheClearPrefix } from '../common/cache';

interface ParsedSubTopic {
  name: string;
  nameHindi: string | null;
}
interface ParsedTopic {
  name: string;
  nameHindi: string | null;
  subTopics: ParsedSubTopic[];
}
interface ParsedChapter {
  name: string;
  nameHindi: string | null;
  topics: ParsedTopic[];
}
interface ParsedSubject {
  name: string;
  nameHindi: string | null;
  sheetName: string;
  chapters: ParsedChapter[];
}

// BUGFIX (Sep 2026 — "syllabus Excel import karne ke baad Topic Management
// mein purane Reasoning/Quant/English/General Awareness ke bajaye alag hi
// subject dikhta hai / topics purane chapters ke andar nahi aate"):
//
// bank.service.ts seeds (and the whole rest of the app — tests.service.ts,
// question-bank-practice.service.ts, pdf-export.service.ts, etc.) all key
// off FOUR fixed subject slugs, using an UNDERSCORE convention:
//   reasoning | quantitative_aptitude | english | general_awareness
//
// But SSC_Exams_Complete_Syllabus_Hindi.xlsx's row-1 cell in each sheet is
// the full official exam-syllabus title, not that short name — e.g. the
// "Reasoning" sheet's row 1 says "General Intelligence & Reasoning". This
// importer used to slugify() that full title directly (hyphen-based), so
// every single one of the four sheets produced a slug that could NEVER
// match the app's real subjects:
//   "General Intelligence & Reasoning"        -> general-intelligence-reasoning   (real: reasoning)
//   "Quantitative Aptitude (Maths)"           -> quantitative-aptitude-maths      (real: quantitative_aptitude)
//   "English Language & Comprehension"        -> english-language-comprehension  (real: english)
//   "General Awareness / General Knowledge"   -> general-awareness-general-knowledge (real: general_awareness)
//
// Net effect: importing the syllabus created FOUR brand-new, empty-of-
// questions duplicate subjects sitting next to the real ones instead of
// adding chapters/topics/sub-topics onto the real Reasoning/Quantitative
// Aptitude/English/General Awareness that already have thousands of
// questions and non-zero chapter counts in the admin panel — exactly the
// "topic manage mein chapter ke naam ke hisaab se nahi dikhta" symptom.
//
// Fix: match on the WORKBOOK SHEET NAME (not the row-1 title) against a
// small alias table of the app's real subject slugs. Sheet names in
// SSC_Exams_Complete_Syllabus_Hindi.xlsx are the short, stable ones
// ("Quant Aptitude", "Reasoning", "English", "General Awareness") and
// match this table directly. Any OTHER sheet name (a future subject like
// "Computer Knowledge" or "Hindi" that isn't one of the four core ones)
// falls back to the old slugify(row-1-title) behavior exactly as before —
// nothing changes for those.
const CORE_SUBJECT_SLUG_BY_SHEET_NAME: Record<string, string> = {
  'quant aptitude': 'quantitative_aptitude',
  'quantitative aptitude': 'quantitative_aptitude',
  reasoning: 'reasoning',
  english: 'english',
  'general awareness': 'general_awareness',
};

export interface TaxonomyImportSummary {
  subjects: number;
  chapters: number;
  topics: number;
  subTopics: number;
  details: { subject: string; chapters: number; topics: number; subTopics: number }[];
}

@Injectable()
export class TaxonomyImportService {
  constructor(private prisma: PrismaService) {}

  private splitBilingual(cell: unknown): { en: string; hi: string | null } | null {
    if (cell == null) return null;
    const str = String(cell).trim();
    if (!str) return null;
    const parts = str
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return null;
    return { en: parts[0], hi: parts[1] ?? null };
  }

  private slugify(input: string): string {
    const slug = input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100);
    return slug || 'item';
  }

  /** Parses every recognizable subject sheet in the workbook. Pure function — no DB access. */
  parseWorkbook(buffer: Buffer): ParsedSubject[] {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(
        `Failed to parse Excel file: ${message} — check the file is a real, unpassword-protected .xlsx/.xls.`,
      );
    }

    const subjects: ParsedSubject[] = [];

    for (const sheetName of workbook.SheetNames) {
      if (sheetName.trim().toLowerCase() === 'overview') continue;

      const ws = workbook.Sheets[sheetName];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
      if (rows.length < 5) continue; // not enough rows to hold the expected layout

      const subjectEn = rows[0]?.[0] != null ? String(rows[0][0]).trim() : null;
      const subjectHi = rows[1]?.[0] != null ? String(rows[1][0]).trim() : null;
      if (!subjectEn) continue; // doesn't match the expected layout — skip this sheet

      const subject: ParsedSubject = {
        name: subjectEn,
        nameHindi: subjectHi || null,
        sheetName: sheetName.trim(),
        chapters: [],
      };

      let currentChapter: ParsedChapter | null = null;
      let currentTopic: ParsedTopic | null = null;

      // Data starts at row index 4 (0-based) = Excel row 5, right after the header row.
      for (let i = 4; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;

        const firstCell = row[0];
        const rowIsBlank = row.every((c) => c == null || String(c).trim() === '');
        const isSummaryRow =
          typeof firstCell === 'string' && firstCell.trim().toLowerCase().startsWith('total chapters');
        if (rowIsBlank || isSummaryRow) break;

        const chapterCell = row[2];
        const topicCell = row[3];
        const subTopicCell = row[4];

        const chapterParsed = this.splitBilingual(chapterCell);
        if (chapterParsed) {
          currentChapter = { name: chapterParsed.en, nameHindi: chapterParsed.hi, topics: [] };
          subject.chapters.push(currentChapter);
          currentTopic = null; // a new chapter always starts a fresh topic context
        }
        if (!currentChapter) continue; // malformed leading rows with no chapter yet — skip defensively

        const topicParsed = this.splitBilingual(topicCell);
        if (topicParsed) {
          // Re-use the same Topic if this row repeats the immediately preceding
          // topic name, so its sub-topics stay grouped under one Topic entry.
          if (!currentTopic || currentTopic.name !== topicParsed.en) {
            currentTopic = { name: topicParsed.en, nameHindi: topicParsed.hi, subTopics: [] };
            currentChapter.topics.push(currentTopic);
          }
        }
        if (!currentTopic) continue;

        const subTopicParsed = this.splitBilingual(subTopicCell);
        if (subTopicParsed) {
          currentTopic.subTopics.push({ name: subTopicParsed.en, nameHindi: subTopicParsed.hi });
        }
      }

      subjects.push(subject);
    }

    return subjects;
  }

  /** Parses the workbook and upserts everything into Subject/Chapter/Topic/SubTopic. */
  async importFromExcel(buffer: Buffer): Promise<TaxonomyImportSummary> {
    const subjects = this.parseWorkbook(buffer);
    if (!subjects.length) {
      throw new BadRequestException(
        'No recognizable subject sheets found. Expected sheets like "Quant Aptitude", "Reasoning", ' +
          '"English", "General Awareness" laid out like SSC_Exams_Complete_Syllabus_Hindi.xlsx ' +
          '(subject name in row 1, Hindi name in row 2, header in row 4, data from row 5).',
      );
    }

    const summary: TaxonomyImportSummary = { subjects: 0, chapters: 0, topics: 0, subTopics: 0, details: [] };

    for (const s of subjects) {
      // See CORE_SUBJECT_SLUG_BY_SHEET_NAME doc-comment above: for the four
      // core subjects, match by sheet name onto the app's REAL existing
      // slug instead of slugifying the syllabus's full official title —
      // that's what stops this import from spawning duplicate subjects.
      const coreSlug = CORE_SUBJECT_SLUG_BY_SHEET_NAME[s.sheetName.toLowerCase()];
      const subjectSlug = coreSlug ?? this.slugify(s.name);
      const subjectRow = await this.prisma.subject.upsert({
        where: { slug: subjectSlug },
        create: { name: s.name, nameHindi: s.nameHindi, slug: subjectSlug },
        // For a core subject that already exists (the normal case on a
        // real deployment), deliberately DON'T overwrite its existing
        // `name` (e.g. keep "Reasoning", don't rename it to the syllabus's
        // "General Intelligence & Reasoning") — only add/refresh the Hindi
        // name. Every other part of the app displays/matches on that
        // existing English name, so it must stay exactly as it was.
        // Non-core subjects (no alias match) keep the old behavior of
        // updating both name and nameHindi from the sheet.
        update: coreSlug ? { nameHindi: s.nameHindi } : { name: s.name, nameHindi: s.nameHindi },
      });
      summary.subjects++;

      let chapterCount = 0;
      let topicCount = 0;
      let subTopicCount = 0;

      for (const c of s.chapters) {
        const chapterSlug = this.slugify(c.name);
        const chapterRow = await this.prisma.chapter.upsert({
          where: { subjectId_slug: { subjectId: subjectRow.id, slug: chapterSlug } },
          create: { subjectId: subjectRow.id, name: c.name, nameHindi: c.nameHindi, slug: chapterSlug },
          update: { name: c.name, nameHindi: c.nameHindi },
        });
        chapterCount++;

        for (const t of c.topics) {
          const topicSlug = this.slugify(t.name);
          const topicRow = await this.prisma.topic.upsert({
            where: { chapterId_slug: { chapterId: chapterRow.id, slug: topicSlug } },
            create: { chapterId: chapterRow.id, name: t.name, nameHindi: t.nameHindi, slug: topicSlug },
            update: { name: t.name, nameHindi: t.nameHindi },
          });
          topicCount++;

          for (const st of t.subTopics) {
            const subTopicSlug = this.slugify(st.name);
            await this.prisma.subTopic.upsert({
              where: { topicId_slug: { topicId: topicRow.id, slug: subTopicSlug } },
              create: { topicId: topicRow.id, name: st.name, nameHindi: st.nameHindi, slug: subTopicSlug },
              update: { name: st.name, nameHindi: st.nameHindi },
            });
            subTopicCount++;
          }
        }
      }

      summary.chapters += chapterCount;
      summary.topics += topicCount;
      summary.subTopics += subTopicCount;
      summary.details.push({ subject: s.name, chapters: chapterCount, topics: topicCount, subTopics: subTopicCount });
    }

    // BUGFIX (Sep 2026 — "syllabus Excel import ke baad admin panel pe
    // purane counts dikhte hain"): bank.service.ts's subjects()/chapters()
    // cache their results for 5 minutes. Without this, a fresh import sat
    // invisible behind that stale cache for up to 5 minutes regardless of
    // how many times the admin reloaded /admin/topics — the upload itself
    // always worked, only the READ was stale. Clearing both prefixes here
    // means the very next GET /bank/subjects or /bank/chapters right after
    // this import returns fresh counts immediately.
    cacheClearPrefix('bank:subjects');
    cacheClearPrefix('bank:chapters');
    cacheClearPrefix('bank:meta');

    return summary;
  }
}
