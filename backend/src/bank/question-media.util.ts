/* eslint-disable @typescript-eslint/no-explicit-any */
// Question media helpers (Oct 2026).
//
// Goals ("diagram/mirror image wale questions + solution me bhi image"):
//  * a diagram can be supplied as CODE (inline SVG) — no image hosting needed,
//    always loads, crisp on every phone. It is sanitised and stored as a
//    data: URI in the EXISTING questionImageUrl / option.imageUrl fields, so
//    every screen that already shows images shows it, with no DB migration.
//  * the SOLUTION can carry a picture/diagram too: the explanation text gets a
//    markdown image line  ![solution](<url or data-uri>)  which the app renders.
//  * JSON uploads accept a JSON array, { "questions": [...] }, a single object,
//    or JSON-Lines (one object per line — what the old template produced).

import { createHash } from 'crypto';

export const MAX_SVG_BYTES = 200 * 1024;

/** Short stable digest — keeps huge data:/base64/SVG strings out of searchHash (DB index rows are size-limited). */
export function shortDigest(v: string): string {
  return createHash('sha1').update(String(v)).digest('hex').slice(0, 16);
}

/** A media value as it should appear inside a dedupe key: plain URLs stay readable, big inline data is digested. */
export function mediaKey(v?: string | null): string {
  if (!v) return '';
  return /^data:/i.test(v) || v.length > 300 ? `d${shortDigest(v)}` : v;
}

/** Everything about a question that is a PICTURE (stem + options). Two questions with equal text but different pictures are NOT duplicates. */
export function questionMediaSignature(q: any): string {
  const parts: string[] = [];
  if (q.questionDiagramType) parts.push(`dg:${q.questionDiagramType}:${(q.questionDiagramLabels ?? []).join(',')}`);
  if (q.questionImageUrl) parts.push(`im:${mediaKey(q.questionImageUrl)}`);
  if (q.questionSvg) parts.push(`sv:${shortDigest(q.questionSvg)}`);
  if (q.questionImageBase64) parts.push(`b6:${shortDigest(q.questionImageBase64)}`);
  return parts.join(';');
}

export function hasAnyMedia(q: any): boolean {
  return !!(
    questionMediaSignature(q) ||
    (q.options ?? []).some((o: any) => o && (o.diagramType || o.imageUrl || o.svg || o.imageBase64))
  );
}


/** Sanitise author-supplied SVG so it is safe to show (it is rendered through <img>, which already blocks scripts, this is defence in depth). */
export function sanitizeSvg(raw: string): string {
  let s = String(raw ?? '').trim();
  if (!s) throw new Error('SVG code is empty.');
  s = s.replace(/^\uFEFF/, '').replace(/<\?xml[\s\S]*?\?>/gi, '').replace(/<!DOCTYPE[\s\S]*?>/gi, '').replace(/<!--[\s\S]*?-->/g, '').trim();
  const start = s.search(/<svg[\s>]/i);
  const end = s.toLowerCase().lastIndexOf('</svg>');
  if (start === -1 || end === -1) throw new Error('SVG code must start with <svg ...> and end with </svg>.');
  s = s.slice(start, end + 6);
  if (Buffer.byteLength(s, 'utf8') > MAX_SVG_BYTES) throw new Error(`SVG too large (max ${MAX_SVG_BYTES / 1024} KB).`);
  s = s
    .replace(/<\s*(script|foreignObject|iframe|object|embed|audio|video|link|meta)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|foreignObject|iframe|object|embed|audio|video|link|meta)\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|xlink:href)\s*=\s*("|')\s*(?!#|data:image\/(png|jpe?g|webp|gif);base64,)[^"']*\2/gi, '')
    .replace(/javascript:/gi, '');
  if (!/<svg[^>]*\sxmlns\s*=/i.test(s)) s = s.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (!/<svg[^>]*\sviewBox\s*=/i.test(s) && !/<svg[^>]*\swidth\s*=/i.test(s)) {
    s = s.replace(/<svg/i, '<svg viewBox="0 0 200 150"');
  }
  return s;
}

