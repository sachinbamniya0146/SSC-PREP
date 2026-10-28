import {
  buildBeneficiaryId,
  buildTransferId,
  buildWithdrawalStats,
  canMove,
  cleanPhone,
  cleanReason,
  mapGatewayStatus,
  paidMismatch,
  sanitizeBeneficiaryName,
  startOfTodayIst,
  validatePaymentRef,
  WD_STATUSES,
} from './withdrawal.util';

describe('withdrawal status moves', () => {
  it('allows the normal path REQUESTED -> APPROVED -> PROCESSING -> PAID', () => {
    expect(canMove('REQUESTED', 'APPROVED')).toBe(true);
    expect(canMove('APPROVED', 'PROCESSING')).toBe(true);
    expect(canMove('PROCESSING', 'PAID')).toBe(true);
  });

  it('allows the manual path APPROVED -> PAID (UTR typed by the admin)', () => {
    expect(canMove('APPROVED', 'PAID')).toBe(true);
  });

  it('allows a refund only from a request that has not been paid or sent', () => {
    expect(canMove('REQUESTED', 'REJECTED')).toBe(true);
    expect(canMove('APPROVED', 'REJECTED')).toBe(true);
    expect(canMove('PROCESSING', 'REJECTED')).toBe(false); // money may already be on its way
    expect(canMove('PROCESSING', 'FAILED')).toBe(true);
  });

  it('never leaves a finished state (no second refund, no second payment)', () => {
    for (const done of ['PAID', 'REJECTED', 'FAILED'] as const) {
      for (const to of WD_STATUSES) expect(canMove(done, to)).toBe(false);
    }
  });

  it('cannot skip the sanction', () => {
    expect(canMove('REQUESTED', 'PAID')).toBe(false);
    expect(canMove('REQUESTED', 'PROCESSING')).toBe(false);
  });
});

describe('Cashfree status mapping', () => {
  it('SUCCESS is paid', () => {
    expect(mapGatewayStatus('SUCCESS')).toBe('PAID');
    expect(mapGatewayStatus('success')).toBe('PAID');
  });

  it('final failures are failed', () => {
    for (const s of ['FAILED', 'REJECTED', 'REVERSED', 'MANUALLY_REJECTED', 'CANCELLED']) expect(mapGatewayStatus(s)).toBe('FAILED');
  });

  it('everything still travelling keeps waiting', () => {
    for (const s of ['RECEIVED', 'PENDING', 'QUEUED', 'APPROVAL_PENDING', 'VALIDATION_PENDING', '', undefined, 'SOMETHING_NEW']) {
      expect(mapGatewayStatus(s)).toBe('WAIT');
    }
  });

  it('a duplicate-transfer answer is never a failure', () => {
    expect(mapGatewayStatus('REJECTED', 'DUPLICATE_TRANSFER')).toBe('WAIT');
  });
});

describe('identifiers sent to Cashfree', () => {
  const id = '3f2b9c1e-8a77-4c55-9d0e-1a2b3c4d5e6f';

  it('the transfer id is the same every time and within 40 characters', () => {
    expect(buildTransferId(id)).toBe(buildTransferId(id));
    expect(buildTransferId(id).length).toBeLessThanOrEqual(40);
    expect(buildTransferId(id)).toMatch(/^[A-Za-z0-9_]+$/);
  });

  it('different withdrawals get different ids', () => {
    expect(buildTransferId(id)).not.toBe(buildTransferId('aaaaaaaa-8a77-4c55-9d0e-1a2b3c4d5e6f'));
  });

  it('the beneficiary id fits 50 characters', () => {
    expect(buildBeneficiaryId(id).length).toBeLessThanOrEqual(50);
    expect(buildBeneficiaryId(id)).toMatch(/^[A-Za-z0-9_]+$/);
  });

  it('beneficiary name keeps letters and spaces only', () => {
    expect(sanitizeBeneficiaryName('Rahul K. Sharma 2')).toBe('Rahul K Sharma');
    expect(sanitizeBeneficiaryName('12345')).toBe('Referral User');
    expect(sanitizeBeneficiaryName(null)).toBe('Referral User');
    expect(sanitizeBeneficiaryName('A'.repeat(300)).length).toBe(100);
  });

  it('phone is the last 10 digits, or a placeholder', () => {
    expect(cleanPhone('+91 98765-43210')).toBe('9876543210');
    expect(cleanPhone('')).toBe('9999999999');
    expect(cleanPhone('12345')).toBe('9999999999');
  });
});

