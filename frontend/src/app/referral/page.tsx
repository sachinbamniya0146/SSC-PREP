"use client";

import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";

type ReferralStat = {
  totalReferrals: number;
  paidReferrals: number;
  totalPurchases: number;
  rewardThreshold: number;
  progressPercent: number;
  rewarded: boolean;
  upgradeThreshold: number;
  upgradeProgressPercent: number;
  currentCommissionPct: number;
  nextTierAt: number | null;
};

type Wallet = {
  balanceInr: number;
  totalEarnedInr: number;
  totalWithdrawnInr: number;
  isSuspended: boolean;
  suspendedReason: string | null;
  canWithdraw: boolean;
  minPaidReferralsToWithdraw: number;
};

type Earning = {
  id: string;
  refereeName: string;
  purchaseAmountInr: number;
  commissionPct: number;
  commissionInr: number;
  createdAt: string;
};

type Withdrawal = {
  id: string;
  amountInr: number;
  status: "REQUESTED" | "APPROVED" | "PROCESSING" | "PAID" | "REJECTED" | "FAILED";
  payoutMethodType: "UPI" | "BANK_ACCOUNT";
  adminNote: string | null;
  processedAt: string | null;
  createdAt: string;
};

type PayoutMethod = {
  type: "UPI" | "BANK_ACCOUNT";
  upiId: string | null;
  bankAccountNo: string | null; // masked
  bankIfsc: string | null;
  bankAccountName: string | null;
} | null;

const statusColor: Record<Withdrawal["status"], string> = {
  REQUESTED: "bg-warning/20 text-warning",
  APPROVED: "bg-warning/20 text-warning",
  PROCESSING: "bg-warning/20 text-warning",
  PAID: "bg-success/20 text-success",
  REJECTED: "bg-destructive/20 text-destructive",
  FAILED: "bg-destructive/20 text-destructive",
};

