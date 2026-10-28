// Withdrawal rules as pure functions (no Nest / Prisma imports) so they can be unit-tested on their own.
//
// Life of a withdrawal ("sanction" = admin approves, then the money is paid):
//
//   REQUESTED --approve--> APPROVED --pay via Cashfree--> PROCESSING --Cashfree says success--> PAID
//        |                    |  \--mark paid (UTR)-------------------------------------------> PAID
//        |                    \--reject--> REJECTED (money back in wallet, once)
//        \--reject / student cancels--> REJECTED
//   PROCESSING --Cashfree says failed / admin marks failed--> FAILED (money back in wallet, once)
//   PROCESSING --transfer never reached Cashfree--> APPROVED (admin can send again)

export type WdStatus = 'REQUESTED' | 'APPROVED' | 'PROCESSING' | 'PAID' | 'REJECTED' | 'FAILED';

export const WD_STATUSES: readonly WdStatus[] = ['REQUESTED', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED', 'FAILED'];
/** A student can only have ONE request in these states at a time. */
export const OPEN_WD_STATUSES: readonly WdStatus[] = ['REQUESTED', 'APPROVED', 'PROCESSING'];

const ALLOWED: Record<WdStatus, readonly WdStatus[]> = {
  REQUESTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['PROCESSING', 'PAID', 'REJECTED'],
  PROCESSING: ['PAID', 'FAILED', 'APPROVED'],
  PAID: [],
  REJECTED: [],
  FAILED: [],
};

export function canMove(from: WdStatus, to: WdStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function isWdStatus(v: unknown): v is WdStatus {
  return typeof v === 'string' && (WD_STATUSES as readonly string[]).includes(v);
}

export const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

// ---------------------------------------------------------------- Cashfree status mapping

export type GatewayOutcome = 'PAID' | 'FAILED' | 'WAIT';

/**
 * Cashfree Payouts v2 transfer status -> what we do.
 *  SUCCESS                                                  -> paid
 *  FAILED / REJECTED / REVERSED / MANUALLY_REJECTED / CANCELLED -> failed (money goes back to the wallet)
 *  RECEIVED / PENDING / QUEUED / APPROVAL_PENDING / ...     -> still travelling, keep waiting
 * A "REJECTED / DUPLICATE_TRANSFER" answer only means "this transfer id was already sent" - never treat it as a failure.
 */
export function mapGatewayStatus(status: unknown, statusCode?: unknown): GatewayOutcome {
  const s = String(status ?? '').trim().toUpperCase();
  const code = String(statusCode ?? '').trim().toUpperCase();
  if (code === 'DUPLICATE_TRANSFER') return 'WAIT';
  if (s === 'SUCCESS') return 'PAID';
  if (['FAILED', 'REJECTED', 'REVERSED', 'MANUALLY_REJECTED', 'CANCELLED', 'CANCELED'].includes(s)) return 'FAILED';
  return 'WAIT';
}

// ---------------------------------------------------------------- identifiers & input clean-up

/** Same withdrawal -> same transfer id, always. Cashfree refuses a repeated id, so a double click can never pay twice. (<= 40 chars) */
export function buildTransferId(withdrawalId: string): string {
  return `WD_${String(withdrawalId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 35)}`;
}

/** One beneficiary per withdrawal (the bank / UPI details are frozen on the request). (<= 50 chars) */
export function buildBeneficiaryId(withdrawalId: string): string {
  return `SSCWD_${String(withdrawalId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 40)}`;
}

/** Cashfree accepts letters and spaces only (max 100). */
export function sanitizeBeneficiaryName(name: string | null | undefined, fallback = 'Referral User'): string {
  const cleaned = String(name ?? '')
    .replace(/[^A-Za-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return cleaned.length >= 2 ? cleaned : fallback;
}

/** Last 10 digits of an Indian mobile number; a harmless placeholder when the profile has none. */
export function cleanPhone(phone: string | null | undefined): string {
  const d = String(phone ?? '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? d : '9999999999';
}

/** UTR / bank reference typed by the admin: 6-40 letters, digits and - _ / . */
export function validatePaymentRef(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const v = String(raw ?? '').trim();
  if (v.length < 6) return { ok: false, error: 'Enter the UTR / transaction reference of the payment (at least 6 characters).' };
  if (v.length > 40) return { ok: false, error: 'The reference is too long (max 40 characters).' };
  if (!/^[A-Za-z0-9\-_/.]+$/.test(v)) return { ok: false, error: 'The reference can only have letters, numbers and - _ / .' };
  return { ok: true, value: v.toUpperCase() };
}

/** Free-text reason typed by the admin (reject / failed). */
export function cleanReason(raw: unknown, min = 3, max = 300): { ok: true; value: string } | { ok: false; error: string } {
  const v = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (v.length < min) return { ok: false, error: `Write a reason (at least ${min} characters).` };
  return { ok: true, value: v.slice(0, max) };
}

/** What the student is told when a transfer failed (never the raw gateway text). */
export const STUDENT_FAILED_NOTE =
  'The payment could not be sent. The amount is back in your wallet - please check your UPI / bank details and request again.';

// ---------------------------------------------------------------- stats

export interface WdGroup {
  status: WdStatus;
  count: number;
  amountInr: number;
}

export interface Bucket {
  count: number;
  amountInr: number;
}

export interface WithdrawalStats {
  /** Student asked, admin has not looked yet. */
  awaiting: Bucket;
  /** Sanctioned by admin, money not sent yet. */
  sanctioned: Bucket;
  /** Sent to Cashfree, waiting for the bank. */
  processing: Bucket;
  /** Money confirmed sent. */
  paid: Bucket;
  /** Rejected, cancelled or failed - the amount went back to the wallet. */
  rejected: Bucket;
  /** Everything that was ever sanctioned and not taken back: sanctioned + processing + paid. */
  sanctionedTotal: Bucket;
  /** What the admin still has to send: sanctioned + processing. */
  toPay: Bucket;
}

const empty = (): Bucket => ({ count: 0, amountInr: 0 });
const add = (a: Bucket, b: Bucket): Bucket => ({ count: a.count + b.count, amountInr: round2(a.amountInr + b.amountInr) });

export function buildWithdrawalStats(groups: WdGroup[]): WithdrawalStats {
  const by: Record<WdStatus, Bucket> = {
    REQUESTED: empty(), APPROVED: empty(), PROCESSING: empty(), PAID: empty(), REJECTED: empty(), FAILED: empty(),
  };
  for (const g of groups) {
    if (!by[g.status]) continue;
    by[g.status] = add(by[g.status], { count: Number(g.count) || 0, amountInr: Number(g.amountInr) || 0 });
  }
  return {
    awaiting: by.REQUESTED,
    sanctioned: by.APPROVED,
    processing: by.PROCESSING,
    paid: by.PAID,
    rejected: add(by.REJECTED, by.FAILED),
    sanctionedTotal: add(add(by.APPROVED, by.PROCESSING), by.PAID),
    toPay: add(by.APPROVED, by.PROCESSING),
  };
}

/** Wallet counters must equal the paid rows. A difference means something was edited by hand or a bug slipped in. */
export function paidMismatch(walletTotalInr: number, paidRowsInr: number): { walletTotalInr: number; paidRowsInr: number; differenceInr: number } | null {
  const a = round2(walletTotalInr);
  const b = round2(paidRowsInr);
  const diff = round2(a - b);
  return Math.abs(diff) >= 0.01 ? { walletTotalInr: a, paidRowsInr: b, differenceInr: diff } : null;
}

/** "Today" for the admin means today in India (IST = UTC+5:30). */
export function startOfTodayIst(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 5.5 * 3_600_000);
}