export function svgToDataUri(raw: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(sanitizeSvg(raw), 'utf8').toString('base64')}`;
}

export function hasBase64Media(q: any): boolean {
  return !!(q.questionImageBase64 || q.explanationImageBase64 || (q.options ?? []).some((o: any) => o?.imageBase64));
}

/**
 * Turns every "code" style media field into the stored form (sync, idempotent).
 * Call AFTER base64 uploads have produced URLs.
 */
export function applyInlineMedia(q: any): void {
  if (q.questionSvg && !q.questionImageUrl) q.questionImageUrl = svgToDataUri(q.questionSvg);
  for (const o of q.options ?? []) {
    if (o?.svg && !o.imageUrl) o.imageUrl = svgToDataUri(o.svg);
  }
  const solutionUrl: string | undefined = q.explanationImageUrl || (q.explanationSvg ? svgToDataUri(q.explanationSvg) : undefined);
  if (solutionUrl) {
    const line = `![solution](${solutionUrl})`;
    if (q.explanation || !q.explanationHindi) q.explanation = `${q.explanation ? q.explanation + '\n\n' : ''}${line}`;
    if (q.explanationHindi) q.explanationHindi = `${q.explanationHindi}\n\n${line}`;
  }
  delete q.questionSvg;
  delete q.explanationImageUrl;
  delete q.explanationSvg;
  delete q.explanationImageBase64;
  for (const o of q.options ?? []) if (o) delete o.svg;
}

/** True when the question carries (or will carry) a solution of any kind. */
export function hasSolution(q: any): boolean {
  return !!(
    String(q.explanation ?? '').trim() ||
    String(q.explanationHindi ?? '').trim() ||
    q.explanationImageUrl || q.explanationImageBase64 || q.explanationSvg
  );
}

/** JSON array | {questions:[..]} | single object | JSON-Lines  ->  array, or null when the text is not JSON at all. */
export function parseJsonQuestions(text: string): any[] | null {
  const t = String(text ?? '').replace(/^\uFEFF/, '').trim();
  if (!t || !(t.startsWith('[') || t.startsWith('{'))) return null;
  try {
    const v = JSON.parse(t);
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.questions)) return v.questions;
    if (v && typeof v === 'object') return [v];
    return null;
  } catch {
    const out: any[] = [];
    for (const line of t.split(/\r?\n/)) {
      const l = line.trim();
      if (!l) continue;
      try {
        const v = JSON.parse(l.replace(/,$/, ''));
        if (v && typeof v === 'object') out.push(v);
        else return null;
      } catch {
        return null;
      }
    }
    return out.length ? out : null;
  }
}

// 1x1 transparent PNG — used in the template so the base64 example is REAL, valid data.
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** The real, upload-ready JSON template (a JSON ARRAY — the same file can be uploaded straight back). */
export function buildJsonTemplate(): string {
  const base = { examId: 'ssc-cgl', subjectId: 'reasoning', chapterId: 'mirror-and-water-image', year: 2023, shift: 'Shift 1', marks: 2, negativeMarks: 0.5, difficulty: 'MEDIUM' };
  const arrowSvg = (flip: boolean) =>
    `<svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg"><g transform="${flip ? 'translate(120,0) scale(-1,1)' : ''}"><polygon points="20,40 70,10 70,30 100,30 100,50 70,50 70,70" fill="none" stroke="#111" stroke-width="3"/></g></svg>`;
  const items: any[] = [
    {
      _help: '1) NORMAL text question (Hindi optional). Delete the _help key or keep it — it is ignored.',
      ...base, subjectId: 'quantitative_aptitude', chapterId: 'percentage', topicId: 'basic-percentage-concepts', subTopicId: 'percentage-change',
      questionText: 'What is 20% of 150?', questionTextHindi: '150 का 20% क्या है?',
      options: [
        { key: 'A', text: '30', textHi: '30' }, { key: 'B', text: '25', textHi: '25' },
        { key: 'C', text: '35', textHi: '35' }, { key: 'D', text: '40', textHi: '40' },
      ],
      correctAnswer: 'A', explanation: '150 × 20/100 = 30', explanationHindi: '150 × 20/100 = 30',
    },
    {
      _help: '2) VENN diagram options: diagramType V1..V8 + diagramLabels (no image needed).',
      ...base, subjectId: 'reasoning', chapterId: 'venn-diagram',
      questionText: 'उस वेन आरेख का चयन करें जो टिकट, हवाई जहाज, रेल के संबंध को दर्शाता है।',
      options: [
        { key: 'A', text: '', diagramType: 'V1', diagramLabels: ['टिकट', 'हवाई जहाज', 'रेल'] },
        { key: 'B', text: '', diagramType: 'V3', diagramLabels: ['टिकट', 'हवाई जहाज', 'रेल'] },
        { key: 'C', text: '', diagramType: 'V6', diagramLabels: ['टिकट', 'हवाई जहाज', 'रेल'] },
        { key: 'D', text: '', diagramType: 'V2', diagramLabels: ['टिकट', 'हवाई जहाज', 'रेल'] },
      ],
      correctAnswer: 'A', explanation: 'तीनों यात्रा से जुड़े हैं, इसलिए तीनों वृत्त एक-दूसरे को काटते हैं।',
    },
    {
      _help: '3) ANY diagram as CODE (SVG) — mirror image / figure series / paper folding etc. Stem uses questionSvg, each option uses "svg", solution uses explanationSvg. Always loads, no hosting.',
      ...base,
      questionText: 'Select the mirror image of the given figure (mirror on the right side).',
      questionSvg: arrowSvg(false),
      options: [
        { key: 'A', text: '', svg: arrowSvg(false) },
        { key: 'B', text: '', svg: arrowSvg(true) },
        { key: 'C', text: '', svg: arrowSvg(false).replace('stroke="#111"', 'stroke="#555"') },
        { key: 'D', text: '', svg: arrowSvg(true).replace('stroke="#111"', 'stroke="#555"') },
      ],
      correctAnswer: 'B', explanation: 'In a mirror image the left and right sides swap, so option B is correct.',
      explanationSvg: arrowSvg(true),
    },
    {
      _help: '4) Images already hosted (or uploaded with the Upload-Image tool): questionImageUrl, option imageUrl, explanationImageUrl.',
      ...base, chapterId: 'figure-series',
      questionText: 'Which figure comes next in the series?',
      questionImageUrl: 'https://sscprephub.in/api/v1/media/question-images/EXAMPLE-STEM.png',
      options: [
        { key: 'A', text: '', imageUrl: 'https://sscprephub.in/api/v1/media/question-images/EXAMPLE-A.png' },
        { key: 'B', text: '', imageUrl: 'https://sscprephub.in/api/v1/media/question-images/EXAMPLE-B.png' },
        { key: 'C', text: '', imageUrl: 'https://sscprephub.in/api/v1/media/question-images/EXAMPLE-C.png' },
        { key: 'D', text: '', imageUrl: 'https://sscprephub.in/api/v1/media/question-images/EXAMPLE-D.png' },
      ],
      correctAnswer: 'C', explanation: 'Each step rotates the shape 90° clockwise.',
      explanationImageUrl: 'https://sscprephub.in/api/v1/media/question-images/EXAMPLE-SOLUTION.png',
    },
    {
      _help: '5) Raw image bytes inside the JSON (base64, no data: prefix needed) — uploaded automatically: questionImageBase64, option imageBase64, explanationImageBase64.',
      ...base, chapterId: 'embedded-figures',
      questionText: 'Find the figure that is embedded in the given figure.',
      questionImageBase64: TINY_PNG_BASE64, questionImageMimeType: 'image/png',
      options: [
        { key: 'A', text: '', imageBase64: TINY_PNG_BASE64, imageMimeType: 'image/png' },
        { key: 'B', text: '', imageBase64: TINY_PNG_BASE64, imageMimeType: 'image/png' },
        { key: 'C', text: '', imageBase64: TINY_PNG_BASE64, imageMimeType: 'image/png' },
        { key: 'D', text: '', imageBase64: TINY_PNG_BASE64, imageMimeType: 'image/png' },
      ],
      correctAnswer: 'A', explanation: 'Figure A fits inside the stem figure.',
      explanationImageBase64: TINY_PNG_BASE64, explanationImageMimeType: 'image/png',
    },
  ];
  return JSON.stringify(items, null, 2);
}
