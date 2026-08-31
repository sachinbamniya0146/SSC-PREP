/* eslint-disable @typescript-eslint/no-explicit-any */
// v6 §7 — Test paper + Answer-key PDF export with mandatory 4-pass QA gate.
import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLISHED_QUESTION_WHERE } from '../common/question-visibility';
import { PdfRenderer } from './pdf-renderer';
import { buildPaperHtml, buildAnswerKeyHtml, PdfQuestion, PdfTestMeta } from './pdf-templates';

@Injectable()
export class PdfExportService {
  constructor(
    private prisma: PrismaService,
    private renderer: PdfRenderer,
    // BUGFIX below (download()) needs to optionally verify a caller's
    // identity even though the route stays @Public() for plain <a href>
    // links — JwtModule is registered `global: true` in auth.module.ts so
    // this is injectable here with no module wiring changes needed.
    private jwt: JwtService,
  ) {}

  // Compose questions for a template from CANONICAL bank data (same source as live test:
  // approved + bilingual gate + exam badge — mirrors bank.service getSet()).
  private async composeQuestions(
    template: { id: string; durationMinutes: number; totalMarks: number; title: string },
    count: number,
  ): Promise<{ questions: PdfQuestion[]; meta: PdfTestMeta }> {
    const rows = await this.prisma.question.findMany({
      where: {
        ...PUBLISHED_QUESTION_WHERE,
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

  /**
   * BUGFIX (bonus grep, item b — unauthenticated premium answer-key leak,
   * the most severe variant of this pattern found in the whole audit):
   *
   * `/tests/:testTemplateId/pdf/paper` and `.../answerkey` are `@Public()`
   * (deliberately — so a plain browser `<a href>` download link works
   * without JS attaching an Authorization header). This method used to
   * check ONLY `row.isPublished` (the QA-pipeline gate) before handing
   * back the buffer — it never looked at whether the underlying
   * TestTemplate was premium/paid, and being `@Public()` there was no
   * logged-in user to check entitlement for even if it had tried.
   *
   * Net effect: anyone on the internet, with zero login and zero payment,
   * could download the full question paper AND the complete answer key
   * PDF for any premium mock test the moment it passed QA — just by
   * knowing (or enumerating) its testTemplateId. This bypassed every
   * paywall in the app (subscription, mock-access pack, PayU) at once.
   *
   * Fix: free (non-premium) templates keep working exactly as before —
   * no auth needed, plain links still work, matching the original intent.
   * For a PREMIUM template, the caller must now supply `?token=<access
   * token>` on the URL (query param, since a plain link can't send a
   * header) — verified here the same way JwtAuthGuard verifies it
   * (signature/type/session-active), then checked against the exact same
   * entitlement rule tests.service.ts's assertMockEntitled() uses
   * (active subscription OR a mockAccess grant with paid packs or
   * remaining free trial). Anything short of that → 403, no buffer sent.
   */
  async download(templateId: string, kind: 'paper' | 'answerkey', token?: string): Promise<{ buffer: Buffer; filename: string }> {
    const [row, template] = await Promise.all([
      this.prisma.testPdfExport.findUnique({ where: { testTemplateId: templateId } }),
      this.prisma.testTemplate.findUnique({ where: { id: templateId }, select: { id: true, isPremium: true } }),
    ]);
    if (!row) throw new NotFoundException('PDF export not found');
    if (!row.isPublished) throw new BadRequestException('PDF not published yet — QA gate incomplete');

    if (template?.isPremium) {
      await this.assertEntitledForPremiumDownload(templateId, token);
    }

    const buf = kind === 'paper' ? row.paperPdf : row.answerKeyPdf;
    if (!buf) throw new NotFoundException('PDF not generated yet');
    return { buffer: Buffer.from(buf), filename: `${templateId}-${kind}.pdf` };
  }

  /** Verify `token` and require the same entitlement tests.service.ts's assertMockEntitled() requires, for a premium PDF download. */
  private async assertEntitledForPremiumDownload(testTemplateId: string, token?: string): Promise<void> {
    if (!token) throw new ForbiddenException('This test is premium. Log in with an active subscription or purchased access to download it.');

    let userId: string;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; type: string; sid: string }>(token);
      if (payload.type !== 'access' || !payload.sub) throw new Error('bad token type');
      const session = await this.prisma.deviceSession.findUnique({ where: { id: payload.sid } });
      if (!session || !session.isActive) throw new Error('session inactive');
      userId = payload.sub;
    } catch {
      throw new ForbiddenException('Invalid or expired access token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptions: { where: { status: 'ACTIVE' }, select: { endsAt: true }, take: 1 } },
    });
    const subActive = user?.subscriptions?.[0] && new Date(user.subscriptions[0].endsAt) > new Date();
    if (subActive) return;

    const mock = await this.prisma.mockAccess.findUnique({
      where: { userId_testTemplateId: { userId, testTemplateId } },
      select: { paidPacksPurchased: true, freeMocksAllowed: true, mocksUsed: true },
    });
    if (mock && mock.paidPacksPurchased > 0) return;
    if (mock && mock.mocksUsed < mock.freeMocksAllowed) return;

    throw new ForbiddenException('This test is premium. Purchase access to download it.');
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

  // ---- v3 §7 Chapter PDF (₹1 one-time purchase) ----

  /**
   * Generate a printable chapter PDF for a user who bought it (ChapterPurchase
   * SUCCESS) or holds an ACTIVE subscription. Same canonical bilingual question
   * pool as the live bank; automated answer + option QA runs BEFORE delivery
   * (zero-error rule — a mismatch never ships).
   */
  async generateChapterPdf(userId: string, chapterId: string): Promise<{ buffer: Buffer; filename: string }> {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) throw new NotFoundException('Chapter not found');

    const [purchase, sub] = await Promise.all([
      this.prisma.chapterPurchase.findUnique({
        where: { userId_chapterId: { userId, chapterId } },
        select: { status: true },
      }),
      this.prisma.subscription.findFirst({
        where: { userId, status: 'ACTIVE', endsAt: { gt: new Date() } },
        select: { id: true },
      }),
    ]);
    if (!(purchase?.status === 'SUCCESS' || sub)) {
      throw new BadRequestException('Buy this chapter (₹1, one-time) or get Premium to download the PDF.');
    }

    const rows: any[] = await this.prisma.question.findMany({
      where: { ...PUBLISHED_QUESTION_WHERE, chapterId, questionTextHindi: { not: '' } },
      include: { chapter: { select: { name: true } }, exam: { select: { name: true } } },
      orderBy: [{ year: 'desc' }, { createdAt: 'asc' }],
      take: 150,
    });
    const valid = rows.filter(
      (r) => Array.isArray(r.optionsJson) && r.optionsJson.length === 4 && r.optionsJson.every((o: any) => o?.text),
    );
    if (valid.length === 0) {
      throw new BadRequestException('No bilingual 4-option questions available for this chapter yet.');
    }

    const questions: PdfQuestion[] = valid.map((r: any) => ({
      id: r.id,
      q: r.questionText,
      qh: r.questionTextHindi,
      options: (r.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text, textHi: o.textHi ?? null })),
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

    // Zero-error QA before delivery: answer + option-set must match the live DB 1:1.
    for (const q of questions) {
      const db = await this.prisma.question.findUnique({ where: { id: q.id } });
      if (!db) throw new BadRequestException('Question vanished during generation — aborting.');
      if (db.correctAnswer !== q.correctAnswer) {
        throw new BadRequestException(`QA fail (answer mismatch on ${q.id}) — not shipping.`);
      }
      const dbKeys = ((db.optionsJson as any[]) || []).map((o: any) => o.key).join(',');
      const pdfKeys = q.options.map((o) => o.key).join(',');
      if (dbKeys !== pdfKeys) {
        throw new BadRequestException(`QA fail (option drift on ${q.id}) — not shipping.`);
      }
    }

    const meta: PdfTestMeta = {
      title: `${chapter.name} — SSC Prep Hub`,
      examLabel: questions[0].examName || 'SSC',
      durationMinutes: Math.max(1, Math.round(questions.length * 0.6)),
      totalMarks: questions.reduce((s, q) => s + (q.marks || 1), 0),
    };
    const html = buildPaperHtml(meta, questions, true);
    const buffer = await this.renderer.htmlToPdf(html);
    const safe = chapter.name.replace(/[^a-z0-9]+/gi, '_');
    return { buffer, filename: `SSC_${safe}_${questions.length}Q.pdf` };
  }
}