export default function ReferralPage() {
  const [code, setCode] = React.useState("");
  const [shareLink, setShareLink] = React.useState("");
  const [stats, setStats] = React.useState<ReferralStat | null>(null);
  const [wallet, setWallet] = React.useState<Wallet | null>(null);
  const [refs, setRefs] = React.useState<
    { id: string; refereeName: string; purchases: number; status: string }[]
  >([]);
  const [earnings, setEarnings] = React.useState<Earning[]>([]);
  const [withdrawals, setWithdrawals] = React.useState<Withdrawal[]>([]);
  const [payoutMethod, setPayoutMethod] = React.useState<PayoutMethod>(null);
  const [loading, setLoading] = React.useState(true);

  // Payout method form state
  const [pmType, setPmType] = React.useState<"UPI" | "BANK_ACCOUNT">("UPI");
  const [upiId, setUpiId] = React.useState("");
  const [bankAccountNo, setBankAccountNo] = React.useState("");
  const [bankIfsc, setBankIfsc] = React.useState("");
  const [bankAccountName, setBankAccountName] = React.useState("");
  const [savingMethod, setSavingMethod] = React.useState(false);
  const [methodMsg, setMethodMsg] = React.useState<string | null>(null);

  // Withdraw form state
  const [withdrawAmount, setWithdrawAmount] = React.useState("");
  const [withdrawing, setWithdrawing] = React.useState(false);
  const [withdrawMsg, setWithdrawMsg] = React.useState<string | null>(null);

  const load = async () => {
    try {
      const [meRes, earnRes, wdRes, pmRes] = await Promise.all([
        fetchAuth(`${API_BASE}/referral/me`),
        fetchAuth(`${API_BASE}/referral/earnings`),
        fetchAuth(`${API_BASE}/referral/withdrawals`),
        fetchAuth(`${API_BASE}/referral/payout-method`),
      ]);
      if (meRes.ok) {
        const d = await meRes.json();
        setCode(d.referralCode);
        setShareLink(d.shareLink);
        setStats(d.stats);
        setWallet(d.wallet);
        setRefs(d.referrals);
      }
      if (earnRes.ok) setEarnings(await earnRes.json());
      if (wdRes.ok) setWithdrawals(await wdRes.json());
      if (pmRes.ok) {
        const pm = await pmRes.json();
        setPayoutMethod(pm);
        if (pm) {
          setPmType(pm.type);
          setUpiId(pm.upiId || "");
          setBankIfsc(pm.bankIfsc || "");
          setBankAccountName(pm.bankAccountName || "");
        }
      }
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        shareLink || `https://sscprephub.in/signup?ref=${code}`,
      );
      alert("🔗 Referral link copied! Share with friends.");
    } catch {
      /* ignore */
    }
  };

  const savePayoutMethod = async () => {
    setMethodMsg(null);
    setSavingMethod(true);
    try {
      const body =
        pmType === "UPI"
          ? { type: "UPI", upiId }
          : { type: "BANK_ACCOUNT", bankAccountNo, bankIfsc, bankAccountName };
      const res = await fetchAuth(`${API_BASE}/referral/payout-method`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.message || "Could not save payout method");
      setMethodMsg("✅ Payout method saved!");
      await load();
    } catch (e) {
      setMethodMsg(`❌ ${(e as Error).message}`);
    } finally {
      setSavingMethod(false);
    }
  };

  const requestWithdrawal = async () => {
    setWithdrawMsg(null);
    const amt = Number(withdrawAmount);
    if (!amt || amt <= 0) {
      setWithdrawMsg("❌ Enter a valid amount");
      return;
    }
    setWithdrawing(true);
    try {
      const res = await fetchAuth(`${API_BASE}/referral/withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountInr: amt }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.message || "Withdrawal request failed");
      setWithdrawMsg("✅ Withdrawal requested! Admin will review and process it.");
      setWithdrawAmount("");
      await load();
    } catch (e) {
      setWithdrawMsg(`❌ ${(e as Error).message}`);
    } finally {
      setWithdrawing(false);
    }
  };

  const cancelWithdrawal = async (id: string) => {
    if (!confirm("Cancel this pending withdrawal request?")) return;
    const res = await fetchAuth(`${API_BASE}/referral/withdrawals/${id}/cancel`, { method: "POST" });
    if (res.ok) await load();
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">
            ← <span className="text-primary">SSC</span>PrepHub
          </a>
          <a href="/dashboard" className="btn btn-outline text-sm">
            Back to Dashboard
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-bold">Refer &amp; Earn 🎁</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Earn <span className="font-semibold text-primary">20% commission</span> on every friend&apos;s
          purchase. Cross <b>10 paid referrals</b> and it jumps to{" "}
          <span className="font-semibold text-primary">30%</span> — plus a free 30-day subscription. Hit{" "}
          <b>20 paid referrals</b> and get a free 6-month plan upgrade too.
        </p>

        {loading && <p className="mt-8 text-muted-foreground">Loading your referral stats…</p>}

        {!loading && (
          <>
            {wallet?.isSuspended && (
              <div className="mt-6 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                ⚠️ Your referral earnings are currently suspended by admin
                {wallet.suspendedReason ? `: ${wallet.suspendedReason}` : "."}
              </div>
            )}

            {/* ---- Wallet ---- */}
            {wallet && (
              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                <div className="card p-5">
                  <p className="text-xs text-muted-foreground">Wallet Balance</p>
                  <p className="mt-1 text-3xl font-bold text-primary">₹{wallet.balanceInr.toFixed(2)}</p>
                </div>
                <div className="card p-5">
                  <p className="text-xs text-muted-foreground">Total Earned (Lifetime)</p>
                  <p className="mt-1 text-3xl font-bold">₹{wallet.totalEarnedInr.toFixed(2)}</p>
                </div>
                <div className="card p-5">
                  <p className="text-xs text-muted-foreground">Total Withdrawn</p>
                  <p className="mt-1 text-3xl font-bold">₹{wallet.totalWithdrawnInr.toFixed(2)}</p>
                </div>
              </div>
            )}

            {/* ---- Referral counts ---- */}
            {stats && (
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <div className="card p-5">
                  <p className="text-xs text-muted-foreground">Total Referred</p>
                  <p className="mt-1 text-3xl font-bold">{stats.totalReferrals}</p>
                </div>
                <div className="card p-5">
                  <p className="text-xs text-muted-foreground">Paid Referrals ✅</p>
                  <p className="mt-1 text-3xl font-bold">{stats.paidReferrals}</p>
                </div>
                <div className="card p-5">
                  <p className="text-xs text-muted-foreground">Current Commission Rate</p>
                  <p className="mt-1 text-3xl font-bold text-primary">{stats.currentCommissionPct}%</p>
                  {stats.nextTierAt && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Reach {stats.nextTierAt} paid referrals for 30%
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ---- Progress bars ---- */}
            {stats && (
              <div className="card mt-6 p-5">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span>Free 30-day subscription ({stats.paidReferrals}/{stats.rewardThreshold})</span>
                  <span className="font-semibold">{stats.progressPercent}%</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all"
                    style={{ width: `${Math.min(stats.progressPercent, 100)}%` }}
                  />
                </div>
                {stats.rewarded && (
                  <p className="mt-2 text-sm font-semibold text-success">🎉 You&apos;ve earned your FREE subscription!</p>
                )}

                <div className="mb-2 mt-5 flex items-center justify-between text-sm">
                  <span>Free 6-month upgrade ({stats.paidReferrals}/{stats.upgradeThreshold})</span>
                  <span className="font-semibold">{stats.upgradeProgressPercent}%</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-accent to-primary transition-all"
                    style={{ width: `${Math.min(stats.upgradeProgressPercent, 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* ---- Referral code / share link ---- */}
            {code && (
              <div className="card mt-6 p-5">
                <p className="text-sm text-muted-foreground">Your referral code</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-2xl font-black tracking-widest text-primary">
                    {code}
                  </span>
                  <button onClick={copyLink} className="btn bg-primary text-primary-foreground hover:opacity-90">
                    📋 Copy Share Link
                  </button>
                </div>
                <p className="mt-3 break-all text-xs text-muted-foreground">{shareLink}</p>
              </div>
            )}

            {/* ---- Payout method ---- */}
            <div className="card mt-8 p-5">
              <h2 className="text-lg font-semibold">Payout Method</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Where should we send your withdrawal? Powered by Cashfree —{" "}
                <a
                  href="https://www.cashfree.com/docs/payments/online/web/redirect"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  learn more
                </a>
                .
              </p>

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => setPmType("UPI")}
                  className={`btn text-sm ${pmType === "UPI" ? "bg-primary text-primary-foreground" : "btn-outline"}`}
                >
                  UPI
                </button>
                <button
                  onClick={() => setPmType("BANK_ACCOUNT")}
                  className={`btn text-sm ${pmType === "BANK_ACCOUNT" ? "bg-primary text-primary-foreground" : "btn-outline"}`}
                >
                  Bank Account
                </button>
              </div>

              {pmType === "UPI" ? (
                <div className="mt-4">
                  <label className="text-xs text-muted-foreground">UPI ID</label>
                  <input
                    value={upiId}
                    onChange={(e) => setUpiId(e.target.value)}
                    placeholder="yourname@okhdfcbank"
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
              ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-xs text-muted-foreground">Account Number</label>
                    <input
                      value={bankAccountNo}
                      onChange={(e) => setBankAccountNo(e.target.value)}
                      placeholder="1234567890123"
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">IFSC Code</label>
                    <input
                      value={bankIfsc}
                      onChange={(e) => setBankIfsc(e.target.value.toUpperCase())}
                      placeholder="HDFC0000001"
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs text-muted-foreground">Account Holder Name</label>
                    <input
                      value={bankAccountName}
                      onChange={(e) => setBankAccountName(e.target.value)}
                      placeholder="As per bank records"
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              )}

              <button
                onClick={savePayoutMethod}
                disabled={savingMethod}
                className="btn mt-4 bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {savingMethod ? "Saving…" : "Save Payout Method"}
              </button>
              {methodMsg && <p className="mt-2 text-sm">{methodMsg}</p>}
              {payoutMethod && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Currently saved: {payoutMethod.type === "UPI" ? payoutMethod.upiId : `${payoutMethod.bankAccountName} · ${payoutMethod.bankAccountNo}`}
                </p>
              )}
            </div>

            {/* ---- Withdraw ---- */}
            <div className="card mt-6 p-5">
              <h2 className="text-lg font-semibold">Withdraw Earnings</h2>
              {wallet && !wallet.canWithdraw && !wallet.isSuspended && (
                <p className="mt-1 text-sm text-muted-foreground">
                  You need at least {wallet.minPaidReferralsToWithdraw} paid referrals to withdraw. Keep sharing!
                </p>
              )}
              {wallet?.canWithdraw && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={wallet.balanceInr}
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder={`Up to ₹${wallet.balanceInr.toFixed(2)}`}
                    className="w-40 rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                  <button
                    onClick={requestWithdrawal}
                    disabled={withdrawing || wallet.balanceInr <= 0}
                    className="btn bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {withdrawing ? "Requesting…" : "Request Withdrawal"}
                  </button>
                </div>
              )}
              {withdrawMsg && <p className="mt-2 text-sm">{withdrawMsg}</p>}

              {withdrawals.length > 0 && (
                <div className="mt-5 divide-y divide-border rounded-2xl border border-border bg-card">
                  {withdrawals.map((w) => (
                    <div key={w.id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="font-medium">₹{w.amountInr.toFixed(2)}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(w.createdAt).toLocaleDateString()} · {w.payoutMethodType}
                          {w.adminNote ? ` · ${w.adminNote}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusColor[w.status]}`}>
                          {w.status}
                        </span>
                        {w.status === "REQUESTED" && (
                          <button onClick={() => cancelWithdrawal(w.id)} className="text-xs text-destructive underline">
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ---- Earnings history ---- */}
            {earnings.length > 0 && (
              <div className="mt-8">
                <h2 className="text-lg font-semibold">Commission History</h2>
                <div className="mt-3 divide-y divide-border rounded-2xl border border-border bg-card">
                  {earnings.map((e) => (
                    <div key={e.id} className="flex items-center justify-between px-5 py-4">
                      <div>
                        <p className="font-medium">{e.refereeName}</p>
                        <p className="text-xs text-muted-foreground">
                          Purchase ₹{e.purchaseAmountInr} · {e.commissionPct}% commission · {new Date(e.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <span className="font-bold text-success">+₹{e.commissionInr.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ---- Referred people ---- */}
            <div className="mt-8">
              <h2 className="text-lg font-semibold">People you referred</h2>
              {refs.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No referrals yet. Share your code to start earning!</p>
              ) : (
                <div className="mt-3 divide-y divide-border rounded-2xl border border-border bg-card">
                  {refs.map((r) => (
                    <div key={r.id} className="flex items-center justify-between px-5 py-4">
                      <div>
                        <p className="font-medium">{r.refereeName}</p>
                        <p className="text-xs text-muted-foreground">{r.purchases} paid purchase(s)</p>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          r.status === "REWARDED"
                            ? "bg-success/20 text-success"
                            : r.status === "PAIDED"
                              ? "bg-warning/20 text-warning"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {r.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
