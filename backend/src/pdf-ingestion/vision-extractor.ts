/**
 * v1 §7.4 — Vision-based question extractor using GPT-4V/Gemini.
 *
 * For scanned PDFs where Tesseract OCR produces poor quality, this module
 * uses a vision LLM to read page images directly and extract structured
 * questions with answers, solutions, and explanations.
 */
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import { ConfigService } from '@nestjs/config';

const execAsync = promisify(exec);

interface ExtractedQuestion {
  questionText: string;
  options: string[];
  correctAnswer?: string;
  confidence: number;
  explanation?: string;
  solution?: string;
  pageNumber?: number;
}

export class VisionExtractor {
  constructor(private config: ConfigService) {}

  /**
   * Render PDF pages to images, send to vision LLM, extract Q&A+Solutions.
   * Uses GPT-4V or Gemini Vision for best Hindi/English OCR.
   */
  async extractFromVision(
    pdfBuf: Buffer,
    startPage: number,
    endPage: number,
    subjectId?: string
  ): Promise<ExtractedQuestion[]> {
    const tmpDir = `/tmp/vision-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await fs.promises.mkdir(tmpDir, { recursive: true });
    const pdfPath = path.join(tmpDir, 'input.pdf');
    await fs.promises.writeFile(pdfPath, pdfBuf);

    try {
      // Render pages at 300 DPI for better vision LLM accuracy
      await execAsync(`pdftoppm -png -f ${startPage} -l ${endPage} -r 300 "${pdfPath}" "${path.join(tmpDir, 'page')}"`);

      const files = await fs.promises.readdir(tmpDir);
      const pngFiles = files
        .filter(f => f.startsWith('page') && f.endsWith('.png'))
        .sort((a, b) => {
          const an = parseInt(a.match(/-(\\d+)\\.png$/)?.[1] || '0', 10);
          const bn = parseInt(b.match(/-(\\d+)\\.png$/)?.[1] || '0', 10);
          return an - bn;
        });

      if (pngFiles.length === 0) throw new Error('No pages rendered for vision extraction');

      const apiKey = this.config.get<string>('OPENAI_API_KEY') || '';
      const baseUrl = this.config.get<string>('OPENAI_BASE_URL') || 'https://api.openai.com/v1';
      const model = this.config.get<string>('OPENAI_MODEL') || 'gpt-4-vision-preview';

      if (!apiKey) {
        throw new Error('No API key configured for vision extraction');
      }

      const OpenAI = require('openai').OpenAI;
      const client = new OpenAI({ apiKey, baseURL: baseUrl });

      const allQuestions: ExtractedQuestion[] = [];

      for (let i = 0; i < pngFiles.length; i++) {
        const pageImg = path.join(tmpDir, pngFiles[i]);
        const pageNum = startPage + i;
        const imgB64 = fs.readFileSync(pageImg).toString('base64');

        const prompt = `You are an expert SSC exam question extractor. Read this page image carefully.

EXTRACT ALL QUESTIONS from this page. Each question has:
1. Question text (Hindi/English)
2. Options (A, B, C, D or 1,2,3,4 or १,२,३,४)
3. Correct answer (look for: उत्तर, Answer, Ans, उत्तर-(A), उत्तर-(1), उत्तर-(५), Answer: B, Ans. C, etc.)
4. Solution/explanation if present (look for: व्याख्या, Explanation, Solution, Sol.)

Output STRICT JSON array only:
[
  {
    "q": "Clean question text only (no answer key, no explanation)",
    "opts": ["A) First option", "B) Second option", "C) Third option", "D) Fourth option"],
    "ans": "A|B|C|D",
    "conf": 0.95,
    "sol": "Full solution/explanation text if present, else empty string"
  },
  ...
]

RULES:
- If no questions on page, return []
- Extract answer key from: उत्तर-(A), उत्तर-(1), उत्तर-(५), उत्तर-(छ), Answer: B, Ans. C, Ans: 2
- Convert Hindi numerals to English: ०-९→0-9, १-९→1-9, then 1-9→A-I
- Clean question text: remove answer key markers, remove "व्याख्या/Explanation/Solution" sections
- Options: keep as "A) text", "B) text" format
- Solution: include full explanation/solution text if present
- If confidence < 0.7, set conf to actual confidence (don't guess)
`;

        try {
          const completion = await client.chat.completions.create({
            model,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${imgB64}`, detail: 'high' } }
              ]
            }],
            max_tokens: 4000,
            temperature: 0.0,
          });

          const raw = (completion.choices?.[0]?.message?.content || '').trim();
          const jsonStr = raw.replace(/^```(?:json)?\\s*/i, '').replace(/```\\s*$/, '').trim();
          
          try {
            const parsed = JSON.parse(jsonStr);
            if (Array.isArray(parsed)) {
              for (const q of parsed) {
                const qText = (q.q || q.questionText || '').trim();
                const opts = (q.opts || q.options || []).map((o: string) => o.trim()).filter(Boolean);
                const ans = q.ans ? String(q.ans).toUpperCase() : undefined;
                const conf = typeof q.conf === 'number' ? q.conf : (ans && opts.length >= 2 ? 0.9 : 0.5);
                
                if (!qText || opts.length < 2 || !ans) continue;

                allQuestions.push({
                  questionText: qText,
                  options: opts,
                  correctAnswer: ans,
                  confidence: Math.min(Math.max(conf, 0), 1),
                  explanation: (q.sol || q.explanation || q.solution || '').trim(),
                  solution: (q.sol || q.solution || q.explanation || '').trim(),
                  pageNumber: pageNum,
                });
              }
            }
          } catch (parseErr: unknown) {
            console.error(`Failed to parse vision response for page ${pageNum}:`, (parseErr as Error).message);
            console.error(`Raw response (first 500 chars):`, raw.slice(0, 500));
          }
        } catch (apiErr: unknown) {
          console.error(`Vision API error for page ${pageNum}:`, (apiErr as Error).message);
        }
      }

      return allQuestions;
    } finally {
      try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }
}