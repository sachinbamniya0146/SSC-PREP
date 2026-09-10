"use client";

// Admin — Refer & Earn control panel.
// Full visibility into the referral commission program: every referral
// pair, who actually paid, wallet balances, and a queue of withdrawal
// requests admin must approve/reject before any money moves. Also lets
// admin suspend a specific user's referral earning ability.

import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";

type ReferralRow = {
  id: string;
  referrer: { id: string; fullName: string; email: string };
  referee: { id: string; fullName: string; email: string; createdAt: string };
  status: "PENDING" | "PAIDED" | "REWARDED";
  purchasesCount: number;
  rewardedAt: string | null;
  createdAt: string;
};

type WithdrawalRow = {
  id: string;
  amountInr: number;
  status: "REQUESTED" | "APPROVED" | "PROCESSING" | "PAID" | "REJECTED" | "FAILED";
  payoutMethodType: "UPI" | "BANK_ACCOUNT";
  upiId: string | null;
  bankAccountNo: string | null;
  bankIfsc: string | null;
  bankAccountName: string | null;
  adminNote: string | null;
  cashfreeTransferId: string | null;
  createdAt: string;
  user: { id: string; fullName: string; email: string; phone: string | null };
};

const REFERRAL_STATUS_BADGE: Record<string, string> = {
  PENDING: "bg-muted text-muted-foreground",
  PAIDED: "bg-warning/15 text-warning",
  REWARDED: "bg-success/15 text-success",
};

const WITHDRAWAL_STATUS_BADGE: Record<string, string> = {
  REQUESTED: "bg-warning/15 text-warning",
  APPROVED: "bg-info/15 text-info",
  PROCESSING: "bg-info/15 text-info",
  PAID: "bg-success/15 text-success",
  REJECTED: "bg-danger/15 text-danger",
  FAILED: "bg-danger/15 text-danger",
};

