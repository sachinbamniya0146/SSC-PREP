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
  wallet: { balanceInr: number; pendingInr?: number; totalEarnedInr: number; totalWithdrawnInr: number; isSuspended: boolean };
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
    status?: "PENDING" | "AVAILABLE" | "REVERSED";
    holdReason?: string | null;
    availableAt?: string | null;
    reversalNote?: string | null;
    createdAt: string;
  }[];
  withdrawals: {
    id: string;
    amountInr: number;
    status: string;
    createdAt: string;
    approvedAt?: string | null;
    paidAt?: string | null;
    rejectedAt?: string | null;
    paymentRef?: string | null;
    adminNote?: string | null;
  }[];
};

export default function AdminReferralUserDetailPage() {
  const params = useParams();
  const userId = params?.userId as string;
  const [data, setData] = React.useState<Detail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [reasonOpen, setReasonOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");

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
    if (suspended && reason.trim().length < 3) return;
    const res = await fetchAuth(`${API_BASE}/admin/referrals/user/${userId}/suspend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suspended, reason: suspended ? reason.trim() : undefined }),
    });
    if (res.ok) {
      setMsg(suspended ? "Referral earnings paused." : "Referral earnings restored.");
      setReasonOpen(false);
      setReason("");
      await load();
    } else {
      const d = await res.json().catch(() => ({}));
      setMsg(d?.message || "Could not update.");
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
              Restore referral earnings
            </button>
          ) : (
            reasonOpen ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  autoFocus
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason (min 3 characters)"
                  className="min-w-[220px] flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm"
                />
                <button onClick={() => toggleSuspend(true)} disabled={reason.trim().length < 3} className="btn bg-danger text-danger-foreground text-sm">Pause earnings</button>
                <button onClick={() => setReasonOpen(false)} className="btn btn-outline text-sm">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setReasonOpen(true)} className="btn btn-outline text-sm text-danger">
                Pause referral earnings
              </button>
            )
          )}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-4">
          <div className="card p-4">
            <p className="text-xs text-muted-foreground">Pending (in hold)</p>
            <p className="text-2xl font-bold text-warning">₹{(data.wallet.pendingInr ?? 0).toFixed(2)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-muted-foreground">Withdrawable</p>
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
                <p className="text-xs text-muted-foreground">
                  Order {e.orderId} · ₹{e.purchaseAmountInr} × {e.commissionPct}%
                  {e.status === "PENDING" ? (e.availableAt ? ` · releases ${new Date(e.availableAt).toLocaleDateString("en-IN")}` : ` · needs review${e.holdReason ? ` (${e.holdReason})` : ""}`) : ""}
                  {e.status === "REVERSED" && e.reversalNote ? ` · reversed: ${e.reversalNote}` : ""}
                </p>
              </div>
              <div className="text-right">
                <span className={`font-bold ${e.status === "REVERSED" ? "text-muted-foreground line-through" : "text-success"}`}>+₹{e.commissionInr.toFixed(2)}</span>
                {e.status && <p className="text-[11px] font-semibold text-muted-foreground">{e.status}</p>}
              </div>
            </div>
          ))}
          {data.earnings.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No commission earned yet.</p>}
        </div>

        <h2 className="mt-8 text-lg font-semibold">Withdrawals ({data.withdrawals.length})</h2>
        <div className="mt-3 divide-y divide-border rounded-2xl border border-border bg-card">
          {data.withdrawals.map((w) => (
            <div key={w.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p>₹{w.amountInr.toFixed(2)} · requested {new Date(w.createdAt).toLocaleDateString("en-IN")}</p>
                <p className="text-xs text-muted-foreground">
                  {w.approvedAt ? `Sanctioned ${new Date(w.approvedAt).toLocaleDateString("en-IN")}` : "Not sanctioned"}
                  {w.paidAt ? ` · Paid ${new Date(w.paidAt).toLocaleDateString("en-IN")}` : ""}
                  {w.rejectedAt ? ` · Returned ${new Date(w.rejectedAt).toLocaleDateString("en-IN")}` : ""}
                  {w.paymentRef ? ` · UTR ${w.paymentRef}` : ""}
                </p>
                {w.adminNote && <p className="text-xs italic text-muted-foreground">{w.adminNote}</p>}
              </div>
              <span className="text-xs font-semibold">{w.status}</span>
            </div>
          ))}
          {data.withdrawals.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No withdrawals yet.</p>}
        </div>
      </main>
    </div>
  );
}
