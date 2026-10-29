// Practice-question Excel template + "edit by ID" helpers (Oct 15 2026, Task B). Pure: no Nest / Prisma imports, unit-tested.
import { normalizeExamTier, normalizeTierPaper, parsePaperQuestionNo } from '../common/pyq-paper-key';
import { parseExamDate } from '../common/exam-date-format';

export interface TemplateColumn {
  key: string;            // header the parser reads (without the trailing *)
  required: boolean;      // shown as "key*" in the header row (the parser strips the *)
  hint: string;           // English help shown as a cell comment + in the "Columns guide" sheet
  example: string;
  width: number;
  list?: 'answers' | 'difficulty' | 'exams' | 'subjects' | 'chapters' | 'shifts' | 'tiers' | 'papers';
}

/** Order = order of the columns in the sheet. `id` is first: blank = new question, filled = update that question. */
export const PRACTICE_COLUMNS: TemplateColumn[] = [
  { key: 'id', required: false, hint: 'Leave EMPTY for a NEW question. If you keep the ID that came from an export file, that same question is UPDATED (no duplicate is created).', example: '', width: 14 },
  { key: 'examId', required: true, hint: 'Slug of the exam — choose from the dropdown (full list in the Reference IDs sheet).', example: 'ssc-cgl', width: 16, list: 'exams' },
  { key: 'subjectId', required: true, hint: 'Slug of the subject — choose from the dropdown.', example: 'quantitative-aptitude', width: 22, list: 'subjects' },
  { key: 'chapterId', required: true, hint: 'Slug or exact name of the chapter — choose from the dropdown. The chapter must already exist in the database.', example: 'percentage', width: 22, list: 'chapters' },
  { key: 'topicId', required: false, hint: 'Optional. Slug or name of the topic. A new name is created automatically under the chapter.', example: 'basic-percentage-concepts', width: 24 },
  { key: 'subTopicId', required: false, hint: 'Optional. Slug or name of the sub-topic.', example: '', width: 18 },
  { key: 'questionText', required: true, hint: 'The English text of the question. It cannot be left empty.', example: 'What is 20% of 150?', width: 46 },
  { key: 'questionTextHindi', required: false, hint: 'The Hindi text of the question. If empty, the question is saved UNPUBLISHED (until Hindi is added).', example: '150 का 20% क्या है?', width: 40 },
  { key: 'optionA', required: true, hint: 'Option A (text).', example: '25', width: 16 },
  { key: 'optionA_Hindi', required: false, hint: 'Option A Hindi (optional).', example: '25', width: 16 },
  { key: 'optionB', required: true, hint: 'Option B (text).', example: '30', width: 16 },
  { key: 'optionB_Hindi', required: false, hint: 'Option B Hindi (optional).', example: '30', width: 16 },
  { key: 'optionC', required: true, hint: 'Option C (text).', example: '35', width: 16 },
  { key: 'optionC_Hindi', required: false, hint: 'Option C Hindi (optional).', example: '35', width: 16 },
  { key: 'optionD', required: true, hint: 'Option D (text).', example: '40', width: 16 },
  { key: 'optionD_Hindi', required: false, hint: 'Option D Hindi (optional).', example: '40', width: 16 },
  { key: 'correctAnswer', required: true, hint: 'Only A, B, C or D — choose from the dropdown. The text of that option must not be empty.', example: 'B', width: 14, list: 'answers' },
  { key: 'explanation', required: true, hint: 'Solution (English). A question without a solution is NOT uploaded.', example: '20% of 150 = 150 × 20 / 100 = 30', width: 46 },
  { key: 'explanationHindi', required: false, hint: 'Solution Hindi me (optional).', example: '150 का 20% = 150 × 20 / 100 = 30', width: 40 },
  { key: 'difficulty', required: false, hint: 'EASY, MEDIUM or HARD — dropdown. Empty = MEDIUM (for a new question).', example: 'EASY', width: 14, list: 'difficulty' },
  { key: 'marks', required: false, hint: 'Number. Empty = 1.', example: '1', width: 10 },
  { key: 'negativeMarks', required: false, hint: 'Number. Empty = 0.25.', example: '0.25', width: 14 },
];

