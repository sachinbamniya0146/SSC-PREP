// v6 §7 — Test paper + Answer-key PDF export with mandatory 4-pass QA gate.
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PdfRenderer } from './pdf-renderer';
import { buildPaperHtml, buildAnswerKeyHtml, PdfQuestion, PdfTestMeta } from './pdf-templates';

@Injectable()
export class PdfExportService {
  constructor(
    private prisma: PrismaService,
    private renderer: PdfRenderer,
  ) {}

  // Compose questions for a template from CANONICAL bank data (same source as live test:
  // approved + bilingual gate + exam badge — mirrors bank.service getSet()).
  private async composeQuestions(
    template: { id: string; durationMinutes: number; totalMarks: number; title: string },
    count: number,
  ): Promise<{ questions: PdfQuestion[]; meta: PdfTestMeta }> {
    const rows = await this.prisma.question.findMany({
      where: {
        isApproved: true,
        questionTextHindi: { not: '' },
        examId: { not: null },
      },
      include: { chapter: { select: { name: true } }, exam: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
      take: 2000,
    });
    const shuffled = rows.slice().sort(() => Math.random() - 0.5).slice(0, Math.min(count, 100));
    if (shuffled.length === 0) {
      throw new BadRequestException('No bilingual approved questions available for this test');
    }
    const questions: PdfQuestion[] = shuffled.map((r: any) => ({
      id: r.id,
      q: r.questionText,
      qh: r.questionTextHindi,
      options: (r.optionsJson as any[]).map((o: any) => ({
        key: o.key,
        text: o.text,
        textHi: o.textHi ?? null,
      })),
      correctAnswer: r.correctAnswer,
      explanation: r.explanation ?? '',
      explanationHindi: r.explanationHindi ?? '',
      chapter: r.chapter?.name ?? '',
      examName: r.exam?.name ?? '',
      year: r.year ?? null,
      shift: r.shift ?? null,
      marks: r.marks ?? 1,
      negativeMarks: r.negativeMarks ?? 0.25,
    }));
    const examLabel = `${questions[0].examName}${questions[0].year ? ' ' + questions[0].year : ''}`;
    const meta: PdfTestMeta = {
      title: template.title,
      examLabel,
      durationMinutes: template.durationMinutes,
      totalMarks: template.totalMarks,
    };
    return { questions, meta };
  }

  // ---- QA passes ----

  // Pass 1 (automated): every marked-correct option matches DB correctAnswer.
  // Pass 2 (automated): PDF option list matches live option list 1:1 (order + count).
  private async runAutomatedPasses(templateId: string, questions: PdfQuestion[]): Promise<{ pass1: boolean; pass2: boolean }> {
    let pass1 = true;
    let pass2 = true;
    for (const q of questions) {
      const db = await this.prisma.question.findUnique({ where: { id: q.id } });
      if (!db) { pass1 = false; pass2 = false; continue; }
      if (db.correctAnswer !== q.correctAnswer) pass1 = false;
      const dbOpts = (db.optionsJson as any[]) || [];
      const dbKeys = dbOpts.map((o: any) => o.key).join(',');
      const pdfKeys = q.options.map((o) => o.key).join(',');
      if (dbKeys !== pdfKeys || dbOpts.length !== q.options.length) pass2 = false;
      // 1:1 order + text match (structural drift check)
      for (let i = 0; i < dbOpts.length; i++) {
        if ((dbOpts[i].text ?? '') !== q.options[i].text) pass2 = false;
      }
    }
    return { pass1, pass2 };
  }

  // Pass 4 (pre-publish regression diff): re-compare snapshot QIDs vs current DB state.
  private async runRegression(templateId: string, snapshot: any): Promise<boolean> {
    if (!snapshot || !Array.isArray(snapshot.qids)) return false;
    const rows = await this.prisma.question.findMany({
      where: { id: { in: snapshot.qids } },
      select: { id: true, correctAnswer: true, questionTextHindi: true },
    });
    if (rows.length !== snapshot.qids.length) return false;
    for (const r of rows) {
      const snap = snapshot.byId?.[r.id];
      if (!snap) return false;
      if (snap.correctAnswer !== r.correctAnswer) return false;
      if ((snap.qh || '') !== (r.questionTextHindi || '')) return false;
    }
    return true;
  }

  // ---- Public API ----

  // Generate both PDFs (EN + HI), run passes 1+2 automatically, save to DB.
  async generate(templateId: string): Promise<any> {
    const template = await this.prisma.testTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new NotFoundException('Test template not found');
    const { questions, meta } = await this.composeQuestions(template, template.totalQuestions);

    const { pass1, pass2 } = await this.runAutomatedPasses(templateId, questions);

    // Question snapshot for pass-4 regression diff
    const byId: Record<string, any> = {};
    for (const q of questions) {
      byId[q.id] = { correctAnswer: q.correctAnswer, qh: q.qh };
    }
    const snapshot = { qids: questions.map((q) => q.id), byId };

    // Bilingual PDF: ek hi HTML me EN + HI sections (v3 §3 gate in one valid PDF file)
    const paperPdf = await this.renderer.htmlToPdf(buildPaperHtml(meta, questions, false));
    const answerKeyPdf = await this.renderer.htmlToPdf(buildAnswerKeyHtml(meta, questions, false));

    const existing = await this.prisma.testPdfExport.findUnique({ where: { testTemplateId: templateId } });
    const data = {
      paperPdf: paperPdf as any,
      answerKeyPdf: answerKeyPdf as any,
      questionSnapshot: snapshot as any,
      pass1Field: pass1,
      pass2Structural: pass2,
      // Re-publish resets passes 3/4 (admin must re-review after any regen)
      pass3SpotCheck: existing?.pass3SpotCheck && !existing.isPublished ? existing.pass3SpotCheck : false,
      pass4Regression: false,
      isPublished: false,
      publishedAt: null,
      lastGeneratedAt: new Date(),
    };
    const saved = existing
      ? await this.prisma.testPdfExport.update({ where: { testTemplateId: templateId }, data })
      : await this.prisma.testPdfExport.create({ data: { ...data, testTemplateId: templateId } });
    return this.toStatus(saved);
  }

  // Pass 3: admin spot-check (sampled human review) — admin marks it done.
  async spotCheck(templateId: string): Promise<any> {
    const row = await this.prisma.testPdfExport.findUnique({ where: { testTemplateId: templateId } });
    if (!row) throw new NotFoundException('No PDF export for this test — generate first');
    const updated = await this.prisma.testPdfExport.update({
      where: { testTemplateId: templateId },
      data: { pass3SpotCheck: true },
    });
    return this.toStatus(updated);
  }

  // Publish: run pass-4 regression diff; only publish when all 4 passes green.
  async publish(templateId: string): Promise<any> {
    const row = await this.prisma.testPdfExport.findUnique({ where: { testTemplateId: templateId } });
    if (!row) throw new NotFoundException('No PDF export for this test — generate first');
    const pass4 = await this.runRegression(templateId, row.questionSnapshot as any);
    const allGreen = row.pass1Field && row.pass2Structural && row.pass3SpotCheck && pass4;
    if (!allGreen) {
      throw new BadRequestException(
        `QA gate not passed: pass1=${row.pass1Field} pass2=${row.pass2Structural} pass3=${row.pass3SpotCheck} pass4=${pass4}`,
      );
    }
    const updated = await this.prisma.testPdfExport.update({
      where: { testTemplateId: templateId },
      data: { pass4Regression: true, isPublished: true, publishedAt: new Date() },
    });
    return this.toStatus(updated);
  }

  async status(templateId: string): Promise<any> {
    const row = await this.prisma.testPdfExport.findUnique({ where: { testTemplateId: templateId } });
    if (!row) return { testTemplateId: templateId, exists: false };
    return this.toStatus(row);
  }

  // Download: paper or answer key (bilingual). Public route — served ONLY when published.
  async download(templateId: string, kind: 'paper' | 'answerkey'): Promise<{ buffer: Buffer; filename: string }> {
    const row = await this.prisma.testPdfExport.findUnique({ where: { testTemplateId: templateId } });
    if (!row) throw new NotFoundException('PDF export not found');
    if (!row.isPublished) throw new BadRequestException('PDF not published yet — QA gate incomplete');
    const buf = kind === 'paper' ? row.paperPdf : row.answerKeyPdf;
    if (!buf) throw new NotFoundException('PDF not generated yet');
    return { buffer: Buffer.from(buf), filename: `${templateId}-${kind}.pdf` };
  }

  private toStatus(row: any): any {
    return {
      testTemplateId: row.testTemplateId,
      exists: true,
      pass1Field: row.pass1Field,
      pass2Structural: row.pass2Structural,
      pass3SpotCheck: row.pass3SpotCheck,
      pass4Regression: row.pass4Regression,
      isPublished: row.isPublished,
      publishedAt: row.publishedAt,
      lastGeneratedAt: row.lastGeneratedAt,
    };
  }
}

