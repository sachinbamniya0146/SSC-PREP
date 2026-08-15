// v6 §7 — HTML templates for test paper + answer-key PDFs (bilingual, canonical data).

export interface PdfQuestion {
  id: string;
  q: string; // EN stem
  qh: string; // HI stem
  options: { key: string; text: string; textHi: string | null }[];
  correctAnswer: string;
  explanation: string;
  explanationHindi: string;
  chapter: string;
  examName: string;
  year: number | null;
  shift: string | null;
  marks: number;
  negativeMarks: number;
}

export interface PdfTestMeta {
  title: string;
  examLabel: string; // e.g. "SSC CGL 2024 Tier I"
  durationMinutes: number;
  totalMarks: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _FONT_CSS = '';
// font injected separately (base64) by the service

function esc(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function optionRow(o: { key: string; text: string; textHi: string | null }, hi: boolean): string {
  const t = hi ? o.textHi || o.text : o.text;
  return `<div class="opt"><span class="opt-key">${esc(o.key)}.</span> <span>${esc(t)}</span></div>`;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _questionBlock(q: PdfQuestion, n: number, hi: boolean, showAnswer: boolean): string {
  const stem = hi ? q.qh || q.q : q.q;
  const parts: string[] = [];
  parts.push(
    `<div class="qcard"><div class="qhead"><span class="qnum">Q${n}.</span> <span class="qmeta">[${esc(q.examName)}${q.year ? ' ' + q.year : ''}${q.shift ? ' · Shift ' + esc(q.shift) : ''}] ${esc(q.chapter)}</span></div>`,
  );
  parts.push(`<div class="qstem">${esc(stem)}</div>`);
  parts.push(`<div class="opts">${q.options.map((o) => optionRow(o, hi)).join('')}</div>`);
  if (showAnswer) {
    parts.push(
      `<div class="ans"><b>Answer: ${esc(q.correctAnswer)}</b>${q.marks ? ` · Marks: +${q.marks}/−${q.negativeMarks}` : ''}</div>`,
    );
    const expl = hi ? q.explanationHindi || q.explanation : q.explanation;
    if (expl) parts.push(`<div class="expl"><b>${hi ? 'Solution:' : 'Explanation:'}</b> ${esc(expl)}</div>`);
  }
  parts.push(`</div>`);
  return parts.join('');
}

// Bilingual block: EN stem+opts first, HI stem+opts below (v3 §3 bilingual gate in one PDF).
function questionBlockBi(q: PdfQuestion, n: number, showAnswer: boolean): string {
  const parts: string[] = [];
  parts.push(
    `<div class="qcard"><div class="qhead"><span class="qnum">Q${n}.</span> <span class="qmeta">[${esc(q.examName)}${q.year ? ' ' + q.year : ''}${q.shift ? ' · Shift ' + esc(q.shift) : ''}] ${esc(q.chapter)}</span></div>`,
  );
  parts.push(`<div class="lang-tag">EN</div><div class="qstem">${esc(q.q)}</div>`);
  parts.push(`<div class="opts">${q.options.map((o) => optionRow(o, false)).join('')}</div>`);
  if (q.qh && q.qh !== q.q) {
    parts.push(`<div class="lang-tag hi">हिंदी</div><div class="qstem">${esc(q.qh)}</div>`);
    parts.push(`<div class="opts">${q.options.map((o) => optionRow(o, true)).join('')}</div>`);
  }
  if (showAnswer) {
    parts.push(
      `<div class="ans"><b>Answer: ${esc(q.correctAnswer)}</b>${q.marks ? ` · Marks: +${q.marks}/−${q.negativeMarks}` : ''}</div>`,
    );
    if (q.explanation) parts.push(`<div class="expl"><b>Explanation:</b> ${esc(q.explanation)}</div>`);
    if (q.explanationHindi) parts.push(`<div class="expl hi"><b>समाधान:</b> ${esc(q.explanationHindi)}</div>`);
  }
  parts.push(`</div>`);
  return parts.join('');
}

const STYLE = `
  body{font-family:'deva',Helvetica,Arial,sans-serif;font-size:12px;color:#111;line-height:1.5;margin:24px}
  h1{font-size:18px;margin:0 0 4px} .sub{font-size:12px;color:#555;margin-bottom:16px}
  .qcard{border:1px solid #ddd;border-radius:6px;padding:10px 12px;margin-bottom:12px;page-break-inside:avoid}
  .qhead{font-size:11px;color:#666;margin-bottom:6px} .qnum{font-weight:bold;color:#111}
  .qstem{font-weight:500;margin-bottom:8px} .opts{margin-left:18px}
  .opt{margin-bottom:3px} .opt-key{font-weight:bold}
  .lang-tag{font-size:9px;font-weight:bold;color:#0a7d32;text-transform:uppercase;margin-top:6px}
  .lang-tag.hi{color:#b3541e}
  .ans{margin-top:8px;color:#0a7d32;font-weight:600}
  .expl{margin-top:4px;color:#333;font-size:11px}
  .expl.hi{color:#555}
`;

export function buildPaperHtml(meta: PdfTestMeta, questions: PdfQuestion[], _hi: boolean): string {
  const body = questions.map((q, i) => questionBlockBi(q, i + 1, false)).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>
    <h1>${esc(meta.title)}</h1>
    <div class="sub">${esc(meta.examLabel)} · ${meta.durationMinutes} min · Max Marks ${meta.totalMarks} · Bilingual (EN + हिंदी)</div>
    ${body}
  </body></html>`;
}

export function buildAnswerKeyHtml(meta: PdfTestMeta, questions: PdfQuestion[], _hi: boolean): string {
  const body = questions.map((q, i) => questionBlockBi(q, i + 1, true)).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>
    <h1>${esc(meta.title)} — Answer Key & Solutions</h1>
    <div class="sub">${esc(meta.examLabel)} · उत्तर कुंजी व समाधान (Bilingual)</div>
    ${body}
  </body></html>`;
}
