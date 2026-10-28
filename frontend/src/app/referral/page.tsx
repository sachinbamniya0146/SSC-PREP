"use client";

import * as React from "react";
import Link from "next/link";
import { API_BASE, fetchAuth } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { AppShell, PageHeading, ErrorNote, CardSkeletons, EmptyState } from "@/components/AppShell";

type Rules = {
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

type Me = {
  enabled: boolean;
  referralCode: string;
  shareLink: string;
  referredBy: string | null;
  rules: Rules;
  stats: {
    totalReferrals: number;
    paidReferrals: number;
    totalPurchases: number;
    currentCommissionPct: number;
    friendsToNextTier: number | null;
    freeMonthClaimed: boolean;
    milestones: { key: string; label: string; at: number; done: boolean; progressPercent: number }[];
  };
  wallet: {
    balanceInr: number;
    pendingInr: number;
    totalEarnedInr: number;
    totalWithdrawnInr: number;
    isSuspended: boolean;
    suspendedReason: string | null;
    canWithdraw: boolean;
    withdrawBlockReason: string | null;
    hasPayoutMethod: boolean;
    nextRelease: { at: string; amountInr: number } | null;
  };
  referrals: { id: string; name: string; joinedAt: string; purchases: number; status: "PENDING" | "PAIDED" | "REWARDED" }[];
};

type Earning = {
  id: string;
  name: string;
  purchaseAmountInr: number;
  commissionPct: number;
  commissionInr: number;
  status: "PENDING" | "AVAILABLE" | "REVERSED";
  availableAt: string | null;
  underReview: boolean;
  reversalNote: string | null;
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
  bankAccountNo: string | null;
  bankIfsc: string | null;
  bankAccountName: string | null;
} | null;

const inr = (n: number) =>
  `₹${(Math.round(n * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: Math.round(n * 100) % 100 ? 2 : 0 })}`;
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");
const daysUntil = (d: string) => Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000));