export default function AdminReferralsPage() {
  const [tab, setTab] = React.useState<"withdrawals" | "referrals">("withdrawals");
  const [referrals, setReferrals] = React.useState<ReferralRow[]>([]);
  const [withdrawals, setWithdrawals] = React.useState<WithdrawalRow[]>([]);
  const [withdrawalFilter, setWithdrawalFilter] = React.useState<string>("REQUESTED");
  const [search, setSearch] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [actioningId, setActioningId] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);

  const loadReferrals = React.useCallback(async () => {
    const res = await fetchAuth(`${API_BASE}/admin/referrals${search ? `?search=${encodeURIComponent(search)}` : ""}`);
    if (res.ok) setReferrals(await res.json());
  }, [search]);

  const loadWithdrawals = React.useCallback(async () => {
    const res = await fetchAuth(
      `${API_BASE}/admin/withdrawals${withdrawalFilter ? `?status=${withdrawalFilter}` : ""}`,
    );
    if (res.ok) setWithdrawals(await res.json());
  }, [withdrawalFilter]);

  React.useEffect(() => {
    setLoading(true);
    Promise.all([loadReferrals(), loadWithdrawals()]).finally(() => setLoading(false));
  }, [loadReferrals, loadWithdrawals]);

  const approveWithdrawal = async (id: string) => {
    setActioningId(id);
    setMsg(null);
    try {
      const res = await fetchAuth(`${API_BASE}/admin/withdrawals/${id}/approve`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.message || "Approve failed");
      setMsg(d.autoPayout ? `✅ Paid automatically via Cashfree (Transfer: ${d.cfTransferId})` : `✅ ${d.message}`);
      await loadWithdrawals();
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`);
    } finally {
      setActioningId(null);
    }
  };

  const markPaid = async (id: string) => {
    if (!confirm("Confirm that you have manually sent this money via UPI/bank transfer?")) return;
    setActioningId(id);
    setMsg(null);
    try {
      const res = await fetchAuth(`${API_BASE}/admin/withdrawals/${id}/mark-paid`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.message || "Failed");
      setMsg("✅ Marked as paid");
      await loadWithdrawals();
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`);
    } finally {
      setActioningId(null);
    }
  };

  const rejectWithdrawal = async (id: string) => {
    const reason = prompt("Reason for rejecting? (amount will be refunded to user's wallet)") || "";
    setActioningId(id);
    setMsg(null);
    try {
      const res = await fetchAuth(`${API_BASE}/admin/withdrawals/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.message || "Reject failed");
      setMsg("✅ Rejected — amount refunded to user's wallet");
      await loadWithdrawals();
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`);
    } finally {
      setActioningId(null);
    }
  };

  const suspendUser = async (userId: string, suspended: boolean) => {
    const reason = suspended ? prompt("Reason for suspending this user's referral earnings?") || "Suspended by admin" : undefined;
    const res = await fetchAuth(`${API_BASE}/admin/referrals/user/${userId}/suspend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suspended, reason }),
    });
    if (res.ok) {
      setMsg(suspended ? "✅ User's referral earnings suspended" : "✅ User's referral earnings unsuspended");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <a href="/admin" className="text-lg font-bold">
            ← Admin
          </a>
          <h1 className="text-lg font-semibold">Refer &amp; Earn Control</h1>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex gap-2">
          <button
            onClick={() => setTab("withdrawals")}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === "withdrawals" ? "bg-primary text-primary-foreground" : "border border-border"}`}
          >
            Withdrawal Requests
          </button>
          <button
            onClick={() => setTab("referrals")}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === "referrals" ? "bg-primary text-primary-foreground" : "border border-border"}`}
          >
            All Referrals
          </button>
        </div>

        {msg && <div className="mt-4 rounded-lg border border-border bg-card px-4 py-2 text-sm">{msg}</div>}

        {tab === "withdrawals" && (
          <div className="mt-6">
            <div className="flex flex-wrap gap-2">
              {["REQUESTED", "APPROVED", "PROCESSING", "PAID", "REJECTED", "FAILED", ""].map((s) => (
                <button
                  key={s || "ALL"}
                  onClick={() => setWithdrawalFilter(s)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    withdrawalFilter === s ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"
                  }`}
                >
                  {s || "ALL"}
                </button>
              ))}
            </div>

            {loading ? (
              <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
            ) : withdrawals.length === 0 ? (
              <p className="mt-6 text-sm text-muted-foreground">No withdrawal requests in this status.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {withdrawals.map((w) => (
                  <div key={w.id} className="card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">
                          {w.user.fullName} <span className="font-normal text-muted-foreground">({w.user.email})</span>
                        </p>
                        <p className="mt-1 text-2xl font-bold text-primary">₹{w.amountInr.toFixed(2)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {w.payoutMethodType === "UPI"
                            ? `UPI: ${w.upiId}`
                            : `Bank: ${w.bankAccountName} · ${w.bankAccountNo} · ${w.bankIfsc}`}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Requested {new Date(w.createdAt).toLocaleString()}
                          {w.cashfreeTransferId ? ` · Cashfree Transfer: ${w.cashfreeTransferId}` : ""}
                        </p>
                        {w.adminNote && <p className="mt-1 text-xs italic text-muted-foreground">Note: {w.adminNote}</p>}
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${WITHDRAWAL_STATUS_BADGE[w.status]}`}>
                        {w.status}
                      </span>
                    </div>

                    {w.status === "REQUESTED" && (
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => approveWithdrawal(w.id)}
                          disabled={actioningId === w.id}
                          className="btn bg-success text-success-foreground text-sm disabled:opacity-50"
                        >
                          {actioningId === w.id ? "Processing…" : "✅ Approve"}
                        </button>
                        <button
                          onClick={() => rejectWithdrawal(w.id)}
                          disabled={actioningId === w.id}
                          className="btn btn-outline text-sm text-destructive disabled:opacity-50"
                        >
                          ❌ Reject
                        </button>
                      </div>
                    )}
                    {w.status === "APPROVED" && (
                      <div className="mt-3">
                        <button
                          onClick={() => markPaid(w.id)}
                          disabled={actioningId === w.id}
                          className="btn bg-success text-success-foreground text-sm disabled:opacity-50"
                        >
                          {actioningId === w.id ? "Saving…" : "💸 Mark as Paid (sent manually)"}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "referrals" && (
          <div className="mt-6">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email…"
              className="w-full max-w-sm rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />

            {loading ? (
              <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">Referrer</th>
                      <th className="px-4 py-2">Referee</th>
                      <th className="px-4 py-2">Purchases</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Joined</th>
                      <th className="px-4 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {referrals.map((r) => (
                      <tr key={r.id}>
                        <td className="px-4 py-2">
                          <a href={`/admin/referrals/${r.referrer.id}`} className="underline">
                            {r.referrer.fullName}
                          </a>
                          <div className="text-xs text-muted-foreground">{r.referrer.email}</div>
                        </td>
                        <td className="px-4 py-2">
                          {r.referee.fullName}
                          <div className="text-xs text-muted-foreground">{r.referee.email}</div>
                        </td>
                        <td className="px-4 py-2">{r.purchasesCount}</td>
                        <td className="px-4 py-2">
                          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${REFERRAL_STATUS_BADGE[r.status]}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {new Date(r.referee.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-2">
                          <button onClick={() => suspendUser(r.referrer.id, true)} className="text-xs text-destructive underline">
                            Suspend
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
