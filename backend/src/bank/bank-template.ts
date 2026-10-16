// Practice-question Excel template + "edit by ID" helpers (Oct 15 2026, Task B). Pure: no Nest / Prisma imports, unit-tested.

export interface TemplateColumn {
  key: string;            // header the parser reads (without the trailing *)
  required: boolean;      // shown as "key*" in the header row (the parser strips the *)
  hint: string;           // Hinglish help shown as a cell comment + in the "Columns guide" sheet
  example: string;
  width: number;
  list?: 'answers' | 'difficulty' | 'exams' | 'subjects' | 'chapters';
}

/** Order = order of the columns in the sheet. `id` is first: blank = new question, filled = update that question. */
export const PRACTICE_COLUMNS: TemplateColumn[] = [
  { key: 'id', required: false, hint: 'NAYE question ke liye KHALI chhodein. Export file se aaya ID rehne dein to wahi question UPDATE hoga (duplicate nahi banega).', example: '', width: 14 },
  { key: 'examId', required: true, hint: 'Exam ka slug — dropdown se chunein (Reference IDs sheet me poori list).', example: 'ssc-cgl', width: 16, list: 'exams' },
  { key: 'subjectId', required: true, hint: 'Subject ka slug — dropdown se chunein.', example: 'quantitative-aptitude', width: 22, list: 'subjects' },
  { key: 'chapterId', required: true, hint: 'Chapter ka slug ya exact naam — dropdown se chunein. Chapter pehle se database me hona chahiye.', example: 'percentage', width: 22, list: 'chapters' },
  { key: 'topicId', required: false, hint: 'Optional. Topic ka slug ya naam. Naya naam ho to chapter ke neeche khud ban jata hai.', example: 'basic-percentage-concepts', width: 24 },
  { key: 'subTopicId', required: false, hint: 'Optional. Sub-topic ka slug ya naam.', example: '', width: 18 },
  { key: 'questionText', required: true, hint: 'Question ka English text. Khali nahi chhod sakte.', example: 'What is 20% of 150?', width: 46 },
  { key: 'questionTextHindi', required: false, hint: 'Question ka Hindi text. Khali ho to question UNPUBLISHED save hota hai (jab tak Hindi na jude).', example: '150 का 20% क्या है?', width: 40 },
  { key: 'optionA', required: true, hint: 'Option A (text).', example: '25', width: 16 },
  { key: 'optionA_Hindi', required: false, hint: 'Option A Hindi (optional).', example: '25', width: 16 },
  { key: 'optionB', required: true, hint: 'Option B (text).', example: '30', width: 16 },
  { key: 'optionB_Hindi', required: false, hint: 'Option B Hindi (optional).', example: '30', width: 16 },
  { key: 'optionC', required: true, hint: 'Option C (text).', example: '35', width: 16 },
  { key: 'optionC_Hindi', required: false, hint: 'Option C Hindi (optional).', example: '35', width: 16 },
  { key: 'optionD', required: true, hint: 'Option D (text).', example: '40', width: 16 },
  { key: 'optionD_Hindi', required: false, hint: 'Option D Hindi (optional).', example: '40', width: 16 },
  { key: 'correctAnswer', required: true, hint: 'Sirf A, B, C ya D — dropdown se chunein. Us option ka text khali nahi hona chahiye.', example: 'B', width: 14, list: 'answers' },
  { key: 'explanation', required: true, hint: 'Solution (English). Bina solution ke question upload NAHI hota.', example: '20% of 150 = 150 × 20 / 100 = 30', width: 46 },
  { key: 'explanationHindi', required: false, hint: 'Solution Hindi me (optional).', example: '150 का 20% = 150 × 20 / 100 = 30', width: 40 },
  { key: 'difficulty', required: false, hint: 'EASY, MEDIUM ya HARD — dropdown. Khali = MEDIUM (naye question me).', example: 'EASY', width: 14, list: 'difficulty' },
  { key: 'marks', required: false, hint: 'Number. Khali = 1.', example: '1', width: 10 },
  { key: 'negativeMarks', required: false, hint: 'Number. Khali = 0.25.', example: '0.25', width: 14 },
];

export const ANSWER_LIST = ['A', 'B', 'C', 'D'];
export const DIFFICULTY_LIST = ['EASY', 'MEDIUM', 'HARD'];

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
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** <dataValidations> block for rows 2..maxRow of each listed column */
export function buildDataValidationsXml(specs: ValidationSpec[], maxRow = 5000): string {
  if (!specs.length) return '';
  const items = specs.map((s) => {
    const L = columnLetter(s.col);
    return `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorStyle="${s.strict ? 'stop' : 'warning'}" errorTitle="${esc(s.title)}" error="${esc(s.message)}" promptTitle="${esc(s.title)}" prompt="${esc(s.message)}" sqref="${L}2:${L}${maxRow}"><formula1>${esc(s.formula)}</formula1></dataValidation>`;
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
    if (!ANSWER_LIST.includes(a)) problems.push(`correctAnswer galat ("${get('correctAnswer')}") — A/B/C/D chahiye`);
    else body.correctAnswer = a;
  }
  if (get('difficulty')) {
    const d = get('difficulty').toUpperCase();
    if (!DIFFICULTY_LIST.includes(d)) problems.push(`difficulty galat ("${get('difficulty')}") — EASY/MEDIUM/HARD chahiye`);
    else body.difficulty = d;
  }
  for (const k of ['marks', 'negativeMarks']) {
    if (get(k)) {
      const n = Number(get(k));
      if (!Number.isFinite(n)) problems.push(`${k} number hona chahiye ("${get(k)}")`);
      else body[k] = n;
    }
  }
  if (!practiceOnly) for (const k of ['year', 'shift', 'paperCode', 'examDate']) if (get(k)) body[k] = get(k);
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
  existing: { questionText?: string | null; questionTextHindi?: string | null; explanation?: string | null; explanationHindi?: string | null; correctAnswer?: string | null; difficulty?: string | null; marks?: number | null; negativeMarks?: number | null; year?: number | null; shift?: string | null; paperCode?: string | null; examDate?: string | null; optionsJson?: unknown },
  body: UpdateBody,
): string[] {
  const changed: string[] = [];
  for (const k of ['questionText', 'questionTextHindi', 'explanation', 'explanationHindi', 'correctAnswer', 'difficulty', 'shift', 'paperCode', 'examDate'] as const) {
    if (k in body && nz(body[k]) !== nz((existing as Record<string, unknown>)[k])) changed.push(k);
  }
  for (const k of ['marks', 'negativeMarks', 'year'] as const) {
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
