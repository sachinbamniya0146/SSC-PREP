/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase 2 (Sachin, Sep 2026) — "admin excel se topic subtopic import kar
// sake, chapter vagera sabh, aur usme se direct hi attach karke admin
// upload kar dega".
//
// ROOT CAUSE this closes: bank-upload.service.ts's Excel/CSV/JSON/Word
// question importer has ALWAYS required a real chapterId/topicId/
// subTopicId to already exist in the DB — it never auto-creates taxonomy
// rows (see bank-upload.service.ts's "Invalid Reference" checks). Sachin's
// own upload_errors CSV (Sep 11 2026) is a direct symptom: every single row
// failed with `chapterId "chap-..." not found in database` because the
// chapter/topic itself was never created first. This service closes that
// gap: point it at a syllabus-shaped Excel (one sheet per subject, columns
// Chapter No / Chapter / Topic / Sub-Topic, exactly like
// SSC_Exams_Complete_Syllabus_Hindi.xlsx) and it creates the whole
// Subject → Chapter → Topic → SubTopic tree in one go, bilingually. Re-run
// safely any time — everything is upserted by slug, never duplicated.
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as XLSX from 'xlsx';
import { BankService } from './bank.service';

function slugify(raw: string, fallback: string): string {
  const s = (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return s || fallback;
}

// Cells in Sachin's syllabus workbook are bilingual, English and Hindi
// joined by a literal newline inside the cell — e.g.
// "Reading Comprehension\nगद्यांश बोधन". Split on the FIRST newline only
// (Hindi text itself never contains one), so a Hindi phrase with internal
// wrapping doesn't get chopped into pieces.
function splitBilingual(raw: any): { en: string; hi: string | null } {
  const text = raw == null ? '' : String(raw).trim();
  if (!text) return { en: '', hi: null };
  const nl = text.indexOf('\n');
  if (nl === -1) return { en: text, hi: null };
  const en = text.slice(0, nl).trim();
  const hi = text.slice(nl + 1).trim();
  return { en, hi: hi || null };
}

export interface TaxonomyImportResult {
  sheet: string;
  subjectName: string;
  subjectCreated: boolean;
  chaptersCreated: number;
  topicsCreated: number;
  subTopicsCreated: number;
  rowsProcessed: number;
  warnings: string[];
}

@Injectable()
export class TaxonomyImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bank: BankService,
  ) {}

  async importFromExcel(buffer: Buffer, _adminId: string): Promise<{ results: TaxonomyImportResult[]; totalRows: number }> {
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(buffer, { type: 'buffer' });
    } catch {
      throw new BadRequestException('Could not read the Excel file — make sure it is a valid .xlsx/.xls');
    }
    if (!wb.SheetNames.length) throw new BadRequestException('Excel file has no sheets');

    const results: TaxonomyImportResult[] = [];
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
      if (!rows.length) continue;
      results.push(await this.importSheet(sheetName, rows));
    }

    const totalRows = results.reduce((s, r) => s + r.rowsProcessed, 0);
    if (totalRows === 0) {
      throw new BadRequestException(
        'No data rows found in any sheet. Expected columns: S.No / Chapter No. / Chapter / Topic / Sub-Topic (bilingual cells as "English<newline>Hindi").',
      );
    }
    return { results, totalRows };
  }

  private async importSheet(sheetName: string, rows: any[][]): Promise<TaxonomyImportResult> {
    const warnings: string[] = [];

    // Row 1 = subject name (English), row 2 = subject name (Hindi) — matches
    // SSC_Exams_Complete_Syllabus_Hindi.xlsx exactly. If row 2 doesn't look
    // like a lone name (e.g. it's already the header row), fall back to the
    // sheet name itself as the English subject name.
    let subjectEn = String(rows[0]?.[0] ?? '').trim() || sheetName;
    let subjectHi: string | null = null;
    const row2Col0 = String(rows[1]?.[0] ?? '').trim();
    if (row2Col0 && !/chapter|topic|s\.?no/i.test(row2Col0)) {
      subjectHi = row2Col0;
    }

    // Find the header row — scan the first 8 rows for one containing both
    // "Chapter" and "Topic" (case-insensitive) in any cell.
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(8, rows.length); i++) {
      const joined = rows[i].join(' ').toLowerCase();
      if (joined.includes('chapter') && joined.includes('topic')) {
        headerRowIdx = i;
        break;
      }
    }
    if (headerRowIdx === -1) {
      warnings.push(`Sheet "${sheetName}": no header row found (expected a row containing "Chapter" and "Topic") — sheet skipped.`);
      return { sheet: sheetName, subjectName: subjectEn, subjectCreated: false, chaptersCreated: 0, topicsCreated: 0, subTopicsCreated: 0, rowsProcessed: 0, warnings };
    }
    const header = rows[headerRowIdx].map((h) => String(h ?? '').toLowerCase());
    const colChapter = header.findIndex((h) => h.includes('chapter') && !h.includes('no'));
    const colTopic = header.findIndex((h) => h.includes('topic') && !h.includes('sub'));
    const colSubTopic = header.findIndex((h) => h.includes('sub') && h.includes('topic'));
    if (colChapter === -1 || colTopic === -1) {
      warnings.push(`Sheet "${sheetName}": couldn't find "Chapter" / "Topic" columns in the header row — sheet skipped.`);
      return { sheet: sheetName, subjectName: subjectEn, subjectCreated: false, chaptersCreated: 0, topicsCreated: 0, subTopicsCreated: 0, rowsProcessed: 0, warnings };
    }

    // ---- Subject: find-or-create ----
    const subjectSlug = slugify(subjectEn, 'subject');
    let subject = await this.prisma.subject.findUnique({ where: { slug: subjectSlug } });
    let subjectCreated = false;
    if (!subject) {
      subject = await this.prisma.subject.create({ data: { name: subjectEn, nameHindi: subjectHi, slug: subjectSlug } });
      subjectCreated = true;
    } else if (subjectHi && !subject.nameHindi) {
      subject = await this.prisma.subject.update({ where: { id: subject.id }, data: { nameHindi: subjectHi } });
    }

    let chaptersCreated = 0;
    let topicsCreated = 0;
    let subTopicsCreated = 0;
    let rowsProcessed = 0;

    // Sparse-fill carry-forward: the source workbook only fills Chapter/Topic
    // cells on the FIRST row of each group and leaves them blank on
    // subsequent rows (no actual Excel merged cells) — same pattern used for
    // Chapter No. too. Carry the last seen value forward across blank cells.
    let lastChapterCell = '';
    let lastTopicCell = '';
    let lastChapterId: string | null = null;
    let lastTopicId: string | null = null;

    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every((c) => String(c ?? '').trim() === '')) continue; // blank spacer row

      const chapterCellRaw = String(row[colChapter] ?? '').trim();
      const topicCellRaw = String(row[colTopic] ?? '').trim();
      const subTopicCellRaw = colSubTopic !== -1 ? String(row[colSubTopic] ?? '').trim() : '';

      const chapterCell = chapterCellRaw || lastChapterCell;
      if (!chapterCell) {
        warnings.push(`Sheet "${sheetName}" row ${i + 1}: no chapter name (and none carried forward) — row skipped.`);
        continue;
      }
      const chapterBi = splitBilingual(chapterCell);
      if (!chapterBi.en) {
        warnings.push(`Sheet "${sheetName}" row ${i + 1}: empty chapter name — row skipped.`);
        continue;
      }

      // New chapter starts only when the cell actually had text this row.
      if (chapterCellRaw && chapterCell !== lastChapterCell) {
        const chSlug = slugify(chapterBi.en, `chapter-${i}`);
        const existingChapter = await this.prisma.chapter.findUnique({ where: { subjectId_slug: { subjectId: subject.id, slug: chSlug } } });
        if (existingChapter) {
          lastChapterId = existingChapter.id;
          if (chapterBi.hi && !existingChapter.nameHindi) {
            await this.prisma.chapter.update({ where: { id: existingChapter.id }, data: { nameHindi: chapterBi.hi } });
          }
        } else {
          const created = await this.prisma.chapter.create({
            data: { subjectId: subject.id, name: chapterBi.en, nameHindi: chapterBi.hi, slug: chSlug },
          });
          lastChapterId = created.id;
          chaptersCreated++;
        }
        lastChapterCell = chapterCell;
        // a new chapter resets topic carry-forward
        lastTopicCell = '';
        lastTopicId = null;
      }
      if (!lastChapterId) continue; // defensive — should never happen

      const topicCell = topicCellRaw || lastTopicCell;
      if (!topicCell) {
        warnings.push(`Sheet "${sheetName}" row ${i + 1}: no topic name — row skipped (chapter still created).`);
        continue;
      }
      const topicBi = splitBilingual(topicCell);
      if (topicCellRaw && topicCell !== lastTopicCell) {
        const topicSlugCandidate = slugify(topicBi.en, `topic-${i}`);
        const existedBefore = await this.prisma.topic.findUnique({
          where: { chapterId_slug: { chapterId: lastChapterId, slug: topicSlugCandidate } },
        });
        const result = await this.bank.createTopic(lastChapterId, topicBi.en, topicBi.hi || undefined);
        lastTopicId = result.id;
        if (!existedBefore) topicsCreated++;
        lastTopicCell = topicCell;
      }
      if (!lastTopicId) continue;

      // Sub-topic: optional. "—", "-", "" all mean "no sub-topic for this row".
      const subTopicBi = splitBilingual(subTopicCellRaw);
      if (subTopicBi.en && !/^[-—]$/.test(subTopicBi.en)) {
        const before = await this.prisma.subTopic.findUnique({
          where: { topicId_slug: { topicId: lastTopicId, slug: slugify(subTopicBi.en, `subtopic-${i}`) } },
        });
        await this.bank.createSubTopic(lastTopicId, subTopicBi.en, subTopicBi.hi || undefined);
        if (!before) subTopicsCreated++;
      }

      rowsProcessed++;
    }

    return {
      sheet: sheetName,
      subjectName: subject.name,
      subjectCreated,
      chaptersCreated,
      topicsCreated,
      subTopicsCreated,
      rowsProcessed,
      warnings,
    };
  }
}
