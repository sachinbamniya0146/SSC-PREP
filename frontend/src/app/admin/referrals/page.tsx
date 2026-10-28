"use client";

// Admin — Refer & Earn control panel.
// Overview of what the programme owes, the withdrawal queue, commissions (release / hold / reverse),
// every referral pair, and the editable rules (discounts, commission %, hold days, minimums).

import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";

type Overview = {
  withdrawableInr: number;
  pendingInr: number;
  lifetimeEarnedInr: number;
  paidOutInr: number;
  openWithdrawalsInr: number;
  openWithdrawals: number;
  waitingForReview: number;
  pendingEarnings: number;
  reversedEarnings: number;
  referralsTotal: number;
  referralsPaid: number;
  flaggedReferrals: number;
  conversionPct: number;
};

type ReferralRow = {
  id: string;
  referrer: { id: string; fullName: string; email: string };
  referee: { id: string; fullName: string; email: string; createdAt: string };
  status: "PENDING" | "PAIDED" | "REWARDED";
  purchasesCount: number;
  rewardedAt: string | null;
  flagReason: string | null;
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

type EarningRow = {
  id: string;
  referrer: { id: string; fullName: string; email: string };
  referee: { id: string; fullName: string; email: string };
  orderId: string;
  purchaseAmountInr: number;
  commissionPct: number;
  commissionInr: number;
  status: "PENDING" | "AVAILABLE" | "REVERSED";
  availableAt: string | null;
  holdReason: string | null;
  reversalNote: string | null;
  createdAt: string;
};

type Config = {
  enabled: boolean;
  refereeDiscountPct: number;
  refereeDiscountMaxInr: number;
  lowTierPct: number;
  highTierPct: number;
  highTierAfter: number;
  holdDays: number;
  minWithdrawInr: number;
  minPaidReferralsToWithdraw: number;
  freeMonthAt: number;
  freeUpgradeAt: number;
};

const FIELDS: { key: Exclude<keyof Config, "enabled">; label: string; hint: string; suffix?: string; step?: string }[] = [
  { key: "refereeDiscountPct", label: "Friend's welcome discount", hint: "Off the FIRST plan of a referred student. 0 turns it off.", suffix: "%" },
  { key: "refereeDiscountMaxInr", label: "Welcome discount cap", hint: "Maximum rupees taken off.", suffix: "₹" },
  { key: "lowTierPct", label: "Commission (starting)", hint: "Share of what the friend pays for a plan.", suffix: "%" },
  { key: "highTierPct", label: "Commission (top tier)", hint: "Applies once the referrer has enough paying friends.", suffix: "%" },
  { key: "highTierAfter", label: "Top tier starts at", hint: "Number of paying friends.", step: "1" },
  { key: "holdDays", label: "Hold period", hint: "Days a commission stays Pending (refund window). 0 = instant.", suffix: "days", step: "1" },
  { key: "minWithdrawInr", label: "Minimum withdrawal", hint: "Smallest amount a student can withdraw.", suffix: "₹" },
  { key: "minPaidReferralsToWithdraw", label: "Paying friends to withdraw", hint: "Needed before withdrawals open.", step: "1" },
  { key: "freeMonthAt", label: "Free month at", hint: "Paying friends for 30 free days of Premium.", step: "1" },
  { key: "freeUpgradeAt", label: "Free 6-month upgrade at", hint: "Paying friends for the 6-month upgrade.", step: "1" },
];

const inr = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString("en-IN")}`;
const WD_BADGE: Record<string, string> = {
  REQUESTED: "badge badge-warning", APPROVED: "badge badge-info", PROCESSING: "badge badge-info",
  PAID: "badge badge-success", REJECTED: "badge badge-danger", FAILED: "badge badge-danger",
};
const EARN_BADGE: Record<string, string> = { PENDING: "badge badge-warning", AVAILABLE: "badge badge-success", REVERSED: "badge badge-danger" };

type Dialog = { title: string; body?: string; ask?: string; confirmLabel: string; danger?: boolean; minLen?: number; run: (text: string) => Promise<void> };

export default function AdminReferralsPage() {
  const [tab, setTab] = React.useState<"withdrawals" | "commissions" | "referrals" | "rules">("withdrawals");
  const [overview, setOverview] = React.useState<Overview | null>(null);
  const [referrals, setReferrals] = React.useState<ReferralRow[]>([]);
  const [withdrawals, setWithdrawals] = React.useState<WithdrawalRow[]>([]);
  const [earnings, setEarnings] = React.useState<EarningRow[]>([]);
  const [wdFilter, setWdFilter] = React.useState("REQUESTED");
  const [earnFilter, setEarnFilter] = React.useState("review");
  const [search, setSearch] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [dialog, setDialog] = React.useState<Dialog | null>(null);
  const [dialogText, setDialogText] = React.useState("");
  const [dialogBusy, setDialogBusy] = React.useState(false);

  const [cfg, setCfg] = React.useState<Config | null>(null);
  const [form, setForm] = React.useState<Record<string, string>>({});
  const [enabled, setEnabled] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const say = (ok: boolean, text: string) => setMsg({ ok, text });

  const loadOverview = React.useCallback(async () => {
    const r = await fetchAuth(`${API_BASE}/admin/referral-program/overview`);
    if (r.ok) setOverview(await r.json());
  }, []);
  const loadReferrals = React.useCallback(async () => {
    const r = await fetchAuth(`${API_BASE}/admin/referrals${search ? `?search=${encodeURIComponent(search)}` : ""}`);
    if (r.ok) setReferrals(await r.json());
  }, [search]);
  const loadWithdrawals = React.useCallback(async () => {
    const r = await fetchAuth(`${API_BASE}/admin/withdrawals${wdFilter ? `?status=${wdFilter}` : ""}`);
    if (r.ok) setWithdrawals(await r.json());
  }, [wdFilter]);
  const loadEarnings = React.useCallback(async () => {
    const r = await fetchAuth(`${API_BASE}/admin/referral-program/earnings?filter=${earnFilter}`);
    if (r.ok) setEarnings(await r.json());
  }, [earnFilter]);
  const loadSettings = React.useCallback(async () => {
    const r = await fetchAuth(`${API_BASE}/admin/referral-program/settings`);
    if (!r.ok) return;
    const d: { config: Config } = await r.json();
    setCfg(d.config);
    setEnabled(d.config.enabled);
    setForm(Object.fromEntries(FIELDS.map((f) => [f.key, String(d.config[f.key])])));
  }, []);

  React.useEffect(() => {
    setLoading(true);
    Promise.all([loadOverview(), loadReferrals(), loadWithdrawals(), loadEarnings(), loadSettings()]).finally(() => setLoading(false));
  }, [loadOverview, loadReferrals, loadWithdrawals, loadEarnings, loadSettings]);

  const refreshAll = () => Promise.all([loadOverview(), loadWithdrawals(), loadEarnings(), loadReferrals()]);

  async function call(id: string | null, url: string, body: unknown, okText: (d: any) => string) {
    setBusyId(id);
    try {
      const res = await fetchAuth(`${API_BASE}${url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.message || "Action failed");
      say(true, okText(d));
      await refreshAll();
    } catch (e) {
      say(false, (e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const ask = (d: Dialog) => {
    setDialogText("");
    setDialog(d);
  };
  const runDialog = async () => {
    if (!dialog) return;
    if ((dialog.minLen ?? 0) > dialogText.trim().length) return;
    setDialogBusy(true);
    try {
      await dialog.run(dialogText.trim());
      setDialog(null);
    } finally {
      setDialogBusy(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { enabled };
      for (const f of FIELDS) body[f.key] = Number(form[f.key]);
      const res = await fetchAuth(`${API_BASE}/admin/referral-program/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.message || "Could not save the rules");
      say(true, "Rules saved. They apply to new signups and new purchases right away.");
      await loadSettings();
    } catch (e) {
      say(false, (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const Card = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) => (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-extrabold tabular-nums ${tone ?? ""}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );

  const TabBtn = ({ id, label, count }: { id: typeof tab; label: string; count?: number }) => (
    <button
      onClick={() => setTab(id)}
      role="tab"
      aria-selected={tab === id}
      className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold ${tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
    >
      {label}
      {count ? <span className="ml-1.5 rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold text-danger-foreground">{count}</span> : null}
    </button>
  );

  const field = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

  return (
    <div className="text-foreground">
      <header className="sticky top-0 px-4 py-4">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-xl font-bold sm:text-2xl">Refer &amp; Earn control</h1>
          <p className="mt-1 text-sm text-muted-foreground">Rules, commissions on hold, withdrawals and every referral — in one place.</p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-10">
        {overview && (
          <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card label="Owed — withdrawable" value={inr(overview.withdrawableInr)} sub="Released commission in wallets" tone="text-success" />
            <Card label="Owed — pending" value={inr(overview.pendingInr)} sub={`${overview.pendingEarnings} commissions in hold`} tone="text-warning" />
            <Card label="Withdrawals waiting" value={inr(overview.openWithdrawalsInr)} sub={`${overview.openWithdrawals} request${overview.openWithdrawals === 1 ? "" : "s"}`} />
            <Card label="Paid out so far" value={inr(overview.paidOutInr)} sub={`${inr(overview.lifetimeEarnedInr)} earned in total`} />
            <Card label="Referrals" value={String(overview.referralsTotal)} sub={`${overview.referralsPaid} bought a plan · ${overview.conversionPct}%`} />
            <Card label="Held for review" value={String(overview.waitingForReview)} sub="Commissions waiting for you" tone={overview.waitingForReview ? "text-danger" : ""} />
            <Card label="Flagged referrals" value={String(overview.flaggedReferrals)} sub="Same-device etc." />
            <Card label="Reversed" value={String(overview.reversedEarnings)} sub="Refunds / fraud" />
          </section>
        )}

        {msg && (
          <div role="status" className={`mb-4 flex items-start justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm ${msg.ok ? "border-success/30 bg-success/10" : "border-danger/30 bg-danger/10 text-danger"}`}>
            <span>{msg.text}</span>
            <button className="text-xs underline" onClick={() => setMsg(null)}>Dismiss</button>
          </div>
        )}

        <div role="tablist" className="flex overflow-x-auto border-b border-border">
          <TabBtn id="withdrawals" label="Withdrawals" count={overview?.openWithdrawals} />
          <TabBtn id="commissions" label="Commissions" count={overview?.waitingForReview} />
          <TabBtn id="referrals" label="All referrals" />
          <TabBtn id="rules" label="Rules" />
        </div>

        {/* ---------------- Withdrawals ---------------- */}
        {tab === "withdrawals" && (
          <div className="mt-5">
            <div className="flex flex-wrap gap-2">
              {["REQUESTED", "APPROVED", "PROCESSING", "PAID", "REJECTED", "FAILED", ""].map((s) => (
                <button key={s || "ALL"} onClick={() => setWdFilter(s)} className={`rounded-full px-3 py-1 text-xs font-semibold ${wdFilter === s ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}>
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
                      <div className="min-w-0">
                        <p className="font-semibold">
                          <a href={`/admin/referrals/${w.user.id}`} className="hover:underline">{w.user.fullName}</a>{" "}
                          <span className="font-normal text-muted-foreground">({w.user.email})</span>
                        </p>
                        <p className="mt-1 text-2xl font-bold text-primary">{inr(w.amountInr)}</p>
                        <p className="mt-1 break-all text-xs text-muted-foreground">
                          {w.payoutMethodType === "UPI" ? `UPI: ${w.upiId}` : `Bank: ${w.bankAccountName} · ${w.bankAccountNo} · ${w.bankIfsc}`}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Requested {new Date(w.createdAt).toLocaleString("en-IN")}
                          {w.cashfreeTransferId ? ` · Cashfree transfer: ${w.cashfreeTransferId}` : ""}
                        </p>
                        {w.adminNote && <p className="mt-1 text-xs italic text-muted-foreground">Note: {w.adminNote}</p>}
                      </div>
                      <span className={WD_BADGE[w.status]}>{w.status}</span>
                    </div>
                    {w.status === "REQUESTED" && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          disabled={busyId === w.id}
                          className="btn btn-primary btn-sm"
                          onClick={() => call(w.id, `/admin/withdrawals/${w.id}/approve`, undefined, (d) => (d.autoPayout ? `Paid automatically via Cashfree (transfer ${d.cfTransferId}).` : d.message || "Approved."))}
                        >
                          {busyId === w.id ? "Working…" : "Approve"}
                        </button>
                        <button
                          disabled={busyId === w.id}
                          className="btn btn-outline btn-sm text-danger"
                          onClick={() =>
                            ask({
                              title: `Reject ${inr(w.amountInr)} for ${w.user.fullName}?`,
                              body: "The amount goes back to the student's withdrawable balance. Tell them why:",
                              ask: "Reason (shown to the student)",
                              confirmLabel: "Reject request",
                              danger: true,
                              minLen: 3,
                              run: (reason) => call(w.id, `/admin/withdrawals/${w.id}/reject`, { reason }, () => "Rejected — the amount is back in the student's wallet."),
                            })
                          }
                        >
                          Reject
                        </button>
                      </div>
                    )}
                    {w.status === "APPROVED" && (
                      <div className="mt-3">
                        <button
                          disabled={busyId === w.id}
                          className="btn btn-primary btn-sm"
                          onClick={() =>
                            ask({
                              title: "Mark as paid?",
                              body: `Confirm you have already sent ${inr(w.amountInr)} to ${w.payoutMethodType === "UPI" ? w.upiId : w.bankAccountName} by UPI / bank transfer.`,
                              confirmLabel: "Yes, I sent it",
                              run: () => call(w.id, `/admin/withdrawals/${w.id}/mark-paid`, undefined, () => "Marked as paid."),
                            })
                          }
                        >
                          Mark as paid (sent manually)
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---------------- Commissions ---------------- */}
        {tab === "commissions" && (
          <div className="mt-5">
            <p className="mb-3 max-w-3xl text-sm text-muted-foreground">
              Every commission starts as <b>Pending</b> and is released on its own after the hold period. Ones marked <b>Needs review</b> (for example both accounts used the same device) wait for you:
              approve to release, or reverse to cancel.
            </p>
            <div className="flex flex-wrap gap-2">
              {[["review", "Needs review"], ["pending", "Pending"], ["available", "Released"], ["reversed", "Reversed"], ["all", "All"]].map(([k, label]) => (
                <button key={k} onClick={() => setEarnFilter(k)} className={`rounded-full px-3 py-1 text-xs font-semibold ${earnFilter === k ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}>
                  {label}
                </button>
              ))}
              <button
                className="btn btn-outline btn-sm ml-auto"
                onClick={() => call(null, "/admin/referral-program/release-now", undefined, (d) => `${d.released} commission${d.released === 1 ? "" : "s"} released.`)}
              >
                Release due now
              </button>
            </div>
            {earnings.length === 0 ? (
              <p className="mt-6 text-sm text-muted-foreground">Nothing here.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {earnings.map((e) => {
                  const review = e.status === "PENDING" && e.availableAt === null;
                  return (
                    <div key={e.id} className="card p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold">
                            <a href={`/admin/referrals/${e.referrer.id}`} className="hover:underline">{e.referrer.fullName}</a>
                            <span className="font-normal text-muted-foreground"> earned from </span>
                            {e.referee.fullName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {e.referrer.email} ← {e.referee.email} · order {e.orderId} · {new Date(e.createdAt).toLocaleDateString("en-IN")}
                          </p>
                          <p className="mt-1 text-sm">
                            {e.commissionPct}% of {inr(e.purchaseAmountInr)} = <b className="text-success">{inr(e.commissionInr)}</b>
                            {e.status === "PENDING" && e.availableAt ? <span className="text-muted-foreground"> · releases {new Date(e.availableAt).toLocaleDateString("en-IN")}</span> : null}
                          </p>
                          {review && e.holdReason && <p className="mt-1 text-xs font-medium text-warning">Needs review — {e.holdReason}</p>}
                          {e.reversalNote && <p className="mt-1 text-xs italic text-muted-foreground">Reversed: {e.reversalNote}</p>}
                        </div>
                        <span className={EARN_BADGE[e.status]}>{review ? "NEEDS REVIEW" : e.status}</span>
                      </div>
                      {e.status !== "REVERSED" && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {review && (
                            <button disabled={busyId === e.id} className="btn btn-primary btn-sm" onClick={() => call(e.id, `/admin/referral-program/earnings/${e.id}/approve`, undefined, () => "Approved and released to the wallet.")}>
                              Approve &amp; release
                            </button>
                          )}
                          <button
                            disabled={busyId === e.id}
                            className="btn btn-outline btn-sm text-danger"
                            onClick={() =>
                              ask({
                                title: `Reverse ${inr(e.commissionInr)}?`,
                                body:
                                  e.status === "AVAILABLE"
                                    ? "This commission was already released, so it is deducted from the student's withdrawable balance (it can go below zero)."
                                    : "The pending amount is removed from the student's wallet.",
                                ask: "Reason (kept in the record)",
                                confirmLabel: "Reverse commission",
                                danger: true,
                                minLen: 3,
                                run: (note) => call(e.id, `/admin/referral-program/earnings/${e.id}/reverse`, { note }, () => "Commission reversed."),
                              })
                            }
                          >
                            Reverse
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ---------------- Referrals ---------------- */}
        {tab === "referrals" && (
          <div className="mt-5">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email…" className={`${field} max-w-sm`} aria-label="Search referrals" />
            {loading ? (
              <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-xl border border-border">
                <table className="table-clean">
                  <thead>
                    <tr>
                      <th>Referrer</th>
                      <th>Friend</th>
                      <th>Plans bought</th>
                      <th>Status</th>
                      <th>Joined</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {referrals.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <a href={`/admin/referrals/${r.referrer.id}`} className="font-medium hover:underline">{r.referrer.fullName}</a>
                          <div className="text-xs text-muted-foreground">{r.referrer.email}</div>
                        </td>
                        <td>
                          {r.referee.fullName}
                          <div className="text-xs text-muted-foreground">{r.referee.email}</div>
                        </td>
                        <td className="tabular-nums">{r.purchasesCount}</td>
                        <td>
                          <span className={`badge ${r.status === "PENDING" ? "bg-muted text-muted-foreground" : r.status === "REWARDED" ? "badge-success" : "badge-warning"}`}>{r.status}</span>
                          {r.flagReason && <div className="mt-1 text-[11px] font-medium text-warning">⚑ {r.flagReason.split(":")[0]}</div>}
                        </td>
                        <td className="text-xs text-muted-foreground">{new Date(r.referee.createdAt).toLocaleDateString("en-IN")}</td>
                        <td>
                          <button
                            className="text-xs font-medium text-danger underline"
                            onClick={() =>
                              ask({
                                title: `Pause ${r.referrer.fullName}'s referral earnings?`,
                                body: "No new commission is credited and they cannot withdraw. Money already earned is untouched. You can lift this on their detail page.",
                                ask: "Reason",
                                confirmLabel: "Pause earnings",
                                danger: true,
                                minLen: 3,
                                run: (reason) => call(null, `/admin/referrals/user/${r.referrer.id}/suspend`, { suspended: true, reason }, () => "Referral earnings paused for this user."),
                              })
                            }
                          >
                            Pause earnings
                          </button>
                        </td>
                      </tr>
                    ))}
                    {referrals.length === 0 && (
                      <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No referrals found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ---------------- Rules ---------------- */}
        {tab === "rules" && (
          <div className="mt-5 max-w-3xl">
            {!cfg ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <>
                <label className="card flex cursor-pointer items-center justify-between gap-4 p-4">
                  <span>
                    <span className="block font-semibold">Programme is {enabled ? "ON" : "PAUSED"}</span>
                    <span className="block text-sm text-muted-foreground">When paused there is no welcome discount and no new commission. Money already earned can still be withdrawn.</span>
                  </span>
                  <input type="checkbox" className="h-5 w-5" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} aria-label="Programme on" />
                </label>

                <div className="card mt-4 grid gap-4 p-4 sm:grid-cols-2">
                  {FIELDS.map((f) => (
                    <div key={f.key}>
                      <label htmlFor={`f-${f.key}`} className="mb-1 block text-sm font-medium">{f.label}</label>
                      <div className="relative">
                        <input
                          id={`f-${f.key}`}
                          inputMode="decimal"
                          value={form[f.key] ?? ""}
                          onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value.replace(/[^\d.]/g, "") }))}
                          className={`${field} ${f.suffix ? "pr-12" : ""}`}
                        />
                        {f.suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{f.suffix}</span>}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{f.hint}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <button className="btn btn-primary" disabled={saving} onClick={() => void saveSettings()}>{saving ? "Saving…" : "Save rules"}</button>
                  <button className="btn btn-outline" disabled={saving} onClick={() => void loadSettings()}>Discard changes</button>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Changes apply to new signups and purchases from now on. Commission that is already pending keeps the rate it was earned at.
                </p>
              </>
            )}
          </div>
        )}
      </main>

      {/* confirm / reason dialog (replaces the browser prompt()) */}
      {dialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={dialog.title}>
          <div className="card w-full max-w-md p-5 shadow-xl">
            <h2 className="text-lg font-bold">{dialog.title}</h2>
            {dialog.body && <p className="mt-2 text-sm text-muted-foreground">{dialog.body}</p>}
            {dialog.ask && (
              <>
                <label htmlFor="dlg-text" className="mb-1 mt-4 block text-sm font-medium">{dialog.ask}</label>
                <textarea id="dlg-text" autoFocus rows={3} value={dialogText} onChange={(e) => setDialogText(e.target.value)} className={field} />
              </>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-outline" onClick={() => setDialog(null)} disabled={dialogBusy}>Cancel</button>
              <button
                className={`btn ${dialog.danger ? "bg-danger text-danger-foreground" : "btn-primary"}`}
                disabled={dialogBusy || (dialog.minLen ?? 0) > dialogText.trim().length}
                onClick={() => void runDialog()}
              >
                {dialogBusy ? "Working…" : dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
