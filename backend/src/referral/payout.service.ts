// Cashfree PAYOUTS v2 — a separate product from the Cashfree PAYMENT GATEWAY (monetization.service.ts).
// Payment Gateway is how students PAY US; Payouts is how WE PAY referrers their commission. Different
// dashboard section, different Client ID / Secret, different base URL.
//
// "Ready but disabled": without CASHFREE_PAYOUT_CLIENT_ID / CASHFREE_PAYOUT_CLIENT_SECRET isConfigured() is false
// and the admin pays by hand (UPI / bank app) and records the UTR in the console.
//
// Safety rules this class enforces for withdrawal.service.ts:
//  * The transfer id is derived from the withdrawal id (never from the clock), and we ASK Cashfree about that id
//    before creating a transfer. A double click, a retry or a crash can therefore never send the money twice.
//  * An answer we cannot interpret (timeout, 5xx, network) is reported as "unsure" (httpStatus 0 / 5xx), never as
//    "failed" - the caller keeps the request in Processing instead of refunding money that may already be on its way.
//  * Only a clear 4xx answer from Cashfree (bad account, blocked, ...) counts as a definite failure.
import { Injectable, Logger } from '@nestjs/common';
import { buildBeneficiaryId, buildTransferId, cleanPhone, sanitizeBeneficiaryName } from './withdrawal.util';

export class PayoutApiError extends Error {
  constructor(
    message: string,
    /** 0 = no answer at all (timeout / network). */
    readonly httpStatus: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'PayoutApiError';
  }

  /** True only when Cashfree clearly said "no" (a 4xx other than timeout / rate-limit / duplicate). */
  get definite(): boolean {
    return this.httpStatus >= 400 && this.httpStatus < 500 && ![408, 409, 425, 429].includes(this.httpStatus);
  }
}

export interface TransferSnapshot {
  transferId: string;
  cfTransferId: string | null;
  status: string;
  statusCode: string | null;
  utr: string | null;
}

export interface PayWithdrawalInput {
  withdrawalId: string;
  amountInr: number;
  userName: string;
  userEmail: string;
  userPhone: string;
  payoutMethodType: 'UPI' | 'BANK_ACCOUNT';
  upiId?: string | null;
  bankAccountNo?: string | null;
  bankIfsc?: string | null;
  bankAccountName?: string | null;
}

interface ApiAnswer {
  httpStatus: number;
  json: Record<string, unknown>;
}

const REQUEST_TIMEOUT_MS = 20_000;

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);
  private readonly clientId = process.env.CASHFREE_PAYOUT_CLIENT_ID || '';
  private readonly clientSecret = process.env.CASHFREE_PAYOUT_CLIENT_SECRET || '';
  private readonly apiVersion = '2024-01-01';
  private readonly baseUrl =
    process.env.CASHFREE_PAYOUT_ENV === 'PRODUCTION' ? 'https://api.cashfree.com/payout' : 'https://sandbox.cashfree.com/payout';

  constructor() {
    if (!this.isConfigured()) {
      this.logger.warn(
        'CASHFREE_PAYOUT_CLIENT_ID / CASHFREE_PAYOUT_CLIENT_SECRET not set - automatic payouts are OFF. ' +
          'Admin sanctions a withdrawal, pays it from a UPI / bank app and records the UTR in the console.',
      );
    }
  }

  /** Whether Cashfree Payouts credentials are configured (auto-transfer available). */
  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  private async request(path: string, method: 'GET' | 'POST', body?: unknown): Promise<ApiAnswer> {
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-api-version': this.apiVersion,
          'x-client-id': this.clientId,
          'x-client-secret': this.clientSecret,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      // No answer: the request may or may not have reached Cashfree.
      throw new PayoutApiError(`No answer from Cashfree (${(e as Error)?.message || 'network error'})`, 0);
    }
    const json = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    return { httpStatus: res.status, json };
  }

  private fail(a: ApiAnswer, what: string): PayoutApiError {
    const message = String(a.json?.message || `${what} failed (HTTP ${a.httpStatus})`);
    this.logger.error(`Cashfree Payouts ${what} -> ${a.httpStatus}: ${JSON.stringify(a.json)}`);
    return new PayoutApiError(message, a.httpStatus, a.json?.code ? String(a.json.code) : undefined);
  }

  private snapshot(json: Record<string, unknown>, fallbackId: string): TransferSnapshot {
    return {
      transferId: String(json.transfer_id || fallbackId),
      cfTransferId: json.cf_transfer_id ? String(json.cf_transfer_id) : null,
      status: String(json.status || 'PENDING'),
      statusCode: json.status_code ? String(json.status_code) : null,
      utr: json.transfer_utr ? String(json.transfer_utr) : null,
    };
  }

  /** What Cashfree knows about this transfer id, or null when it never reached them (HTTP 404 transfer_id_not_found). */
  async getTransfer(transferId: string): Promise<TransferSnapshot | null> {
    const a = await this.request(`/transfers?transfer_id=${encodeURIComponent(transferId)}`, 'GET');
    if (a.httpStatus === 404) return null;
    if (a.httpStatus < 200 || a.httpStatus >= 300) throw this.fail(a, 'Get transfer');
    return this.snapshot(a.json, transferId);
  }

  /** The beneficiary holds the account the money goes to. 409 "already exists" is fine (a retry). */
  private async ensureBeneficiary(input: PayWithdrawalInput, beneficiaryId: string): Promise<void> {
    const isUpi = input.payoutMethodType === 'UPI';
    const a = await this.request('/beneficiary', 'POST', {
      beneficiary_id: beneficiaryId,
      beneficiary_name: sanitizeBeneficiaryName(isUpi ? input.userName : input.bankAccountName || input.userName),
      beneficiary_instrument_details: isUpi
        ? { vpa: input.upiId }
        : { bank_account_number: input.bankAccountNo, bank_ifsc: input.bankIfsc },
      beneficiary_contact_details: {
        beneficiary_email: input.userEmail,
        beneficiary_phone: cleanPhone(input.userPhone),
        beneficiary_country_code: '+91',
      },
    });
    if (a.httpStatus === 409) return;
    if (a.httpStatus < 200 || a.httpStatus >= 300) throw this.fail(a, 'Create beneficiary');
  }

  /**
   * Send the money - at most once per withdrawal. If Cashfree already knows the transfer id we only report its
   * state and do NOT create anything.
   */
  async submitTransfer(input: PayWithdrawalInput): Promise<TransferSnapshot> {
    const transferId = buildTransferId(input.withdrawalId);

    const existing = await this.getTransfer(transferId);
    if (existing) return existing;

    const beneficiaryId = buildBeneficiaryId(input.withdrawalId);
    await this.ensureBeneficiary(input, beneficiaryId);

    const a = await this.request('/transfers', 'POST', {
      transfer_id: transferId,
      transfer_amount: Math.round(input.amountInr * 100) / 100,
      transfer_currency: 'INR',
      transfer_mode: input.payoutMethodType === 'UPI' ? 'upi' : 'banktransfer',
      transfer_remarks: 'SSCPrepHub referral payout',
      beneficiary_details: { beneficiary_id: beneficiaryId },
    });
    if (a.httpStatus < 200 || a.httpStatus >= 300) throw this.fail(a, 'Create transfer');
    return this.snapshot(a.json, transferId);
  }
}
