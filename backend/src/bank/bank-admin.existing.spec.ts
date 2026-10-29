/* eslint-disable @typescript-eslint/no-explicit-any */
import { BankAdminService } from './bank-admin.service';

function mk() {
  const counts: any[] = [];
  const prisma: any = {
    question: {
      count: async (a: any) => {
        counts.push(a.where);
        const w = JSON.stringify(a.where);
        if (w.includes('"year":{"not":null}')) return 7; // pyq
        if (w.includes('"year":null')) return 93; // practice
        if (w.includes('isApproved')) return 90; // published
        return 100; // total
      },
      findMany: async () => [{ id: 'q1', questionNo: 11, questionText: 'Q', questionTextHindi: 'प्र', questionImageUrl: null, questionDiagramType: null, correctAnswer: 'A', errorReportCount: 0, year: 2024, shift: 'Shift 2', examDate: '2024-06-20', paperCode: null, isApproved: true, isActive: true, autoSuspended: false, reviewStatus: 'APPROVED', uploadBatchId: null, createdAt: new Date(), exam: null, subject: null, chapter: null, topic: null, subTopic: null }],
    },
  };
  return { svc: new BankAdminService(prisma, {} as any), counts };
}

describe('BankAdminService.existing (questions already under a chapter / topic / sub-topic)', () => {
  it('refuses to run without a subject / chapter / topic / sub-topic', async () => {
    const { svc } = mk();
    await expect(svc.existing({}, 0, 20)).rejects.toThrow('Select a subject');
    await expect(svc.existing({ examId: 'e1', q: 'percent' }, 0, 20)).rejects.toThrow('Select a subject');
  });

  it('gives PYQ / practice / live / hidden counts and the practice gap to 100', async () => {
    const { svc } = mk();
    const r = await svc.existing(svc.parseFilter({ chapterId: 'c1', topicId: 't1' }), 0, 20);
    expect(r.counts).toEqual({ total: 100, pyq: 7, practice: 93, live: 90, hidden: 10, practiceTarget: 100, practiceMissing: 7 });
    expect(r.data).toHaveLength(1);
    // admin only: the exam date is in the list, the kind is derived from the year
    expect(r.data[0]).toMatchObject({ examDate: '2024-06-20', kind: 'pyq', questionNo: 11 });
  });

  it('the counts ignore the list filters (search, kind, status), so they always describe the whole node', async () => {
    const { svc, counts } = mk();
    await svc.existing(svc.parseFilter({ subTopicId: 's1', kind: 'pyq', status: 'live', year: '2024' }), 0, 20);
    const nodeCounts = counts.slice(0, 3).map((w) => JSON.stringify(w));
    expect(nodeCounts).toHaveLength(3);
    expect(nodeCounts.every((w) => !w.includes('2024') && !w.includes('isApproved') && w.includes('"subTopicId":"s1"'))).toBe(true);
  });
});
