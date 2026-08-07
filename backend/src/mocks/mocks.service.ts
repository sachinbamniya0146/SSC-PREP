import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const FREE_MOCKS_PER_EXAM = 2;
const OFFER_DAYS = 15;
const OFFER_PRICE_INR = 10;

@Injectable()
export class MocksService {
  constructor(private prisma: PrismaService) {}

  /** List mocks with the user's remaining free access. */
  async listAvailableMocks(userId: string) {
    const tests = await this.prisma.testTemplate.findMany({
      where: { isActive: true, type: { in: ['FULL_MOCK', 'MINI_MOCK', 'SHIFT_WISE', 'PREVIOUS_YEAR', 'YEAR_WISE'] } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const accessRows = await this.prisma.mockAccess.findMany({ where: { userId } });
    // Group premium-usage by template; PREVIOUS_YEAR / YEAR_WISE are FREE forever.
    const usedByTemplate = new Map(accessRows.filter((r) => r.testTemplateId).map((r) => [r.testTemplateId!, r.mocksUsed]));
    const packs = await this.prisma.pricePack.findMany({ where: { isActive: true } });

    const mocks = tests.map((t) => {
      const isFreeByType = t.type === 'PREVIOUS_YEAR' || t.type === 'YEAR_WISE';
      if (isFreeByType || !t.isPremium) {
        return { id: t.id, title: t.title, description: t.description, type: t.type, durationMinutes: t.durationMinutes, totalQuestions: t.totalQuestions, totalMarks: t.totalMarks, free: true, locked: false, reason: 'FREE' };
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

  /** Unlock access to extra mocks for a test (called after successful payment). */
  async purchaseMockAccess(userId: string, testTemplateId: string, packPriceInr?: number) {
    const price = packPriceInr ?? OFFER_PRICE_INR;
    const access = await this.prisma.mockAccess.upsert({
      where: { userId_testTemplateId: { userId, testTemplateId } },
      create: { userId, testTemplateId, paidPacksPurchased: 1 },
      update: { paidPacksPurchased: { increment: 1 } },
    });
    await this.prisma.payment.create({
      data: {
        userId,
        razorpayOrderId: `local-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        amountInr: price,
        status: 'SUCCESS',
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