const WD_BADGE: Record<Withdrawal["status"], { cls: string; label: string }> = {
  REQUESTED: { cls: "badge badge-warning", label: "Requested" },
  APPROVED: { cls: "badge badge-info", label: "Approved" },
  PROCESSING: { cls: "badge badge-info", label: "Sending" },
  PAID: { cls: "badge badge-success", label: "Paid" },
  REJECTED: { cls: "badge badge-danger", label: "Rejected" },
  FAILED: { cls: "badge badge-danger", label: "Failed" },
};

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "success" | "warning" | "primary" }) {
  const color = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "primary" ? "text-primary" : "";
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Bar({ pct, tone = "primary" }: { pct: number; tone?: "primary" | "success" }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-all duration-500 ${tone === "success" ? "bg-success" : "bg-primary"}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

export default function ReferralPage() {
  const tr = useT();
  const [me, setMe] = React.useState<Me | null>(null);
  const [earnings, setEarnings] = React.useState<Earning[]>([]);
  const [withdrawals, setWithdrawals] = React.useState<Withdrawal[]>([]);
  const [payout, setPayout] = React.useState<PayoutMethod>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [tab, setTab] = React.useState<"friends" | "earnings" | "withdraw">("friends");
  const [toast, setToast] = React.useState<{ ok: boolean; text: string } | null>(null);
  const toastTimer = React.useRef<number | undefined>(undefined);

  // "I have a friend's code"
  const [applyCode, setApplyCode] = React.useState("");
  const [applying, setApplying] = React.useState(false);

  // payout method
  const [pmType, setPmType] = React.useState<"UPI" | "BANK_ACCOUNT">("UPI");
  const [upiId, setUpiId] = React.useState("");
  const [bankAccountNo, setBankAccountNo] = React.useState("");
  const [bankIfsc, setBankIfsc] = React.useState("");
  const [bankAccountName, setBankAccountName] = React.useState("");
  const [editingMethod, setEditingMethod] = React.useState(false);
  const [savingMethod, setSavingMethod] = React.useState(false);

  // withdraw
  const [amount, setAmount] = React.useState("");
  const [withdrawing, setWithdrawing] = React.useState(false);
  const [cancelId, setCancelId] = React.useState<string | null>(null);

  const say = React.useCallback((ok: boolean, text: string) => {
    setToast({ ok, text });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4500);
  }, []);
  React.useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const load = React.useCallback(async () => {
    try {
      const [meRes, earnRes, wdRes, pmRes] = await Promise.all([
        fetchAuth(`${API_BASE}/referral/me`),
        fetchAuth(`${API_BASE}/referral/earnings`),
        fetchAuth(`${API_BASE}/referral/withdrawals`),
        fetchAuth(`${API_BASE}/referral/payout-method`),
      ]);
      if (!meRes.ok) throw new Error("load");
      setMe(await meRes.json());
      if (earnRes.ok) setEarnings(await earnRes.json());
      if (wdRes.ok) setWithdrawals(await wdRes.json());
      if (pmRes.ok) {
        const pm: PayoutMethod = await pmRes.json();
        setPayout(pm);
        if (pm) {
          setPmType(pm.type);
          setUpiId(pm.upiId || "");
          setBankIfsc(pm.bankIfsc || "");
          setBankAccountName(pm.bankAccountName || "");
        }
      }
      setLoadError("");
    } catch {
      setLoadError(tr("Could not load your referral details. Please try again.", "Referral details load nahi hui. Dobara try karein."));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const shareText = me
    ? tr(
        `Prepare for SSC with SSCPrepHub — mock tests, PYQs and vocabulary in one place. Join with my link${me.rules.refereeDiscountPct > 0 ? ` and get ${me.rules.refereeDiscountPct}% off your first plan` : ""}: ${me.shareLink}`,
        `SSCPrepHub se SSC ki taiyari karo — mock tests, PYQ aur vocabulary ek jagah. Mere link se join karo${me.rules.refereeDiscountPct > 0 ? ` aur pehle plan par ${me.rules.refereeDiscountPct}% off pao` : ""}: ${me.shareLink}`,
      )
    : "";

  const copy = async (text: string, okMsg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      say(true, okMsg);
    } catch {
      say(false, tr("Could not copy — please select and copy it manually.", "Copy nahi hua — kripya manually copy karein."));
    }
  };

  const nativeShare = async () => {
    if (!me) return;
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: "SSCPrepHub", text: shareText.replace(me.shareLink, "").trim(), url: me.shareLink });
        return;
      } catch (e: any) {
        if (e?.name === "AbortError") return;
      }
    }
    void copy(shareText, tr("Invite message copied", "Invite message copy ho gaya"));
  };

  const applyFriendCode = async () => {
    const c = applyCode.trim();
    if (!c || applying) return;
    setApplying(true);
    try {
      const res = await fetchAuth(`${API_BASE}/referral/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) say(false, d?.message || tr("Could not apply this code.", "Ye code apply nahi hua."));
      else {
        say(!!d.applied, d.message || (d.applied ? "Code applied." : "Code not applied."));
        if (d.applied) {
          setApplyCode("");
          await load();
        }
      }
    } catch {
      say(false, tr("Network error — please try again.", "Network error — dobara try karein."));
    } finally {
      setApplying(false);
    }
  };

  const saveMethod = async () => {
    setSavingMethod(true);
    try {
      const body = pmType === "UPI" ? { type: "UPI", upiId: upiId.trim() } : { type: "BANK_ACCOUNT", bankAccountNo: bankAccountNo.trim(), bankIfsc: bankIfsc.trim().toUpperCase(), bankAccountName: bankAccountName.trim() };
      const res = await fetchAuth(`${API_BASE}/referral/payout-method`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.message || "Could not save payout details");
      say(true, tr("Payout details saved", "Payout details save ho gayi"));
      setEditingMethod(false);
      setBankAccountNo("");
      await load();
    } catch (e) {
      say(false, (e as Error).message);
    } finally {
      setSavingMethod(false);
    }
  };

  const withdraw = async () => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return say(false, tr("Enter a valid amount.", "Sahi amount daalein."));
    setWithdrawing(true);
    try {
      const res = await fetchAuth(`${API_BASE}/referral/withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountInr: amt }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.message || "Withdrawal request failed");
      say(true, tr("Withdrawal requested. We will review it and send the money to your account.", "Withdrawal request ho gayi. Hum review karke paisa bhej denge."));
      setAmount("");
      await load();
    } catch (e) {
      say(false, (e as Error).message);
    } finally {
      setWithdrawing(false);
    }
  };

  const cancelWithdrawal = async (id: string) => {
    try {
      const res = await fetchAuth(`${API_BASE}/referral/withdrawals/${id}/cancel`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.message || "Could not cancel");
      say(true, tr("Request cancelled. The amount is back in your wallet.", "Request cancel ho gayi. Paisa wallet me wapas aa gaya."));
      await load();
    } catch (e) {
      say(false, (e as Error).message);
    } finally {
      setCancelId(null);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

  if (loading) {
    return (
      <AppShell width="lg">
        <PageHeading title={tr("Refer & Earn", "Refer & Earn")} />
        <CardSkeletons count={3} />
      </AppShell>
    );
  }

  if (!me) {
    return (
      <AppShell width="lg">
        <PageHeading title={tr("Refer & Earn", "Refer & Earn")} />
        <ErrorNote onRetry={() => void load()}>{loadError || "Something went wrong."}</ErrorNote>
      </AppShell>
    );
  }

  const { rules, stats, wallet } = me;
  const hasFriendOffer = rules.refereeDiscountPct > 0;
  const openWithdrawal = withdrawals.find((w) => ["REQUESTED", "APPROVED", "PROCESSING"].includes(w.status));
  const maxWithdraw = Math.max(0, wallet.balanceInr);

  return (
    <AppShell width="lg">
      <PageHeading
        title={tr("Refer & Earn", "Refer & Earn")}
        subtitle={tr(
          "Your friends save on their first plan, and you earn real cash every time they buy.",
          "Dost ko pehle plan par bachat, aapko har purchase par real cash.",
        )}
        actions={
          <Link href="/terms#referral" className="btn btn-outline btn-sm">
            {tr("Programme rules", "Programme rules")}
          </Link>
        }
      />

      {!me.enabled && (
        <div className="mb-5 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <b className="text-warning">{tr("The referral programme is paused.", "Referral programme abhi paused hai.")}</b>{" "}
          {tr("New invites earn nothing for now. Money already in your wallet stays yours and can still be withdrawn.", "Naye invites par abhi kuch nahi milega. Wallet ka paisa aapka hi hai, withdraw ho sakta hai.")}
        </div>
      )}
      {wallet.isSuspended && (
        <div className="mb-5 rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
          {tr("Your referral earnings are paused by admin", "Aapki referral earnings admin ne pause ki hain")}
          {wallet.suspendedReason ? `: ${wallet.suspendedReason}` : "."}
        </div>
      )}

      {/* Hero — code + share */}
      <section className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-accent/10 p-5 sm:p-7">
        <div className="grid gap-6 md:grid-cols-[1.3fr_1fr] md:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">{tr("Your invite code", "Aapka invite code")}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="select-all rounded-xl border-2 border-dashed border-primary/40 bg-background px-4 py-2 font-mono text-2xl font-extrabold tracking-[0.2em] text-primary">
                {me.referralCode}
              </span>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => copy(me.referralCode, tr("Code copied", "Code copy ho gaya"))}>
                {tr("Copy code", "Code copy")}
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                className="btn btn-primary"
                href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {tr("Share on WhatsApp", "WhatsApp par share")}
              </a>
              <button type="button" className="btn btn-outline" onClick={nativeShare}>
                {tr("Share…", "Share…")}
              </button>
              <button type="button" className="btn btn-outline" onClick={() => copy(me.shareLink, tr("Invite link copied", "Invite link copy ho gaya"))}>
                {tr("Copy link", "Link copy")}
              </button>
            </div>
            <p className="mt-3 break-all text-xs text-muted-foreground">{me.shareLink}</p>
          </div>

          <ol className="space-y-3 text-sm">
            {[
              [tr("Share your link", "Link share karein"), hasFriendOffer ? tr(`Your friend gets ${rules.refereeDiscountPct}% off their first plan (up to ${inr(rules.refereeDiscountMaxInr)}).`, `Dost ko pehle plan par ${rules.refereeDiscountPct}% off (max ${inr(rules.refereeDiscountMaxInr)}).`) : tr("Your friend signs up with your code.", "Dost aapke code se signup karta hai.")],
              [tr("Friend buys a plan", "Dost plan kharidta hai"), tr(`You earn ${rules.lowTierPct}% of what they pay${rules.highTierPct > rules.lowTierPct ? `, ${rules.highTierPct}% from your ${rules.highTierAfter}th paying friend` : ""}.`, `Aap unke payment ka ${rules.lowTierPct}% kamate hain${rules.highTierPct > rules.lowTierPct ? `, ${rules.highTierAfter}th paying dost se ${rules.highTierPct}%` : ""}.`)],
              [tr("Withdraw to UPI / bank", "UPI / bank me withdraw karein"), tr(`Commission becomes withdrawable ${rules.holdDays > 0 ? `${rules.holdDays} days after the purchase` : "immediately"}.`, `Commission ${rules.holdDays > 0 ? `purchase ke ${rules.holdDays} din baad` : "turant"} withdraw ke liye ready hota hai.`)],
            ].map(([t, d], i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
                <span>
                  <b>{t}</b>
                  <br />
                  <span className="text-muted-foreground">{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Wallet */}
      <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={tr("Withdrawable", "Withdrawable")} value={inr(wallet.balanceInr)} tone="success" hint={wallet.balanceInr < 0 ? tr("Adjusted after a refund", "Refund ke baad adjust hua") : undefined} />
        <Stat
          label={tr("Pending", "Pending")}
          value={inr(wallet.pendingInr)}
          tone="warning"
          hint={wallet.nextRelease ? tr(`${inr(wallet.nextRelease.amountInr)} unlocks in ${daysUntil(wallet.nextRelease.at)}d`, `${inr(wallet.nextRelease.amountInr)} ${daysUntil(wallet.nextRelease.at)} din me unlock`) : undefined}
        />
        <Stat label={tr("Total earned", "Total kamaya")} value={inr(wallet.totalEarnedInr)} />
        <Stat label={tr("Paid out", "Payout hua")} value={inr(wallet.totalWithdrawnInr)} />
      </section>

      {/* Progress */}
      <section className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">{tr("Your commission rate", "Aapka commission rate")}</h2>
            <span className="text-2xl font-extrabold text-primary">{stats.currentCommissionPct}%</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {stats.friendsToNextTier != null
              ? tr(`${stats.friendsToNextTier} more paying ${stats.friendsToNextTier === 1 ? "friend" : "friends"} and it rises to ${rules.highTierPct}%.`, `${stats.friendsToNextTier} aur paying dost aur rate ${rules.highTierPct}% ho jayega.`)
              : tr("You are on the top rate. 🎉", "Aap top rate par hain. 🎉")}
          </p>
          <div className="mt-3">
            <Bar pct={rules.highTierAfter > 0 ? (stats.paidReferrals / rules.highTierAfter) * 100 : 100} tone="success" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {stats.totalReferrals} {tr("joined", "joined")} · {stats.paidReferrals} {tr("bought a plan", "ne plan kharida")}
          </p>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold">{tr("Milestone rewards", "Milestone rewards")}</h2>
          <div className="mt-3 space-y-3">
            {stats.milestones.map((m) => (
              <div key={m.key}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className={m.done ? "font-semibold text-success" : ""}>{m.done ? "✓ " : ""}{m.label}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {Math.min(stats.paidReferrals, m.at)}/{m.at}
                  </span>
                </div>
                <Bar pct={m.progressPercent} tone={m.done ? "success" : "primary"} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Have a friend's code */}
      {!me.referredBy && (
        <section className="card mt-5 p-5">
          <h2 className="font-semibold">{tr("Did a friend invite you?", "Kisi dost ne invite kiya?")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {tr("Add their code before your first purchase", "Pehli purchase se pehle unka code daalein")}
            {hasFriendOffer ? tr(` and get ${rules.refereeDiscountPct}% off your first plan.`, ` aur pehle plan par ${rules.refereeDiscountPct}% off pao.`) : "."}
          </p>
          <div className="mt-3 flex gap-2">
            <input
              className={`${inputCls} max-w-xs font-mono uppercase tracking-widest`}
              value={applyCode}
              onChange={(e) => setApplyCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && void applyFriendCode()}
              placeholder="FRIEND CODE"
              maxLength={20}
              aria-label={tr("Friend's referral code", "Dost ka referral code")}
            />
            <button className="btn btn-primary" onClick={() => void applyFriendCode()} disabled={!applyCode.trim() || applying}>
              {applying ? "…" : tr("Apply", "Lagayein")}
            </button>
          </div>
        </section>
      )}
      {me.referredBy && (
        <p className="mt-5 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm">
          ✓ {tr("You joined with code", "Aap is code se join hue")} <b className="font-mono">{me.referredBy}</b>.
          {hasFriendOffer ? ` ${tr(`Your ${rules.refereeDiscountPct}% welcome discount is applied automatically on your first plan.`, `Pehle plan par ${rules.refereeDiscountPct}% welcome discount apne aap lagega.`)}` : ""}
        </p>
      )}

      {/* Tabs */}
      <div className="mt-8 flex gap-1 overflow-x-auto border-b border-border" role="tablist">
        {(
          [
            ["friends", tr("Friends", "Dost"), me.referrals.length],
            ["earnings", tr("Earnings", "Kamai"), earnings.length],
            ["withdraw", tr("Withdraw", "Withdraw"), withdrawals.length],
          ] as const
        ).map(([k, label, n]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${tab === k ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {label} <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{n}</span>
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === "friends" &&
          (me.referrals.length === 0 ? (
            <EmptyState icon="🤝" title={tr("No friends yet", "Abhi koi dost nahi")} body={tr("Share your link — they will show up here the moment they sign up.", "Link share karein — signup karte hi yahan dikhenge.")} />
          ) : (
            <ul className="card divide-y divide-border">
              {me.referrals.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{tr("Joined", "Join kiya")} {fmtDate(r.joinedAt)}</p>
                  </div>
                  <span className={`badge ${r.status === "PENDING" ? "badge-warning" : "badge-success"}`}>
                    {r.status === "PENDING" ? tr("Signed up", "Signup hua") : tr(`Bought a plan${r.purchases > 1 ? ` ×${r.purchases}` : ""}`, `Plan kharida${r.purchases > 1 ? ` ×${r.purchases}` : ""}`)}
                  </span>
                </li>
              ))}
            </ul>
          ))}

        {tab === "earnings" &&
          (earnings.length === 0 ? (
            <EmptyState icon="💰" title={tr("No earnings yet", "Abhi koi kamai nahi")} body={tr("You earn when a friend buys a plan. It shows up here as Pending first.", "Dost plan kharide to kamai yahan pehle Pending dikhti hai.")} />
          ) : (
            <ul className="card divide-y divide-border">
              {earnings.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{e.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDate(e.createdAt)} · {e.commissionPct}% of {inr(e.purchaseAmountInr)}
                      {e.status === "PENDING" && !e.underReview && e.availableAt ? ` · ${tr("unlocks", "unlock")} ${fmtDate(e.availableAt)}` : ""}
                      {e.status === "PENDING" && e.underReview ? ` · ${tr("under review", "review me")}` : ""}
                      {e.status === "REVERSED" && e.reversalNote ? ` · ${e.reversalNote}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`font-bold tabular-nums ${e.status === "REVERSED" ? "text-muted-foreground line-through" : "text-success"}`}>+{inr(e.commissionInr)}</p>
                    <span className={`badge ${e.status === "AVAILABLE" ? "badge-success" : e.status === "PENDING" ? "badge-warning" : "badge-danger"}`}>
                      {e.status === "AVAILABLE" ? tr("Withdrawable", "Withdrawable") : e.status === "PENDING" ? tr("Pending", "Pending") : tr("Reversed", "Reverse")}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ))}

        {tab === "withdraw" && (
          <div className="space-y-4">
            {/* payout method */}
            <div className="card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{tr("Where should we send your money?", "Paisa kahan bhejein?")}</h3>
                {payout && !editingMethod && (
                  <button className="btn btn-outline btn-sm" onClick={() => setEditingMethod(true)}>
                    {tr("Change", "Badlein")}
                  </button>
                )}
              </div>
              {payout && !editingMethod ? (
                <p className="mt-2 text-sm">
                  {payout.type === "UPI" ? (
                    <>UPI · <b>{payout.upiId}</b></>
                  ) : (
                    <>
                      Bank · <b>{payout.bankAccountName}</b> · {payout.bankAccountNo} · {payout.bankIfsc}
                    </>
                  )}
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  <div className="inline-flex rounded-lg border border-border p-0.5 text-sm">
                    {(["UPI", "BANK_ACCOUNT"] as const).map((t) => (
                      <button key={t} type="button" onClick={() => setPmType(t)} className={`rounded-md px-3 py-1.5 font-medium ${pmType === t ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                        {t === "UPI" ? "UPI" : tr("Bank account", "Bank account")}
                      </button>
                    ))}
                  </div>
                  {pmType === "UPI" ? (
                    <input className={inputCls} value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="yourname@okhdfcbank" autoCapitalize="none" aria-label="UPI ID" />
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input className={inputCls} value={bankAccountName} onChange={(e) => setBankAccountName(e.target.value)} placeholder={tr("Account holder name (as per bank)", "Account holder ka naam (bank ke hisaab se)")} />
                      <input className={inputCls} value={bankAccountNo} onChange={(e) => setBankAccountNo(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder={tr("Account number", "Account number")} />
                      <input className={`${inputCls} uppercase`} value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value.toUpperCase())} placeholder="IFSC (e.g. HDFC0000001)" maxLength={11} />
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button className="btn btn-primary" onClick={() => void saveMethod()} disabled={savingMethod}>
                      {savingMethod ? "…" : tr("Save details", "Details save karein")}
                    </button>
                    {editingMethod && (
                      <button className="btn btn-outline" onClick={() => setEditingMethod(false)}>
                        {tr("Cancel", "Cancel")}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* request */}
            <div className="card p-5">
              <h3 className="font-semibold">{tr("Request a withdrawal", "Withdrawal request karein")}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {tr(
                  `Minimum ${inr(rules.minWithdrawInr)}. Opens after ${rules.minPaidReferralsToWithdraw} friends have bought a plan. Only released commission (“Withdrawable”) can be withdrawn.`,
                  `Minimum ${inr(rules.minWithdrawInr)}. ${rules.minPaidReferralsToWithdraw} dost ke plan kharidne ke baad khulta hai. Sirf “Withdrawable” commission nikal sakte hain.`,
                )}
              </p>
              {!wallet.canWithdraw && wallet.withdrawBlockReason && (
                <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm">{wallet.withdrawBlockReason}</p>
              )}
              {wallet.canWithdraw && !wallet.hasPayoutMethod && (
                <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">{tr("Save your UPI / bank details above first.", "Pehle upar UPI / bank details save karein.")}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  className={`${inputCls} max-w-[200px]`}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                  inputMode="decimal"
                  placeholder={`Up to ${inr(maxWithdraw)}`}
                  disabled={!wallet.canWithdraw}
                  aria-label={tr("Amount", "Amount")}
                />
                <button className="btn btn-outline" type="button" disabled={!wallet.canWithdraw} onClick={() => setAmount(String(Math.floor(maxWithdraw * 100) / 100))}>
                  {tr("Max", "Max")}
                </button>
                <button className="btn btn-primary" onClick={() => void withdraw()} disabled={!wallet.canWithdraw || !wallet.hasPayoutMethod || withdrawing || !amount}>
                  {withdrawing ? "…" : tr("Withdraw", "Withdraw")}
                </button>
              </div>
            </div>

            {/* history */}
            {withdrawals.length > 0 && (
              <ul className="card divide-y divide-border">
                {withdrawals.map((w) => (
                  <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="font-bold tabular-nums">{inr(w.amountInr)}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmtDate(w.createdAt)} · {w.payoutMethodType === "UPI" ? "UPI" : "Bank"}
                        {w.adminNote ? ` · ${w.adminNote}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={WD_BADGE[w.status].cls}>{WD_BADGE[w.status].label}</span>
                      {w.status === "REQUESTED" &&
                        (cancelId === w.id ? (
                          <>
                            <button className="btn btn-sm btn-outline" onClick={() => void cancelWithdrawal(w.id)}>{tr("Yes, cancel", "Haan, cancel")}</button>
                            <button className="btn btn-sm btn-ghost" onClick={() => setCancelId(null)}>{tr("No", "Nahi")}</button>
                          </>
                        ) : (
                          <button className="btn btn-sm btn-outline" onClick={() => setCancelId(w.id)}>{tr("Cancel", "Cancel")}</button>
                        ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {openWithdrawal && <p className="text-xs text-muted-foreground">{tr("One withdrawal at a time. You can request again once this one is finished.", "Ek time par ek hi withdrawal. Ye khatam hone ke baad dobara request kar sakte hain.")}</p>}
          </div>
        )}
      </div>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        {tr("Commission is calculated on the amount your friend actually pays for a plan. If a purchase is refunded, its commission is taken back. Self-referrals and fake accounts are not allowed — see the ", "Commission us amount par milta hai jo dost plan ke liye asal me pay karta hai. Refund hone par uska commission wapas ho jata hai. Self-referral aur fake accounts allowed nahi — dekhein ")}
        <Link href="/terms#referral" className="font-medium text-primary hover:underline">{tr("referral terms", "referral terms")}</Link>.
      </p>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed inset-x-4 bottom-20 z-[60] mx-auto max-w-md rounded-xl border px-4 py-3 text-sm font-medium shadow-lg sm:bottom-6 ${toast.ok ? "border-success/40 bg-card text-success" : "border-danger/40 bg-card text-danger"}`}
        >
          {toast.text}
        </div>
      )}
    </AppShell>
  );
}
