"use client";

// Full audit trail for one referrer: wallet, every referral they made,
// every commission earning, every withdrawal, and their saved payout
// method. This is the "kis user ne kitne refer kre, kaha se purchase hua"
// screen admin asked for.

import * as React from "react";
import { useParams } from "next/navigation";
import { API_BASE, fetchAuth } from "@/lib/api";

type Detail = {
  user: { id: string; fullName: string; email: string; referralCode: string | null; freeSubFromReferral: boolean };
  wallet: { balanceInr: number; totalEarnedInr: number; totalWithdrawnInr: number; isSuspended: boolean };
  payoutMethod: {
    type: "UPI" | "BANK_ACCOUNT";
    upiId: string | null;
    bankAccountNo: string | null;
    bankIfsc: string | null;
    bankAccountName: string | null;
  } | null;
  referrals: {
    id: string;
    referee: { id: string; fullName: string; email: string; createdAt: string };
    status: string;
    purchasesCount: number;
    rewardedAt: string | null;
    createdAt: string;
  }[];
  earnings: {
    id: string;
    refereeName: string;
    orderId: string;
    purchaseAmountInr: number;
    commissionPct: number;
    commissionInr: number;
    createdAt: string;
  }[];
  withdrawals: { id: string; amountInr: number; status: string; createdAt: string }[];
};

export default function AdminReferralUserDetailPage() {
  const params = useParams();
  const userId = params?.userId as string;
  const [data, setData] = React.useState<Detail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [msg, setMsg] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    const res = await fetchAuth(`${API_BASE}/admin/referrals/user/${userId}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [userId]);

  React.useEffect(() => {
    if (userId) load();
  }, [userId, load]);

  const toggleSuspend = async (suspended: boolean) => {
    const reason = suspended ? prompt("Reason for suspending?") || "Suspended by admin" : undefined;
    const res = await fetchAuth(`${API_BASE}/admin/referrals/user/${userId}/suspend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suspended, reason }),
    });
    if (res.ok) {
      setMsg(suspended ? "✅ Suspended" : "✅ Unsuspended");
      await load();
    }
  };

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (!data) return <div className="p-8 text-sm text-muted-foreground">User not found.</div>;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <a href="/admin/referrals" className="text-lg font-bold">
            ← Refer &amp; Earn
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold">{data.user.fullName}</h1>
        <p className="text-sm text-muted-foreground">{data.user.email} · Code: {data.user.referralCode || "—"}</p>
        {msg && <p className="mt-2 text-sm">{msg}</p>}

        <div className="mt-4">
          {data.wallet.isSuspended ? (
            <button onClick={() => toggleSuspend(false)} className="btn bg-success text-success-foreground text-sm">
              ✅ Unsuspend Referral Earnings
            </button>
          ) : (
            <button onClick={() => toggleSuspend(true)} className="btn btn-outline text-sm text-destructive">
              🚫 Suspend Referral Earnings
            </button>
          )}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="card p-4">
            <p className="text-xs text-muted-foreground">Wallet Balance</p>
            <p className="text-2xl font-bold text-primary">₹{data.wallet.balanceInr.toFixed(2)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-muted-foreground">Total Earned</p>
            <p className="text-2xl font-bold">₹{data.wallet.totalEarnedInr.toFixed(2)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-muted-foreground">Total Withdrawn</p>
            <p className="text-2xl font-bold">₹{data.wallet.totalWithdrawnInr.toFixed(2)}</p>
          </div>
        </div>

        {data.payoutMethod && (
          <div className="card mt-4 p-4 text-sm">
            <p className="text-xs text-muted-foreground">Payout Method</p>
            <p className="mt-1">
              {data.payoutMethod.type === "UPI"
                ? `UPI: ${data.payoutMethod.upiId}`
                : `Bank: ${data.payoutMethod.bankAccountName} · ${data.payoutMethod.bankAccountNo} · ${data.payoutMethod.bankIfsc}`}
            </p>
          </div>
        )}

        <h2 className="mt-8 text-lg font-semibold">Referrals ({data.referrals.length})</h2>
        <div className="mt-3 divide-y divide-border rounded-2xl border border-border bg-card">
          {data.referrals.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <p className="font-medium">{r.referee.fullName}</p>
                <p className="text-xs text-muted-foreground">{r.referee.email} · joined {new Date(r.referee.createdAt).toLocaleDateString()}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold">{r.purchasesCount} purchase(s)</p>
                <p className="text-xs text-muted-foreground">{r.status}</p>
              </div>
            </div>
          ))}
          {data.referrals.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No referrals yet.</p>}
        </div>

        <h2 className="mt-8 text-lg font-semibold">Commission Earnings ({data.earnings.length})</h2>
        <div className="mt-3 divide-y divide-border rounded-2xl border border-border bg-card">
          {data.earnings.map((e) => (
            <div key={e.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <p className="font-medium">{e.refereeName}</p>
                <p className="text-xs text-muted-foreground">Order {e.orderId} · ₹{e.purchaseAmountInr} × {e.commissionPct}%</p>
              </div>
              <span className="font-bold text-success">+₹{e.commissionInr.toFixed(2)}</span>
            </div>
          ))}
          {data.earnings.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No commission earned yet.</p>}
        </div>

        <h2 className="mt-8 text-lg font-semibold">Withdrawals ({data.withdrawals.length})</h2>
        <div className="mt-3 divide-y divide-border rounded-2xl border border-border bg-card">
          {data.withdrawals.map((w) => (
            <div key={w.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <p>₹{w.amountInr.toFixed(2)} · {new Date(w.createdAt).toLocaleDateString()}</p>
              <span className="text-xs font-semibold">{w.status}</span>
            </div>
          ))}
          {data.withdrawals.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No withdrawals yet.</p>}
        </div>
      </main>
    </div>
  );
}