export const ANSWER_LIST = ['A', 'B', 'C', 'D'];
export const DIFFICULTY_LIST = ['EASY', 'MEDIUM', 'HARD'];
export const SHIFT_LIST = ['Shift 1', 'Shift 2', 'Shift 3', 'Shift 4'];
export const TIER_LIST = ['TIER_1', 'TIER_2'];
export const TIER_PAPER_LIST = ['PAPER_1', 'PAPER_2', 'PAPER_3'];

/**
 * "PYQ + Practice" template (S37, 29 Oct 2026): the 34 columns of the Master Package v3/v4 sheet, in the SAME order,
 * so a file made from the Master Package uploads as it is. One row = one question; a row with year / examDate is a PYQ,
 * a row with both empty is a practice question (shift, paperCode, examDate, examTier, tierPaper and questionNo are then ignored).
 */
export const MIXED_COLUMNS: TemplateColumn[] = [
  { key: 'examId', required: true, hint: 'Exam slug from the Reference IDs sheet. An exam that is not there yet (Selection Post, Railway ...) must first be created in Admin -> Exams.', example: 'exam-cgl', width: 16, list: 'exams' },
  { key: 'subjectId', required: true, hint: 'Subject slug - dropdown.', example: 'sub-quantitative_aptitude', width: 24, list: 'subjects' },
  { key: 'chapterId', required: true, hint: 'Chapter slug or the exact chapter name (as in the book / syllabus). The chapter must already exist.', example: 'chap-percentage-quantitative_aptitude', width: 30, list: 'chapters' },
  { key: 'topicId', required: false, hint: 'Topic name or slug (from the syllabus). A new name is created under the chapter automatically.', example: 'Basic Percentage Concepts', width: 24 },
  { key: 'subTopicId', required: false, hint: 'Sub-topic name or slug. A new name is created under the topic automatically. Practice questions are counted per sub-topic (target 100).', example: 'Percentage change', width: 22 },
  { key: 'questionText', required: true, hint: 'English question text. No line breaks inside the cell.', example: 'What is 20% of 150?', width: 46 },
  { key: 'questionTextHindi', required: false, hint: 'Hindi question text. If empty the question is saved but students do NOT see it (English subject is exempt: it needs no Hindi question).', example: '150 का 20% क्या है?', width: 40 },
  { key: 'questionDiagramType', required: false, hint: 'Venn / figure code V1..V8 (see the Diagram types sheet of the Master Package). Image-based and non-verbal questions are normally NOT put in the Excel.', example: '', width: 14 },
  { key: 'questionDiagramLabels', required: false, hint: 'Labels of the diagram, separated by commas.', example: '', width: 18 },
  { key: 'optionA', required: true, hint: 'Option A text only (no "A)" prefix).', example: '25', width: 16 },
  { key: 'optionA_Hindi', required: false, hint: 'Option A in Hindi (English subject: leave empty, options are never translated).', example: '25', width: 16 },
  { key: 'optionB', required: true, hint: 'Option B text only.', example: '30', width: 16 },
  { key: 'optionB_Hindi', required: false, hint: 'Option B in Hindi.', example: '30', width: 16 },
  { key: 'optionC', required: true, hint: 'Option C text only.', example: '35', width: 16 },
  { key: 'optionC_Hindi', required: false, hint: 'Option C in Hindi.', example: '35', width: 16 },
  { key: 'optionD', required: true, hint: 'Option D text only.', example: '40', width: 16 },
  { key: 'optionD_Hindi', required: false, hint: 'Option D in Hindi.', example: '40', width: 16 },
  { key: 'optionDiagramTypes', required: false, hint: 'Diagram codes of the options, separated by | (V1|V3|V6|V2).', example: '', width: 16 },
  { key: 'optionDiagramLabels', required: false, hint: 'Labels of the option diagrams (| between options, commas between labels).', example: '', width: 16 },
  { key: 'questionImageUrl', required: false, hint: 'Only when a real image asset exists. Image questions are normally added by the admin by hand.', example: '', width: 16 },
  { key: 'optionImageUrls', required: false, hint: 'Image links of the options, separated by |.', example: '', width: 16 },
  { key: 'correctAnswer', required: true, hint: 'Only A, B, C or D - dropdown.', example: 'B', width: 14, list: 'answers' },
  { key: 'explanation', required: true, hint: 'English solution ("Detailed Logical Explanation:" with numbered steps). A row without a solution is NOT uploaded.', example: 'Detailed Logical Explanation:\n1. 20% of 150 = 150 × 20 / 100 = 30', width: 46 },
  { key: 'explanationHindi', required: false, hint: 'Hindi solution ("विस्तृत तार्किक व्याख्या:" with numbered steps).', example: 'विस्तृत तार्किक व्याख्या:\n1. 150 का 20% = 150 × 20 / 100 = 30', width: 40 },
  { key: 'year', required: false, hint: 'PYQ row: year of the exam (year of examDate). Practice row: EMPTY.', example: '2025', width: 10 },
  { key: 'shift', required: false, hint: 'PYQ row: Shift 1 / 2 / 3 / 4 exactly as printed. Morning=Shift 1, Afternoon=Shift 2, Evening=Shift 3 only when the source says so. Not printed: EMPTY. Practice row: EMPTY.', example: 'Shift 2', width: 12, list: 'shifts' },
  { key: 'paperCode', required: false, hint: 'PYQ row: label like SSC-CGL-T-I-12-Sep-2025-S2 (only a label, grouping uses exam + tier + date + shift). Practice row: EMPTY.', example: 'SSC-CGL-T-I-12-Sep-2025-S2', width: 28 },
  { key: 'marks', required: false, hint: 'Marks of the question as per THAT exam (CGL Tier 1 = 2, Tier 2 = 3; other exams differ). Empty = 1.', example: '2', width: 10 },
  { key: 'negativeMarks', required: false, hint: 'Negative marks as per THAT exam (CGL Tier 1 = 0.5). Empty = 0.25.', example: '0.5', width: 14 },
  { key: 'difficulty', required: false, hint: 'EASY / MEDIUM / HARD. Empty = MEDIUM.', example: 'MEDIUM', width: 12, list: 'difficulty' },
  { key: 'examDate', required: false, hint: 'PYQ row: the REAL exam date, ONLY in DD/MM/YYYY (two-digit day and month, four-digit year, e.g. 12/09/2025). No other format is accepted. Format this column as TEXT before typing. Verified from the PDF or an official source, never guessed. Practice row: EMPTY. (Only the admin ever sees dates.)', example: '12/09/2025', width: 14 },
  { key: 'examTier', required: false, hint: 'PYQ row: TIER_1 or TIER_2 (Railway CBT-1 = TIER_1, CBT-2 = TIER_2). Practice row: EMPTY.', example: 'TIER_1', width: 12, list: 'tiers' },
  { key: 'tierPaper', required: false, hint: 'Optional: PAPER_1 / PAPER_2 / PAPER_3 when one tier has several papers on the same day. Empty = PAPER_1.', example: '', width: 12, list: 'papers' },
  { key: 'questionNo', required: false, hint: 'PYQ row: the question number printed in the ORIGINAL paper (1-100). Not known: EMPTY (never a chapter-compilation serial number). Practice row: EMPTY.', example: '7', width: 12 },
];