describe('UTR / reference and reason input', () => {
  it('accepts a normal UPI and a bank reference, upper-cased', () => {
    const a = validatePaymentRef(' 412345678901 ');
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.value).toBe('412345678901');
    const b = validatePaymentRef('hdfcn52026102800123');
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.value).toBe('HDFCN52026102800123');
  });

  it('rejects empty, short, long and odd characters', () => {
    expect(validatePaymentRef('').ok).toBe(false);
    expect(validatePaymentRef('12345').ok).toBe(false);
    expect(validatePaymentRef('1'.repeat(41)).ok).toBe(false);
    expect(validatePaymentRef('12345 6789').ok).toBe(false);
    expect(validatePaymentRef('<script>').ok).toBe(false);
  });

  it('a reason needs at least 3 characters and is trimmed / capped', () => {
    expect(cleanReason('  ').ok).toBe(false);
    expect(cleanReason('ab').ok).toBe(false);
    const r = cleanReason('  wrong   UPI id  ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('wrong UPI id');
    const long = cleanReason('x'.repeat(500));
    expect(long.ok).toBe(true);
    if (long.ok) expect(long.value.length).toBe(300);
  });
});

describe('withdrawal numbers', () => {
  const groups = [
    { status: 'REQUESTED' as const, count: 2, amountInr: 300 },
    { status: 'APPROVED' as const, count: 1, amountInr: 150.5 },
    { status: 'PROCESSING' as const, count: 1, amountInr: 99.5 },
    { status: 'PAID' as const, count: 4, amountInr: 1200 },
    { status: 'REJECTED' as const, count: 1, amountInr: 100 },
    { status: 'FAILED' as const, count: 1, amountInr: 50 },
  ];

  it('splits waiting / sanctioned / sending / paid / rejected', () => {
    const s = buildWithdrawalStats(groups);
    expect(s.awaiting).toEqual({ count: 2, amountInr: 300 });
    expect(s.sanctioned).toEqual({ count: 1, amountInr: 150.5 });
    expect(s.processing).toEqual({ count: 1, amountInr: 99.5 });
    expect(s.paid).toEqual({ count: 4, amountInr: 1200 });
    expect(s.rejected).toEqual({ count: 2, amountInr: 150 });
  });

  it('"sanctioned in total" = sanctioned + sending + paid, and "to pay" = sanctioned + sending', () => {
    const s = buildWithdrawalStats(groups);
    expect(s.sanctionedTotal).toEqual({ count: 6, amountInr: 1450 });
    expect(s.toPay).toEqual({ count: 2, amountInr: 250 });
  });

  it('every request is in exactly one bucket (counts add up)', () => {
    const s = buildWithdrawalStats(groups);
    const all = s.awaiting.count + s.sanctioned.count + s.processing.count + s.paid.count + s.rejected.count;
    expect(all).toBe(groups.reduce((n, g) => n + g.count, 0));
  });

  it('is all zeros for an empty table', () => {
    const s = buildWithdrawalStats([]);
    expect(s.paid).toEqual({ count: 0, amountInr: 0 });
    expect(s.toPay).toEqual({ count: 0, amountInr: 0 });
  });

  it('floating point sums stay at 2 decimals', () => {
    const s = buildWithdrawalStats([
      { status: 'PAID', count: 1, amountInr: 0.1 },
      { status: 'PAID', count: 1, amountInr: 0.2 },
    ]);
    expect(s.paid.amountInr).toBe(0.3);
  });

  it('flags a wallet counter that differs from the paid rows', () => {
    expect(paidMismatch(1200, 1200)).toBeNull();
    expect(paidMismatch(1200.004, 1200)).toBeNull();
    expect(paidMismatch(1300, 1200)).toEqual({ walletTotalInr: 1300, paidRowsInr: 1200, differenceInr: 100 });
  });

  it('"today" starts at midnight India time', () => {
    // 28 Oct 2026 20:00 UTC = 29 Oct 01:30 IST -> today began 28 Oct 18:30 UTC
    expect(startOfTodayIst(new Date('2026-10-28T20:00:00Z')).toISOString()).toBe('2026-10-28T18:30:00.000Z');
    // 28 Oct 2026 10:00 UTC = 28 Oct 15:30 IST -> today began 27 Oct 18:30 UTC
    expect(startOfTodayIst(new Date('2026-10-28T10:00:00Z')).toISOString()).toBe('2026-10-27T18:30:00.000Z');
  });
});
