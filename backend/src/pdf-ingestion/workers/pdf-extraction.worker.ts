import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../../s3/s3.service';
import { extractPdfText } from '../pdf-text';

const execAsync = promisify(exec);

interface ExtractChunkData {
  batchId: string;
  chunkId: string;
  sourcePdfId: string;
  s3Key: string;
  startPage: number;
  endPage: number;
  chunkIndex: number;
  metadata: {
    subjectId?: string;
    examId?: string;
    bookName?: string;
    publisher?: string;
    language?: string;
    year?: number;
    shift?: string;
    paperCode?: string;
  };
}

interface StructuredQ {
  questionText: string;
  options: string[];
  correctAnswer?: string;
  confidence: number;
  explanation?: string;
}

/**
 * v1 §7.1-7.3 — REAL PDF AI extraction pipeline (was a stub).
 *
 *  1. Read the PDF bytes (S3/R2 when configured, local fallback otherwise).
 *  2. Extract the text layer with pdf-parse (digital PDFs; scanned PDFs have
 *     no text layer → chunk reports `no_text_layer` honestly instead of fake
 *     SUCCESS with zero detail).
 *  3. Split into question blocks; parse options + inline answer key
 *     ("Ans: B" / "(C)") deterministically when present.
 *  4. Questions WITHOUT an explicit answer go through an LLM structuring pass
 *     (same OpenAI-compatible provider as explanations — opencode-zen default).
 *  5. Every extracted row: reviewStatus=AI_DRAFT, aiConfidenceScore,
 *     sourcePdfId/importBatchId provenance, searchHash dedupe, isApproved=false
 *     (publish still requires VERIFIED_* + bilingual + human approval).
 *  6. Each row enqueued on 'question-review' (human review gate).
 *
 * Chunk 0 does the extraction; later chunks ack SUCCESS (text layer is one
 * pass) so batch completion logic stays intact.
 */
@Processor('pdf-extraction')
@Injectable()
export class PdfExtractionWorker extends WorkerHost {
  private readonly logger = new Logger(PdfExtractionWorker.name);
  private readonly localDir: string;

  constructor(
    private prisma: PrismaService,
    private s3: S3Service,
    private config: ConfigService,
    @InjectQueue('question-review') private reviewQueue: Queue,
  ) {
    super();
    this.localDir = this.config.get<string>('PDF_STORAGE_DIR') || 'files/pdf';
  }

