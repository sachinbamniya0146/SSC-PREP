import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isPyqAutoMockId, rankPyqTemplatesNewestFirst, isPyqMockFreeByRank, PYQ_MOCK_PRICE_INR } from '../common/pyq-mock-pricing';

const FREE_MOCKS_PER_EXAM = 2;
const OFFER_DAYS = 15;
const OFFER_PRICE_INR = 10;

@Injectable()
export class MocksService {
  constructor(private prisma: PrismaService) {}

  /** List mocks with the user's remaining free access.
   *
   * NEW `examId` param (Sep 2026 — exam-scoping audit): filters to mocks
   * belonging to that exam, PLUS any template with no exam link at all
   * (examId IS NULL) — a handful of generic/legacy templates that predate
   * this column and couldn't be confidently backfilled (see the migration's
   * doc-comment) stay visible everywhere rather than disappearing from
   * every exam's list. When examId is omitted, behavior is unchanged
   * (every mock, exactly as before this fix). */
  async listAvailableMocks(userId: string, examId?: string) {
    const tests = await this.prisma.testTemplate.findMany({
      where: {
        isActive: true,
        type: { in: ['FULL_MOCK', 'MINI_MOCK', 'SHIFT_WISE', 'PREVIOUS_YEAR', 'YEAR_WISE'] },
        ...(examId ? { OR: [{ examId }, { examId: null }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const accessRows = await this.prisma.mockAccess.findMany({ where: { userId } });
    // Group premium-usage by template; PREVIOUS_YEAR / YEAR_WISE are FREE forever.
    const usedByTemplate = new Map(accessRows.filter((r) => r.testTemplateId).map((r) => [r.testTemplateId!, r.mocksUsed]));
    const packs = await this.prisma.pricePack.findMany({ where: { isActive: true } });

    // FIX: this endpoint never checked whether the user holds an ACTIVE
    // subscription — it only looked at per-template free-quota usage. That
    // meant a paying subscriber still saw every premium mock as
    // "locked"/"PAID" here, even though tests.service.ts's
    // assertMockEntitled() would have let them start it (subscription
    // check happens there). Result: user pays for premium, but the mocks
    // list keeps showing a paywall — looks completely broken. Now this
    // mirrors the same subscription check used at attempt-start time.
    // ADMIN BYPASS: same reasoning as tests.service.ts#assertMockEntitled —
    // an ADMIN account should see every mock unlocked without needing a
    // Subscription row, so the admin can preview/QA any premium mock.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, subscriptions: { where: { status: 'ACTIVE' }, select: { endsAt: true }, take: 1 } },
    });
    const hasActiveSubscription =
      user?.role === 'ADMIN' ||
      !!(user?.subscriptions?.[0] && new Date(user.subscriptions[0].endsAt) > new Date());

    // NEW ("free honge bus top 10 rhenge bs baki paid") — rank every
    // auto-created PYQ mock (id starting `pyq-`) newest-paper-first using
    // the SAME shared helper tests.service.ts#assertMockEntitled() uses to
    // gate startAttempt, so the list and the enforcement can never
    // disagree about which 10 are free. See common/pyq-mock-pricing.ts.
    const pyqRank = rankPyqTemplatesNewestFirst(tests.filter((t) => isPyqAutoMockId(t.id)));

    const mocks = tests.map((t) => {
      if (isPyqAutoMockId(t.id)) {
        const isFreeTop10 = isPyqMockFreeByRank(pyqRank.get(t.id));
        if (isFreeTop10 || hasActiveSubscription) {
          return {
            id: t.id, title: t.title, description: t.description, type: t.type,
            durationMinutes: t.durationMinutes, totalQuestions: t.totalQuestions, totalMarks: t.totalMarks,
            free: true, locked: false,
            reason: isFreeTop10 ? 'FREE_TOP_10_PYQ' : 'PREMIUM_SUBSCRIPTION',
          };
        }
        return {
          id: t.id, title: t.title, description: t.description, type: t.type,
          durationMinutes: t.durationMinutes, totalQuestions: t.totalQuestions, totalMarks: t.totalMarks,
          free: false, locked: true, reason: 'PAID',
          offerPriceInr: PYQ_MOCK_PRICE_INR, offerDays: OFFER_DAYS,
        };
      }

      const isFreeByType = t.type === 'PREVIOUS_YEAR' || t.type === 'YEAR_WISE';
      if (isFreeByType || !t.isPremium) {
        return { id: t.id, title: t.title, description: t.description, type: t.type, durationMinutes: t.durationMinutes, totalQuestions: t.totalQuestions, totalMarks: t.totalMarks, free: true, locked: false, reason: 'FREE' };
      }
      // Active subscribers get every premium mock unlocked, regardless of
      // per-template free-quota usage.
      if (hasActiveSubscription) {
        return { id: t.id, title: t.title, description: t.description, type: t.type, durationMinutes: t.durationMinutes, totalQuestions: t.totalQuestions, totalMarks: t.totalMarks, free: true, locked: false, reason: 'PREMIUM_SUBSCRIPTION' };
      }
      const used = usedByTemplate.get(t.id) ?? 0;
      const locked = used >= FREE_MOCKS_PER_EXAM;
      if (!locked) {
        return { id: t.id, title: t.title, description: t.description, type: t.type, durationMinutes: t.durationMinutes, totalQuestions: t.totalQuestions, totalMarks: t.totalMarks, free: true, locked: false, reason: `FREE_${FREE_MOCKS_PER_EXAM}_PER_MOCK` };
      }
      return {
        id: t.id,
        title: t.title,
        description: t.description,
        type: t.type,
        durationMinutes: t.durationMinutes,
        totalQuestions: t.totalQuestions,
        totalMarks: t.totalMarks,
        free: false,
        locked: true,
        reason: 'PAID',
        offerPriceInr: OFFER_PRICE_INR,
        offerDays: OFFER_DAYS,
      };
    });

    return {
      freeMocksPerExam: FREE_MOCKS_PER_EXAM,
      hasActiveSubscription,
      mockAccess: mocks,
      examPacks: {
        name: packs[0]?.name ?? 'Mock Access Pack',
        priceInr: packs[0]?.priceInr ?? OFFER_PRICE_INR,
        mocksIncluded: packs[0]?.mocksIncluded ?? 5,
        durationDays: packs[0]?.durationDays ?? OFFER_DAYS,
      },
      offer: { active: true, priceInr: OFFER_PRICE_INR, days: OFFER_DAYS, message: `Buy ${OFFER_DAYS}-day mock access for just ₹${OFFER_PRICE_INR}` },
    };
  }

  /** Unlock access to extra mocks for a test (called after successful payment).
   *
   * NOTE: as of the SECURITY FIX in mocks.controller.ts, the only caller of
   * this method is the ADMIN-only POST /mocks/purchase comp tool — this is
   * NOT part of the real student-facing purchase flow (that's Cashfree via
   * monetization.service.ts#fulfill(), which writes mockAccess itself).
   * `grantedByAdminId` + `metadataJson.kind: 'ADMIN_COMP'` below record that
   * distinction so the revenue dashboard can tell a real payment apart from
   * a free admin comp (see mocks.controller.ts's doc-comment on purchase()
   * and admin.service.ts#getDashboardStats() for the other half of this). */
  async purchaseMockAccess(userId: string, testTemplateId: string, packPriceInr?: number, grantedByAdminId?: string) {
    const price = packPriceInr ?? OFFER_PRICE_INR;
    const access = await this.prisma.mockAccess.upsert({
      where: { userId_testTemplateId: { userId, testTemplateId } },
      create: { userId, testTemplateId, paidPacksPurchased: 1 },
      update: { paidPacksPurchased: { increment: 1 } },
    });
    await this.prisma.payment.create({
      data: {
        userId,
        gatewayOrderId: `local-admin-comp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        amountInr: price,
        status: 'SUCCESS',
        metadataJson: { kind: 'ADMIN_COMP', mockTemplateId: testTemplateId, grantedByAdminId: grantedByAdminId ?? null },
      },
    });
    return { ok: true, access, priceInr: price };
  }

  /** Record that a user used a free/permitted mock. */
  async recordMockUse(userId: string, testTemplateId: string) {
    await this.prisma.mockAccess.upsert({
      where: { userId_testTemplateId: { userId, testTemplateId } },
      create: { userId, testTemplateId, mocksUsed: 1 },
      update: { mocksUsed: { increment: 1 } },
    });
  }
}
