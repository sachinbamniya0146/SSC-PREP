/* eslint-disable @typescript-eslint/no-explicit-any */
// Cashfree PAYOUTS v2 — separate product from Cashfree PAYMENT GATEWAY
// (monetization.service.ts). Payment Gateway is how students PAY US;
// Payouts is how WE PAY referrers their commission. Different Cashfree
// dashboard section, different Client ID/Secret, different base URL.
//
// This service is intentionally "ready but disabled": if
// CASHFREE_PAYOUT_CLIENT_ID / CASHFREE_PAYOUT_CLIENT_SECRET are not set
// (Sachin hasn't activated Cashfree Payouts yet), isConfigured() returns
// false and callers (admin.controller.ts) fall back to a manual
// "admin marks it PAID after sending money by hand" flow instead of
// crashing or silently pretending to pay someone.
import { Injectable, Logger, BadRequestException } from '@nestjs/common';

interface PayoutConfig {
  clientId: string;
  clientSecret: string;
  apiVersion: string;
  baseUrl: string;
}

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);
  private cfg: PayoutConfig;

  constructor() {
    const clientId = process.env.CASHFREE_PAYOUT_CLIENT_ID || '';
    const clientSecret = process.env.CASHFREE_PAYOUT_CLIENT_SECRET || '';
    const env = process.env.CASHFREE_PAYOUT_ENV === 'PRODUCTION' ? 'PRODUCTION' : 'TEST';

    this.cfg = {
      clientId,
      clientSecret,
      apiVersion: '2024-01-01',
      baseUrl: env === 'PRODUCTION' ? 'https://api.cashfree.com/payout' : 'https://sandbox.cashfree.com/payout',
    };

    if (!clientId || !clientSecret) {
      this.logger.warn(
        'CASHFREE_PAYOUT_CLIENT_ID / CASHFREE_PAYOUT_CLIENT_SECRET not set — automatic withdrawal payouts are DISABLED. ' +
          'Admin can still approve withdrawals and pay manually; set these two env vars once Cashfree Payouts is activated on the dashboard to switch on auto-transfer.',
      );
    }
  }

  /** Whether Cashfree Payouts credentials are configured (auto-transfer available). */
  isConfigured(): boolean {
    return Boolean(this.cfg.clientId && this.cfg.clientSecret);
  }

  private async cfFetch(path: string, init: { method: 'GET' | 'POST'; body?: any }) {
    if (!this.isConfigured()) {
      throw new BadRequestException('Cashfree Payouts is not configured yet — approve this withdrawal and pay the user manually for now.');
    }
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      method: init.method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-api-version': this.cfg.apiVersion,
        'x-client-id': this.cfg.clientId,
        'x-client-secret': this.cfg.clientSecret,
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      this.logger.error(`Cashfree Payouts ${init.method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
      throw new BadRequestException(json?.message || `Cashfree Payouts request failed (${res.status})`);
    }
    return json;
  }

  /**
   * Ensure a Cashfree beneficiary exists for this withdrawal's payout
   * destination. beneficiary_id is deterministic (derived from userId) so
   * repeat withdrawals by the same user reuse the same beneficiary instead
   * of creating a new one every time.
   */
  private async ensureBeneficiary(input: {
    beneficiaryId: string;
    name: string;
    email: string;
    phone: string;
    upiId?: string | null;
    bankAccountNo?: string | null;
    bankIfsc?: string | null;
  }): Promise<void> {
    // Check if it already exists — Get Beneficiary V2 404s if not found,
    // which cfFetch() would otherwise throw on, so probe manually.
    const checkRes = await fetch(
      `${this.cfg.baseUrl}/beneficiary?beneficiary_id=${encodeURIComponent(input.beneficiaryId)}`,
      {
        method: 'GET',
        headers: {
          'x-api-version': this.cfg.apiVersion,
          'x-client-id': this.cfg.clientId,
          'x-client-secret': this.cfg.clientSecret,
        },
      },
    );
    if (checkRes.ok) return; // beneficiary already on file

    await this.cfFetch('/beneficiary', {
      method: 'POST',
      body: {
        beneficiary_id: input.beneficiaryId,
        beneficiary_name: input.name,
        beneficiary_instrument_details: {
          ...(input.bankAccountNo ? { bank_account_number: input.bankAccountNo, bank_ifsc: input.bankIfsc } : {}),
          ...(input.upiId ? { vpa: input.upiId } : {}),
        },
        beneficiary_contact_details: {
          beneficiary_email: input.email,
          beneficiary_phone: input.phone,
        },
      },
    });
  }

  /**
   * Initiate the actual money transfer for an approved withdrawal. Caller
   * (admin.controller.ts) is responsible for having already checked
   * isConfigured() and for updating the WithdrawalRequest row's status
   * based on the result of this call.
   */
  async payWithdrawal(input: {
    withdrawalId: string;
    amountInr: number;
    userName: string;
    userEmail: string;
    userPhone: string;
    payoutMethodType: 'UPI' | 'BANK_ACCOUNT';
    upiId?: string | null;
    bankAccountNo?: string | null;
    bankIfsc?: string | null;
  }): Promise<{ cfTransferId: string; status: string }> {
    const beneficiaryId = `SSCUSER_${input.withdrawalId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 40)}`;

    await this.ensureBeneficiary({
      beneficiaryId,
      name: input.userName,
      email: input.userEmail,
      phone: (input.userPhone || '').replace(/\D/g, '').slice(-10) || '9999999999',
      upiId: input.payoutMethodType === 'UPI' ? input.upiId : null,
      bankAccountNo: input.payoutMethodType === 'BANK_ACCOUNT' ? input.bankAccountNo : null,
      bankIfsc: input.payoutMethodType === 'BANK_ACCOUNT' ? input.bankIfsc : null,
    });

    const transferId = `WD_${input.withdrawalId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 30)}_${Date.now().toString().slice(-6)}`;

    const result = await this.cfFetch('/transfers', {
      method: 'POST',
      body: {
        transfer_id: transferId,
        transfer_amount: input.amountInr,
        transfer_mode: input.payoutMethodType === 'UPI' ? 'upi' : 'banktransfer',
        beneficiary_details: { beneficiary_id: beneficiaryId },
      },
    });

    return { cfTransferId: String(result.cf_transfer_id || transferId), status: String(result.status || 'PENDING') };
  }

  /** Poll Cashfree for the current status of a previously-initiated transfer. */
  async getTransferStatus(transferId: string): Promise<any> {
    return this.cfFetch(`/transfers?transfer_id=${encodeURIComponent(transferId)}`, { method: 'GET' });
  }
}