  async process(job: Job<ExtractChunkData>): Promise<any> {
    const data = job.data;
    this.logger.log(`Extracting chunk ${data.chunkIndex}: pages ${data.startPage}-${data.endPage} (${data.s3Key})`);

    await this.prisma.importChunk.update({
      where: { id: data.chunkId },
      data: { status: 'PROCESSING', processedAt: new Date() },
    });

    try {
      const buf = await this.readPdfBytes(data.s3Key);
      let doc: any = await extractPdfText(buf);
      let text: string = doc?.text ?? '';
      const pageCount: number = doc?.numpages ?? 1;

      // If no text layer (scanned PDF), run OCR on THIS chunk's pages
      if (text.replace(/\s+/g, '').length < 200) {
        this.logger.log(`Chunk ${data.chunkIndex}: No text layer found, running OCR on pages ${data.startPage}-${data.endPage}...`);
        text = await this.ocrPdfPages(buf, data.startPage, data.endPage);
        this.logger.log(`Chunk ${data.chunkIndex}: OCR text length = ${text.length} chars`);
        if (text.replace(/\s+/g, '').length < 200) {
          await this.markSuccess(data, 0, 'ocr_failed_no_text');
          await this.checkBatchComplete(data.batchId);
          return { extracted: 0, reason: 'ocr_failed_no_text' };
        }
      }

      this.logger.log(`Chunk ${data.chunkIndex}: OCR text sample (first 500 chars): ${JSON.stringify(text.slice(0, 500))}`);

      const blocks = this.splitBlocks(text);
      this.logger.log(`Chunk ${data.chunkIndex}: ${blocks.length} candidate blocks, ${pageCount} pages`);

      // DEBUG: Log first 3 blocks
      blocks.slice(0, 3).forEach((b, i) => {
        this.logger.debug(`Block ${i} (first 200 chars): ${JSON.stringify(b.slice(0, 200))}`);
      });

      let extracted = 0;
      let skippedDup = 0;
      let skippedNoSubject = 0;
      let llmUsed = 0;
      let llmFailed = 0;

      for (const block of blocks) {
        this.logger.debug(`Processing block (first 100 chars): ${JSON.stringify(block.slice(0, 100))}`);
        const parsed = this.parseBlock(block);
        this.logger.debug(`Parsed result: ${JSON.stringify(parsed)}`);
        if (!parsed || parsed.options.length < 2) {
          this.logger.debug(`Skipping block: parsed=${!!parsed}, options=${parsed?.options?.length || 0}`);
          continue;
        }

        let structured: StructuredQ;
        if (parsed.answerKey) {
          // Normalize answer key: convert Hindi numerals to English, handle 1-9
          let normalizedAnswer = parsed.answerKey;
          const hindiToEnglish: Record<string, string> = {
            '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
            '५': '5', '६': '6', '७': '7', '८': '8', '९': '9'
          };
          normalizedAnswer = normalizedAnswer.replace(/[०-९]/g, (m) => hindiToEnglish[m] || m);
          
          // If answer is numeric (1-9), convert to A-I (1->A, 2->B, 3->C, 4->D, 5->E, 6->F, 7->G, 8->H, 9->I)
          if (/^[1-9]$/.test(normalizedAnswer)) {
            const num = parseInt(normalizedAnswer, 10);
            if (num >= 1 && num <= 9) {
              normalizedAnswer = String.fromCharCode(64 + num); // 1->A, 2->B, ..., 9->I
            } else {
              normalizedAnswer = '';
            }
          }
          
          this.logger.debug(`Raw answerKey: ${parsed.answerKey} -> normalized: ${normalizedAnswer}`);
          
          structured = {
            questionText: parsed.questionText,
            options: parsed.options,
            correctAnswer: normalizedAnswer,
            confidence: normalizedAnswer ? 0.95 : 0.5, // answer read directly from the paper text
            explanation: '',
          };
        } else {
          const llm = await this.structureWithLlm(parsed.questionText, parsed.options);
          if (!llm) { llmFailed++; continue; }
          structured = llm;
          llmUsed++;
        }

        const optionsJson = structured.options.slice(0, 9).map((text, i) => ({
          key: String.fromCharCode(65 + i),
          text,
          isCorrect: String.fromCharCode(65 + i) === (structured.correctAnswer ?? ''),
        }));
        const answerIdx = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].indexOf(structured.correctAnswer ?? '');
        if (answerIdx < 0 || answerIdx >= optionsJson.length) continue; // no usable answer — never store a guess

        const hash = this.searchHash(structured.questionText);
        const existing = await this.prisma.question.findFirst({ where: { searchHash: hash }, select: { id: true } });
        if (existing) { skippedDup++; continue; }

        if (!data.metadata.subjectId) { skippedNoSubject++; continue; }

        const q = await this.prisma.question.create({
          data: {
            questionText: structured.questionText,
            optionsJson: optionsJson as any,
            correctAnswer: structured.correctAnswer!,
            explanation: structured.explanation || null,
            explanationSource: parsed.answerKey ? 'PDF' : 'AI_GENERATED',
            searchHash: hash,
            sourcePdfId: data.sourcePdfId,
            importBatchId: data.batchId,
            subjectId: data.metadata.subjectId,
            examId: data.metadata.examId ?? null,
            year: data.metadata.year ?? null,
            shift: data.metadata.shift ?? null,
            marks: 1,
            negativeMarks: 0.25,
            isApproved: false,
            isActive: true,
            reviewStatus: 'AI_DRAFT',
            aiConfidenceScore: structured.confidence,
          },
          select: { id: true },
        });
        extracted++;

        await this.reviewQueue.add('review', {
          questionId: q.id,
          batchId: data.batchId,
          sourceText: structured.questionText.slice(0, 1000),
          confidence: structured.confidence,
        });
      }

      await this.markSuccess(data, extracted, `llm_used=${llmUsed} llm_failed=${llmFailed} dup=${skippedDup} no_subject=${skippedNoSubject}`);
      await this.checkBatchComplete(data.batchId);
      return { extracted, llmUsed, llmFailed, skippedDup, skippedNoSubject };
    } catch (error: any) {
      this.logger.error(`Chunk ${data.chunkId} failed:`, error);
      await this.prisma.importChunk.update({
        where: { id: data.chunkId },
        data: { status: 'FAILED', errorMessage: error.message, processedAt: new Date() },
      });
      await this.checkBatchComplete(data.batchId);
      throw error;
    }
  }

  // ---------------------------------------------------------------- storage

  private s3Configured(): boolean {
    const key = this.config.get<string>('S3_ACCESS_KEY') || '';
    const ep = this.config.get<string>('S3_ENDPOINT') || '';
    return !!(ep && key && !key.includes('Your') && !key.includes('placeholder'));
  }

  private async readPdfBytes(key: string): Promise<Buffer> {
    if (this.s3Configured()) {
      const obj = await this.s3.getObject(key);
      const body = obj.Body as any;
      if (!body) throw new Error('Empty S3 object');
      if (typeof body.transformToByteArray === 'function') {
        return Buffer.from(await body.transformToByteArray());
      }
      const chunks: Buffer[] = [];
      for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      return Buffer.concat(chunks);
    }
    const p = path.join(process.cwd(), this.localDir, key.replace(/^uploads\//, ''));
    if (!fs.existsSync(p)) throw new Error(`Local PDF not found: ${p}`);
    return fs.readFileSync(p);
  }

  // ------------------------------------------------------------ extraction

  /** OCR PDF pages using pdftoppm + tesseract (Hindi + English). */
  private async ocrPdfPages(pdfBuf: Buffer, startPage: number, endPage: number): Promise<string> {
    const tmpDir = `/tmp/ocr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await fs.promises.mkdir(tmpDir, { recursive: true });
    const pdfPath = path.join(tmpDir, 'input.pdf');
    await fs.promises.writeFile(pdfPath, pdfBuf);

    try {
      // Convert PDF pages to images (PNG) using pdftoppm
      const ppmPrefix = path.join(tmpDir, 'page');
      await execAsync(`pdftoppm -png -f ${startPage} -l ${endPage} -r 300 "${pdfPath}" "${ppmPrefix}"`);

      // Find generated PNG files
      const files = await fs.promises.readdir(tmpDir);
      const pngFiles = files.filter(f => f.endsWith('.png')).sort((a, b) => {
        const an = parseInt(a.replace(/\D/g, ''), 10);
        const bn = parseInt(b.replace(/\D/g, ''), 10);
        return an - bn;
      });

      let fullText = '';
      for (const png of pngFiles) {
        const imgPath = path.join(tmpDir, png);
        // Run tesseract with Hindi + English
        const { stdout } = await execAsync(`tesseract "${imgPath}" stdout -l hin+eng --psm 6`);
        fullText += `\n--- PAGE ${png} ---\n${stdout}`;
      }
      return fullText;
    } finally {
      // Cleanup
      try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }

  /** Split raw page text into question blocks (numbered Q / "Q12." / "1." / Hindi numerals). */
  private splitBlocks(text: string): string[] {
    // Match both English (0-9) and Hindi (०-९) numerals
    // Pattern: newline + optional "Q" + digits + [.)] + whitespace
    const parts = text.split(/\n\s*(?:Q\.?\s*)?[\d०-९]{1,3}\s*[.)]\s+/);
    return parts
      .map((p) => p.trim())
      .filter((p) => p.length > 20);
  }

  /** Parse one block → question text, options (A-D), inline answer key. */
    private parseBlock(block: string): { questionText: string; options: string[]; answerKey?: string } | null {
      const lines = block.split('\n');
      const matches: { key: string; text: string }[] = [];
      let firstOptLineIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        const opts = this.parseOptionsFromLine(lines[i]);
        if (opts.length) {
          if (firstOptLineIdx < 0) firstOptLineIdx = i;
          matches.push(...opts);
        }
      }
      if (matches.length < 2 || firstOptLineIdx < 0) return null;

      const questionText = lines.slice(0, firstOptLineIdx).join(' ').replace(/\s+/g, ' ').trim();
      if (!questionText) return null;

      const optsMap = new Map<string, string>();
      for (const o of matches) {
        if (!optsMap.has(o.key)) optsMap.set(o.key, o.text);
      }

      this.logger.debug(`Question text (first 200): ${JSON.stringify(questionText.slice(0, 200))}`);
      this.logger.debug(`optsMap keys: ${Array.from(optsMap.keys()).join(', ')}`);
      this.logger.debug(`matches: ${JSON.stringify(matches.map(m => ({key: m.key, text: m.text.slice(0, 50)})))}`);
    
      // Try A-D first, then 1-9, then Hindi १-९
      const optionKeys = ['A', 'B', 'C', 'D'];
      let options = optionKeys.map((k) => optsMap.get(k)).filter((t): t is string => !!t && t.length > 0);
    
      if (options.length < 2) {
        // Try numeric options 1-9
        options = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => optsMap.get(k)).filter((t): t is string => !!t && t.length > 0);
      }
      if (options.length < 2) {
        // Try Hindi numerals १-९
        options = ['१', '२', '३', '४', '५', '६', '७', '८', '९'].map((k) => optsMap.get(k)).filter((t): t is string => !!t && t.length > 0);
      }
      this.logger.debug(`Options found (after all attempts): ${options.length} - ${JSON.stringify(options.map((o, i) => o.slice(0, 50)))}`);
      if (options.length < 2) return null;

      // Answer key: "Ans. A" / "Answer: B" / "उत्तर- (A)" / "उत्तर: 1" / "उत्तर- १" / "उत्तर-(5)" / "उत्तर-छ)" / "उत्तर-(8)"
      const ans = block.match(/(?:Ans\.?|Answer|उत्तर)\s*[.:]?\s*[\(]?([A-Da-d१२३४५६७८९०1-9])[\)]?/i);
      this.logger.debug(`Block answerKey match: ${JSON.stringify(ans)}`);
      return { questionText, options, answerKey: ans ? ans[1].toUpperCase() : undefined };
    }

  /** Options on a line: "(A) 20 (B) 26" or "A. 20  B. 26" or "(1) 20 (2) 26" or "१. विकल्प २. विकल्प" or "(5) option" / "५. option".
   *  Dot-form requires a dot after the letter so "Ans:" / "Q.12" are never misread as options. */
  private parseOptionsFromLine(line: string): { key: string; text: string }[] {
    const out: { key: string; text: string }[] = [];
    // Parenthesized: (A) text, (1) text, (१) text, (5) text, (५) text
    const paren = /\(([A-Da-d1-9१२३४५६७८९])\)\s*([^\n(]+)/g;
    let m: RegExpExecArray | null;
    while ((m = paren.exec(line)) !== null) {
      out.push({ key: m[1].toUpperCase(), text: m[2].trim() });
    }
    // Dot form: A. text  B. text  1. text  २. text  5. text  ५. text (must have dot after letter)
    const dot = /\b([A-Da-d1-9१२३४५६७८९])\.\s*([^\n.]+)/g;
    while ((m = dot.exec(line)) !== null) {
      out.push({ key: m[1].toUpperCase(), text: m[2].trim() });
    }
    return out;
  }

  /** LLM structuring fallback (only when the paper has no explicit answer). */
  private async structureWithLlm(questionText: string, options: string[]): Promise<StructuredQ | null> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY') || '';
    if (!apiKey) return null;
    try {
      const OpenAI = require('openai').OpenAI;
      const client = new OpenAI({
        apiKey,
        baseURL: this.config.get<string>('OPENAI_BASE_URL') || 'https://opencode.ai/zen/v1',
      });
      const prompt = `You are extracting an SSC exam MCQ from paper text. Output STRICT JSON only:
{"questionText":"...","options":["A text","B text","C text","D text"],"correctAnswer":"A|B|C|D","confidence":0.0-1.0,"explanation":"..."}
Keep numbers and symbols exactly as written. 4 options in A-D order. confidence = how certain the correct answer is (0.9+ only if you can actually derive/verify it; 0.4 if guess).
Question: ${questionText}
Options: ${options.join(' | ')}`;
      const completion = await client.chat.completions.create({
        model: this.config.get<string>('OPENAI_MODEL') || 'deepseek-v4-flash-free',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
        temperature: 0.1,
      });
      const raw = (completion.choices?.[0]?.message?.content || '').trim();
      const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      const parsed = JSON.parse(jsonStr);
      if (!parsed.questionText || !Array.isArray(parsed.options) || parsed.options.length < 2) return null;
      const conf = Number(parsed.confidence);
      return {
        questionText: String(parsed.questionText),
        options: parsed.options.slice(0, 4).map((o: any) => String(o)),
        correctAnswer: String(parsed.correctAnswer || '').toUpperCase(),
        confidence: isFinite(conf) ? Math.min(Math.max(conf, 0), 1) : 0.5,
        explanation: parsed.explanation ? String(parsed.explanation) : '',
      };
    } catch (e: any) {
      this.logger.warn(`LLM structuring failed: ${e.message}`);
      return null;
    }
  }

  private searchHash(text: string): string {
    const norm = text.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9\u0900-\u097F ]/g, '').trim();
    return createHash('sha256').update(norm).digest('hex');
  }

  // ---------------------------------------------------------------- helpers

  private async markSuccess(data: ExtractChunkData, extracted: number, detail: string) {
    await this.prisma.importChunk.update({
      where: { id: data.chunkId },
      data: { status: 'SUCCESS', processedAt: new Date(), errorMessage: `${detail}` },
    });
  }

  private async checkBatchComplete(batchId: string) {
    const batch = await this.prisma.importBatch.findUnique({
      where: { id: batchId },
      include: { chunks: true },
    });
    if (!batch) return;
    const pending = batch.chunks.filter((c) => c.status === 'PENDING' || c.status === 'PROCESSING');
    if (pending.length === 0) {
      const failed = batch.chunks.some((c) => c.status === 'FAILED');
      const anyExtracted = batch.chunks.some((c) => c.errorMessage && !c.errorMessage.startsWith('extracted_in_chunk_0') && !c.errorMessage.startsWith('no_text_layer'));
      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: {
          status: failed ? 'PARTIAL' : 'COMPLETED',
          completedChunks: batch.chunks.filter((c) => c.status === 'SUCCESS').length,
          failedChunks: batch.chunks.filter((c) => c.status === 'FAILED').length,
          completedAt: new Date(),
          errorMessage: anyExtracted ? undefined : 'No questions extracted',
        },
      });
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Extraction job ${job.id} failed: ${err.message}`);
  }
}
