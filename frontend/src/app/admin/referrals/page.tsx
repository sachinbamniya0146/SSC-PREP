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
  paymentRef: string | null;
  gatewayStatus: string | null;
  createdAt: string;
  approvedAt: string | null;
  paidAt: string | null;
  rejectedAt: string | null;
  flaggedFriends: number;
  user: { id: string; fullName: string; email: string; phone: string | null };
};

type Bucket = { count: number; amountInr: number };
type WdStats = {
  awaiting: Bucket;
  sanctioned: Bucket;
  processing: Bucket;
  paid: Bucket;
  rejected: Bucket;
  sanctionedTotal: Bucket;
  toPay: Bucket;
  paidToday: Bucket;
  paidLast30Days: Bucket;
  oldestAwaitingHours: number | null;
  payoutMode: "MANUAL" | "CASHFREE";
  mismatch: { walletTotalInr: number; paidRowsInr: number; differenceInr: number } | null;
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
const WD_LABEL: Record<string, string> = {
  REQUESTED: "Waiting", APPROVED: "Sanctioned", PROCESSING: "Sending", PAID: "Paid", REJECTED: "Rejected", FAILED: "Failed",
};
const fmtDT = (d: string | null) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

/** A spreadsheet would run a cell that starts with = + - @ as a formula: neutralise it. */
const csvCell = (v: unknown) => {
  let t = String(v ?? "");
  if (/^[=+\-@]/.test(t)) t = `'${t}`;
  return `"${t.replace(/"/g, '""')}"`;
};

const EARN_BADGE: Record<string, string> = { PENDING: "badge badge-warning", AVAILABLE: "badge badge-success", REVERSED: "badge badge-danger" };

type Dialog = {
  title: string;
  body?: string;
  /** text box (reason / note) */
  ask?: string;
  minLen?: number;
  /** single-line box above it (the UTR); required when set */
  refLabel?: string;
  confirmLabel: string;
  danger?: boolean;
  run: (text: string, ref: string) => Promise<void>;
};

export default function AdminReferralsPage() {
  const [tab, setTab] = React.useState<"withdrawals" | "commissions" | "referrals" | "rules">("withdrawals");
  const [overview, setOverview] = React.useState<Overview | null>(null);
  const [referrals, setReferrals] = React.useState<ReferralRow[]>([]);
  const [withdrawals, setWithdrawals] = React.useState<WithdrawalRow[]>([]);
  const [earnings, setEarnings] = React.useState<EarningRow[]>([]);
  const [wdFilter, setWdFilter] = React.useState("REQUESTED");
  const [wdSearch, setWdSearch] = React.useState("");
  const [wdQuery, setWdQuery] = React.useState(""); // wdSearch after the admin stopped typing
  const [wdStats, setWdStats] = React.useState<WdStats | null>(null);
  const [earnFilter, setEarnFilter] = React.useState("review");
  const [search, setSearch] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [dialog, setDialog] = React.useState<Dialog | null>(null);
  const [dialogText, setDialogText] = React.useState("");
  const [dialogRef, setDialogRef] = React.useState("");
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
    const qs = new URLSearchParams();
    if (wdFilter) qs.set("status", wdFilter);
    if (wdQuery.trim()) qs.set("q", wdQuery.trim());
    const [list, stats] = await Promise.all([
      fetchAuth(`${API_BASE}/admin/withdrawals${qs.toString() ? `?${qs}` : ""}`),
      fetchAuth(`${API_BASE}/admin/withdrawals/stats`),
    ]);
    if (list.ok) setWithdrawals(await list.json());
    if (stats.ok) setWdStats(await stats.json());
  }, [wdFilter, wdQuery]);
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

  React.useEffect(() => {
    const t = window.setTimeout(() => setWdQuery(wdSearch), 350);
    return () => window.clearTimeout(t);
  }, [wdSearch]);

  // keep the queue fresh while the admin has the Withdrawals tab open (another admin / the status job may change rows)
  React.useEffect(() => {
    if (tab !== "withdrawals") return;
    const t = window.setInterval(() => {
      if (!document.hidden) void Promise.all([loadWithdrawals(), loadOverview()]);
    }, 60_000);
    return () => window.clearInterval(t);
  }, [tab, loadWithdrawals, loadOverview]);

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
      say(!d?.uncertain, okText(d));
      await refreshAll();
    } catch (e) {
      say(false, (e as Error).message);
      void refreshAll(); // the request may already have been handled by someone else - show the real state
    } finally {
      setBusyId(null);
    }
  }

  const ask = (d: Dialog) => {
    setDialogText("");
    setDialogRef("");
    setDialog(d);
  };
  const dialogReady = (d: Dialog) => (d.minLen ?? 0) <= dialogText.trim().length && (!d.refLabel || dialogRef.trim().length >= 6);
  const runDialog = async () => {
    if (!dialog || dialogBusy || !dialogReady(dialog)) return;
    setDialogBusy(true);
    try {
      await dialog.run(dialogText.trim(), dialogRef.trim());
      setDialog(null);
    } finally {
      setDialogBusy(false);
    }
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      say(true, `${what} copied.`);
    } catch {
      say(false, "Could not copy - select the text and copy it by hand.");
    }
  };

  const exportCsv = () => {
    const head = ["Requested", "Name", "Email", "Phone", "Amount INR", "Status", "Method", "UPI / account", "IFSC", "Account holder", "Sanctioned", "Paid", "UTR / reference", "Note"];
    const rows = withdrawals.map((w) => [
      w.createdAt, w.user.fullName, w.user.email, w.user.phone ?? "", w.amountInr, WD_LABEL[w.status], w.payoutMethodType === "UPI" ? "UPI" : "Bank",
      w.payoutMethodType === "UPI" ? w.upiId ?? "" : w.bankAccountNo ?? "", w.bankIfsc ?? "", w.bankAccountName ?? "", w.approvedAt ?? "", w.paidAt ?? "", w.paymentRef ?? "", w.adminNote ?? "",
    ]);
    const csv = [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `withdrawals-${wdFilter || "all"}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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
            {wdStats && (
              <>
                <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Withdrawal numbers">
                  <Card
                    label="Waiting for you"
                    value={inr(wdStats.awaiting.amountInr)}
                    sub={`${wdStats.awaiting.count} request${wdStats.awaiting.count === 1 ? "" : "s"}${wdStats.oldestAwaitingHours !== null ? ` · oldest ${wdStats.oldestAwaitingHours < 1 ? "under 1 h" : `${wdStats.oldestAwaitingHours} h`}` : ""}`}
                    tone={wdStats.awaiting.count ? "text-warning" : ""}
                  />
                  <Card
                    label="Sanctioned - still to pay"
                    value={inr(wdStats.toPay.amountInr)}
                    sub={`${wdStats.sanctioned.count} not sent · ${wdStats.processing.count} sending`}
                    tone={wdStats.toPay.count ? "text-primary" : ""}
                  />
                  <Card
                    label="Paid"
                    value={inr(wdStats.paid.amountInr)}
                    sub={`${wdStats.paid.count} paid · today ${inr(wdStats.paidToday.amountInr)} · 30 days ${inr(wdStats.paidLast30Days.amountInr)}`}
                    tone="text-success"
                  />
                  <Card
                    label="Sanctioned in total"
                    value={inr(wdStats.sanctionedTotal.amountInr)}
                    sub={`${wdStats.sanctionedTotal.count} sanctioned · ${inr(wdStats.rejected.amountInr)} returned (${wdStats.rejected.count})`}
                  />
                </section>
                <p className="mt-2 text-xs text-muted-foreground">
                  Payout mode:{" "}
                  <b>{wdStats.payoutMode === "CASHFREE" ? "Cashfree (automatic transfer)" : "Manual - you pay from your UPI / bank app and record the UTR"}</b>
                </p>
                {wdStats.mismatch && (
                  <p role="alert" className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                    Check the books: wallets say {inr(wdStats.mismatch.walletTotalInr)} was paid out, but the paid requests add up to {inr(wdStats.mismatch.paidRowsInr)}
                    {" "}(difference {inr(wdStats.mismatch.differenceInr)}).
                  </p>
                )}
              </>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {(
                [
                  ["REQUESTED", wdStats?.awaiting.count],
                  ["APPROVED", wdStats?.sanctioned.count],
                  ["PROCESSING", wdStats?.processing.count],
                  ["PAID", wdStats?.paid.count],
                  ["REJECTED", undefined],
                  ["FAILED", undefined],
                  ["", undefined],
                ] as [string, number | undefined][]
              ).map(([s, n]) => (
                <button
                  key={s || "ALL"}
                  onClick={() => setWdFilter(s)}
                  aria-pressed={wdFilter === s}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${wdFilter === s ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}
                >
                  {s ? WD_LABEL[s] : "All"}
                  {n ? ` (${n})` : ""}
                </button>
              ))}
              <input
                value={wdSearch}
                onChange={(e) => setWdSearch(e.target.value)}
                placeholder="Search name, email, UPI, UTR…"
                aria-label="Search withdrawals"
                className={`${field} ml-auto max-w-[240px]`}
              />
              <button className="btn btn-outline btn-sm" disabled={withdrawals.length === 0} onClick={exportCsv}>
                Download CSV
              </button>
            </div>

            {loading ? (
              <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
            ) : withdrawals.length === 0 ? (
              <p className="mt-6 text-sm text-muted-foreground">No withdrawal requests here.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {withdrawals.map((w) => {
                  const dest = w.payoutMethodType === "UPI" ? w.upiId ?? "" : w.bankAccountNo ?? "";
                  const busy = busyId === w.id;
                  const cashfree = wdStats?.payoutMode === "CASHFREE";
                  const markPaid = (title: string) =>
                    ask({
                      title,
                      body: `Confirm you have already sent ${inr(w.amountInr)} to ${w.payoutMethodType === "UPI" ? w.upiId : `${w.bankAccountName} (${w.bankAccountNo})`}. Enter the UTR / transaction reference from your payment app - the student sees it.`,
                      refLabel: "UTR / transaction reference",
                      ask: "Note (optional, the student sees it)",
                      minLen: 0,
                      confirmLabel: "Yes, it is paid",
                      run: (note, ref) => call(w.id, `/admin/withdrawals/${w.id}/mark-paid`, { reference: ref, ...(note ? { note } : {}) }, () => "Marked as paid."),
                    });
                  return (
                    <div key={w.id} className="card p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold">
                            <a href={`/admin/referrals/${w.user.id}`} className="hover:underline">{w.user.fullName}</a>{" "}
                            <span className="font-normal text-muted-foreground">({w.user.email}{w.user.phone ? ` · ${w.user.phone}` : ""})</span>
                          </p>
                          <p className="mt-1 text-2xl font-bold text-primary">{inr(w.amountInr)}</p>
                          <p className="mt-1 break-all text-sm">
                            {w.payoutMethodType === "UPI" ? (
                              <>UPI: <b>{w.upiId}</b></>
                            ) : (
                              <>Bank: <b>{w.bankAccountName}</b> · {w.bankAccountNo} · {w.bankIfsc}</>
                            )}{" "}
                            {dest && (
                              <button className="ml-1 text-xs font-medium text-primary underline" onClick={() => void copy(dest, w.payoutMethodType === "UPI" ? "UPI ID" : "Account number")}>
                                Copy
                              </button>
                            )}
                            {w.payoutMethodType === "BANK_ACCOUNT" && w.bankIfsc && (
                              <button className="ml-2 text-xs font-medium text-primary underline" onClick={() => void copy(w.bankIfsc ?? "", "IFSC")}>
                                Copy IFSC
                              </button>
                            )}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Requested {fmtDT(w.createdAt)}
                            {w.approvedAt ? ` → Sanctioned ${fmtDT(w.approvedAt)}` : ""}
                            {w.paidAt ? ` → Paid ${fmtDT(w.paidAt)}` : ""}
                            {w.rejectedAt ? ` → ${w.status === "FAILED" ? "Failed" : "Rejected"} ${fmtDT(w.rejectedAt)}` : ""}
                          </p>
                          {w.paymentRef && <p className="mt-1 text-xs">UTR / reference: <b className="font-mono">{w.paymentRef}</b></p>}
                          {w.cashfreeTransferId && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Cashfree transfer {w.cashfreeTransferId}{w.gatewayStatus ? ` · ${w.gatewayStatus}` : ""}
                            </p>
                          )}
                          {w.adminNote && <p className="mt-1 text-xs italic text-muted-foreground">Note: {w.adminNote}</p>}
                          {w.flaggedFriends > 0 && (
                            <p className="mt-1 text-xs font-medium text-warning">
                              ⚑ {w.flaggedFriends} of this student&apos;s friends {w.flaggedFriends === 1 ? "is" : "are"} flagged (same device etc.) -{" "}
                              <a href={`/admin/referrals/${w.user.id}`} className="underline">check before paying</a>
                            </p>
                          )}
                        </div>
                        <span className={WD_BADGE[w.status]}>{WD_LABEL[w.status]}</span>
                      </div>

                      {w.status === "REQUESTED" && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            disabled={busy}
                            className="btn btn-primary btn-sm"
                            onClick={() => call(w.id, `/admin/withdrawals/${w.id}/approve`, undefined, (d) => d.message || "Sanctioned.")}
                          >
                            {busy ? "Working…" : "Approve (sanction)"}
                          </button>
                          <button
                            disabled={busy}
                            className="btn btn-outline btn-sm text-danger"
                            onClick={() =>
                              ask({
                                title: `Reject ${inr(w.amountInr)} for ${w.user.fullName}?`,
                                body: "The amount goes back to the student's withdrawable balance. Tell them why:",
                                ask: "Reason (shown to the student)",
                                confirmLabel: "Reject request",
                                danger: true,
                                minLen: 3,
                                run: (reason) => call(w.id, `/admin/withdrawals/${w.id}/reject`, { reason }, () => "Rejected - the amount is back in the student's wallet."),
                              })
                            }
                          >
                            Reject
                          </button>
                        </div>
                      )}

                      {w.status === "APPROVED" && (
                        <div className="mt-3">
                          <p className="mb-2 text-xs text-muted-foreground">
                            Sanctioned. {cashfree ? "Send it through Cashfree, or pay it yourself and record the UTR." : "Pay it from your UPI / bank app, then record the UTR."}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {cashfree && (
                              <button
                                disabled={busy}
                                className="btn btn-primary btn-sm"
                                onClick={() =>
                                  ask({
                                    title: `Send ${inr(w.amountInr)} through Cashfree?`,
                                    body: `${inr(w.amountInr)} will be transferred to ${w.payoutMethodType === "UPI" ? w.upiId : w.bankAccountName} right away. It can only be sent once.`,
                                    confirmLabel: "Send now",
                                    run: () => call(w.id, `/admin/withdrawals/${w.id}/pay`, undefined, (d) => d.message || "Sent to Cashfree."),
                                  })
                                }
                              >
                                Send via Cashfree
                              </button>
                            )}
                            <button disabled={busy} className={`btn btn-sm ${cashfree ? "btn-outline" : "btn-primary"}`} onClick={() => markPaid("Mark as paid?")}>
                              Mark as paid (enter UTR)
                            </button>
                            <button
                              disabled={busy}
                              className="btn btn-outline btn-sm text-danger"
                              onClick={() =>
                                ask({
                                  title: `Take back the sanction and reject ${inr(w.amountInr)}?`,
                                  body: "Nothing has been paid. The amount goes back to the student's withdrawable balance. Tell them why:",
                                  ask: "Reason (shown to the student)",
                                  confirmLabel: "Reject request",
                                  danger: true,
                                  minLen: 3,
                                  run: (reason) => call(w.id, `/admin/withdrawals/${w.id}/reject`, { reason }, () => "Rejected - the amount is back in the student's wallet."),
                                })
                              }
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      )}

                      {w.status === "PROCESSING" && (
                        <div className="mt-3">
                          <p className="mb-2 text-xs font-medium text-warning">
                            The money is on its way through Cashfree. Do not pay this again by hand unless the Cashfree dashboard shows it failed.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              disabled={busy}
                              className="btn btn-primary btn-sm"
                              onClick={() => call(w.id, `/admin/withdrawals/${w.id}/check-status`, undefined, (d) => d.message || "Checked.")}
                            >
                              {busy ? "Checking…" : "Check status"}
                            </button>
                            <button disabled={busy} className="btn btn-outline btn-sm" onClick={() => markPaid("Cashfree shows it as paid?")}>
                              Mark as paid (enter UTR)
                            </button>
                            <button
                              disabled={busy}
                              className="btn btn-outline btn-sm text-danger"
                              onClick={() =>
                                ask({
                                  title: `Mark ${inr(w.amountInr)} as failed?`,
                                  body: "Only do this when the Cashfree dashboard shows this transfer as failed or reversed. The amount goes back to the student's wallet.",
                                  ask: "What the dashboard shows (kept in the record)",
                                  confirmLabel: "Mark failed and refund",
                                  danger: true,
                                  minLen: 3,
                                  run: (reason) => call(w.id, `/admin/withdrawals/${w.id}/mark-failed`, { reason }, () => "Marked as failed - the amount is back in the student's wallet."),
                                })
                              }
                            >
                              Mark failed
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
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
            {dialog.refLabel && (
              <>
                <label htmlFor="dlg-ref" className="mb-1 mt-4 block text-sm font-medium">{dialog.refLabel}</label>
                <input
                  id="dlg-ref"
                  autoFocus
                  value={dialogRef}
                  onChange={(e) => setDialogRef(e.target.value.replace(/\s/g, ""))}
                  maxLength={40}
                  autoComplete="off"
                  placeholder="e.g. 412345678901"
                  className={`${field} font-mono`}
                />
                <p className="mt-1 text-xs text-muted-foreground">At least 6 characters. The same UTR cannot be used on two withdrawals.</p>
              </>
            )}
            {dialog.ask && (
              <>
                <label htmlFor="dlg-text" className="mb-1 mt-4 block text-sm font-medium">{dialog.ask}</label>
                <textarea id="dlg-text" autoFocus={!dialog.refLabel} rows={3} value={dialogText} onChange={(e) => setDialogText(e.target.value)} className={field} />
              </>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-outline" onClick={() => setDialog(null)} disabled={dialogBusy}>Cancel</button>
              <button
                className={`btn ${dialog.danger ? "bg-danger text-danger-foreground" : "btn-primary"}`}
                disabled={dialogBusy || !dialogReady(dialog)}
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