/** Columns that only a PYQ row fills - a practice row leaves (and the importer ignores) every one of them. */
export const MIXED_PYQ_ONLY_KEYS: readonly string[] = ['year', 'shift', 'paperCode', 'examDate', 'examTier', 'tierPaper', 'questionNo'];

export function headerLabel(c: TemplateColumn): string {
  return c.required ? `${c.key}*` : c.key;
}

/** 0 -> A, 25 -> Z, 26 -> AA */
export function columnLetter(i: number): string {
  let n = i;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export interface ValidationSpec {
  col: number;              // 0-based column index
  formula: string;          // e.g. '"A,B,C,D"' or "Lists!$A$2:$A$9"
  title: string;
  message: string;
  strict: boolean;          // true = reject other values, false = warn only
  custom?: boolean;         // true = `formula` is a yes/no rule written for the FIRST data row (row 2), not a list
}

/**
 * Excel rule for the examDate column: blank, or TEXT written as DD/MM/YYYY (real day 01-31, month 01-12, year 2000-2100).
 * Written for row 2; Excel adjusts the row for the rest of the column. A date VALUE (not text) is refused on purpose - see
 * common/exam-date-format.ts. The server checks the same rule again on upload, this only stops the typo while typing.
 */
export function examDateValidation(col: number): ValidationSpec {
  const L = columnLetter(col);
  const c = `${L}2`;
  const formula =
    `OR(${c}="",AND(ISTEXT(${c}),LEN(${c})=10,MID(${c},3,1)="/",MID(${c},6,1)="/",` +
    `ISNUMBER(VALUE(MID(${c},1,2))),ISNUMBER(VALUE(MID(${c},4,2))),ISNUMBER(VALUE(MID(${c},7,4))),` +
    `VALUE(MID(${c},1,2))>=1,VALUE(MID(${c},1,2))<=31,VALUE(MID(${c},4,2))>=1,VALUE(MID(${c},4,2))<=12,` +
    `VALUE(MID(${c},7,4))>=2000,VALUE(MID(${c},7,4))<=2100))`;
  return {
    col,
    formula,
    title: 'examDate - only DD/MM/YYYY',
    message: 'Write the date ONLY as DD/MM/YYYY, e.g. 12/09/2025. Format the column as Text first (Format Cells -> Text). Leave empty on a practice row.',
    strict: true,
    custom: true,
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** <dataValidations> block for rows 2..maxRow of each listed column */
export function buildDataValidationsXml(specs: ValidationSpec[], maxRow = 5000): string {
  if (!specs.length) return '';
  const items = specs.map((s) => {
    const L = columnLetter(s.col);
    return `<dataValidation type="${s.custom ? 'custom' : 'list'}" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorStyle="${s.strict ? 'stop' : 'warning'}" errorTitle="${esc(s.title)}" error="${esc(s.message)}" promptTitle="${esc(s.title)}" prompt="${esc(s.message)}" sqref="${L}2:${L}${maxRow}"><formula1>${esc(s.formula)}</formula1></dataValidation>`;
  });
  return `<dataValidations count="${items.length}">${items.join('')}</dataValidations>`;
}

/** adds dataValidations (before pageMargins) and a frozen header row to SheetJS' worksheet XML */
export function injectSheetXml(xml: string, validationsXml: string, freezeFirstRow = true): string {
  let out = xml;
  if (validationsXml) {
    // OOXML element order: ... sheetData, mergeCells, conditionalFormatting, dataValidations, hyperlinks, printOptions, pageMargins ...
    // ignoredErrors, drawing, legacyDrawing ... extLst. So it goes before the FIRST of those that exists, else at the very end.
    const after = /<(hyperlinks|printOptions|pageMargins|pageSetup|headerFooter|rowBreaks|colBreaks|customProperties|cellWatches|ignoredErrors|smartTags|drawing|legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/;
    const m = after.exec(out);
    out = m ? out.slice(0, m.index) + validationsXml + out.slice(m.index) : out.replace(/<\/worksheet>/, `${validationsXml}</worksheet>`);
  }
  if (freezeFirstRow) {
    const pane = '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>';
    if (/<sheetView\b[^>]*\/>/.test(out)) out = out.replace(/<sheetView\b([^>]*)\/>/, `<sheetView$1>${pane}</sheetView>`);
    else if (/<sheetViews>/.test(out) && !/<sheetView\b/.test(out)) out = out.replace(/<sheetViews>/, `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView>`);
  }
  return out;
}

// ------------------------------------------------------------------ edit-by-ID

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isQuestionId = (s: unknown): s is string => typeof s === 'string' && UUID.test(s.trim());

export type UpdateBody = Record<string, unknown> & { options?: Array<{ key: string; text: string; textHi?: string }> };

/**
 * Only NON-EMPTY cells go into the update (blank = "leave as it is"), so a half-filled row can never wipe data.
 * Taxonomy columns (exam / subject / chapter / topic) are NOT changed by a re-upload — move a question in
 * Questions → Manage. `practiceOnly` ignores year / shift / paperCode / examDate.
 */
export function buildUpdateBody(
  headerMap: Record<string, number>,
  row: unknown[],
  existingOptions: Array<{ key?: string; text?: string; textHi?: string }>,
  practiceOnly: boolean,
): { body: UpdateBody; problems: string[] } {
  const get = (k: string): string => {
    const i = headerMap[k];
    return i !== undefined && row[i] !== undefined && row[i] !== null ? String(row[i]).trim() : '';
  };
  const body: UpdateBody = {};
  const problems: string[] = [];
  for (const k of ['questionText', 'questionTextHindi', 'explanation', 'explanationHindi']) if (get(k)) body[k] = get(k);
  if (get('correctAnswer')) {
    const a = get('correctAnswer').toUpperCase();
    if (!ANSWER_LIST.includes(a)) problems.push(`correctAnswer is invalid ("${get('correctAnswer')}") — it must be A/B/C/D`);
    else body.correctAnswer = a;
  }
  if (get('difficulty')) {
    const d = get('difficulty').toUpperCase();
    if (!DIFFICULTY_LIST.includes(d)) problems.push(`difficulty is invalid ("${get('difficulty')}") — it must be EASY/MEDIUM/HARD`);
    else body.difficulty = d;
  }
  for (const k of ['marks', 'negativeMarks']) {
    if (get(k)) {
      const n = Number(get(k));
      if (!Number.isFinite(n)) problems.push(`${k} must be a number ("${get(k)}")`);
      else body[k] = n;
    }
  }
  if (!practiceOnly) for (const k of ['year', 'shift', 'paperCode']) if (get(k)) body[k] = get(k);
  // 30 Oct 2026: the date is read ONLY as DD/MM/YYYY (same rule as an upload); the update API gets the stored YYYY-MM-DD form
  if (!practiceOnly && get('examDate')) {
    try {
      body.examDate = parseExamDate(get('examDate'));
    } catch (e) {
      problems.push(e instanceof Error ? e.message : 'examDate is invalid');
    }
  }
  // date-wise + tier-wise mocks (26 Oct 2026)
  if (!practiceOnly) {
    if (get('examTier')) {
      const t = normalizeExamTier(get('examTier'));
      if (t.invalid) problems.push(`examTier is invalid ("${get('examTier')}") — it must be TIER_1 or TIER_2`);
      else body.examTier = t.tier;
    }
    if (get('tierPaper')) {
      const t = normalizeTierPaper(get('tierPaper'));
      if (t.invalid) problems.push(`tierPaper is invalid ("${get('tierPaper')}") — it must be PAPER_1 / PAPER_2 / PAPER_3`);
      else body.tierPaper = t.paper;
    }
    if (get('questionNo')) {
      const n = parsePaperQuestionNo(get('questionNo'));
      if (n === undefined) problems.push(`questionNo must be a whole number of 1 or more ("${get('questionNo')}")`);
      else body.paperQuestionNo = n;
    }
  }
  // options: any non-empty option cell -> send all four, the rest taken from the existing question
  const keys = ['A', 'B', 'C', 'D'];
  if (keys.some((k) => get(`option${k}`) || get(`option${k}_Hindi`))) {
    body.options = keys.map((k) => {
      const prev = existingOptions.find((o) => o?.key === k) ?? {};
      return { key: k, text: get(`option${k}`) || String(prev.text ?? ''), textHi: get(`option${k}_Hindi`) || String(prev.textHi ?? '') };
    });
  }
  return { body, problems };
}

const nz = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

/** which fields of `body` really differ from the stored question (names for the preview) */
export function diffUpdate(
  existing: { questionText?: string | null; questionTextHindi?: string | null; explanation?: string | null; explanationHindi?: string | null; correctAnswer?: string | null; difficulty?: string | null; marks?: number | null; negativeMarks?: number | null; year?: number | null; shift?: string | null; paperCode?: string | null; examDate?: string | null; examTier?: string | null; tierPaper?: string | null; paperQuestionNo?: number | null; optionsJson?: unknown },
  body: UpdateBody,
): string[] {
  const changed: string[] = [];
  for (const k of ['questionText', 'questionTextHindi', 'explanation', 'explanationHindi', 'correctAnswer', 'difficulty', 'shift', 'paperCode', 'examDate', 'examTier', 'tierPaper'] as const) {
    if (k in body && nz(body[k]) !== nz((existing as Record<string, unknown>)[k])) changed.push(k);
  }
  for (const k of ['marks', 'negativeMarks', 'year', 'paperQuestionNo'] as const) {
    if (k in body && Number(body[k]) !== Number((existing as Record<string, unknown>)[k])) changed.push(k);
  }
  if (body.options) {
    const old = Array.isArray(existing.optionsJson) ? (existing.optionsJson as Array<{ key?: string; text?: string; textHi?: string }>) : [];
    for (const o of body.options) {
      const p = old.find((x) => x?.key === o.key) ?? {};
      if (nz(o.text) !== nz(p.text)) changed.push(`option${o.key}`);
      if (nz(o.textHi) !== nz(p.textHi)) changed.push(`option${o.key}_Hindi`);
    }
  }
  return changed;
}

/** true when the header row has an `id` column (with or without a trailing *) — such a file may UPDATE existing questions */
export function headersHaveIdColumn(headers: unknown[]): boolean {
  return headers.some((h) => String(h ?? '').trim().replace(/\*\s*$/, '').toLowerCase() === 'id');
}
