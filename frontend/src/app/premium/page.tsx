"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchAuth, API_BASE } from "@/lib/api";
import { startCashfreeCheckout } from "@/lib/vocab-pay";
import { useT } from "@/lib/i18n";
import { ShellHeader, PageHeading, CardSkeletons } from "@/components/AppShell";

type PlanPricing = {
  regularInr: number;
  salePriceInr: number;
  strikeInr: number | null;
  offerActive: boolean;
  offerPct: number | null;
  offerLabel: string | null;
  offerEndsAt: string | null;
  offerDiscountInr: number;
  savingsInr: number;
  savingsPct: number;
  perMonthInr: number;
};

type Plan = {
  id: string;
  name: string;
  durationMonths: number;
  priceInr: number;
  badge?: string | null;
  isActive: boolean;
  // computed by the server (offer, MRP, per-month); absent only for the plan object inside /payments/subscription
  pricing?: PlanPricing;
};

type Subscription = {
  active: boolean;
  admin?: boolean;
  plan?: Plan;
  startsAt?: string;
  endsAt?: string;
  daysLeft?: number;
  expiringSoon?: boolean;
  lastPlan?: Plan | null;
  lastEndedAt?: string | null;
};

type CouponValidation = {
  code: string;
  description?: string | null;
  discount: number;
  finalAmountInr: number;
};

/** The price a plan is actually sold at right now (server-computed), with a safe fallback for older API responses. */
const priceOf = (p: Plan): PlanPricing =>
  p.pricing ?? {
    regularInr: p.priceInr, salePriceInr: p.priceInr, strikeInr: null, offerActive: false, offerPct: null, offerLabel: null,
    offerEndsAt: null, offerDiscountInr: 0, savingsInr: 0, savingsPct: 0, perMonthInr: p.priceInr / Math.max(1, p.durationMonths),
  };

/** "2d 4h 10m" / "03:12:09" countdown to a deadline; calls onDone once when it passes. */
function Countdown({ endsAt, onDone }: { endsAt: string; onDone?: () => void }) {
  const end = React.useMemo(() => new Date(endsAt).getTime(), [endsAt]);
  const [now, setNow] = React.useState(() => Date.now());
  const done = React.useRef(false);
  const fast = end - now < 24 * 3_600_000; // last day: tick every second, otherwise every 30s
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), fast ? 1000 : 30_000);
    return () => window.clearInterval(id);
  }, [fast]);
  const left = Math.max(0, end - now);
  React.useEffect(() => {
    if (left <= 0 && !done.current) {
      done.current = true;
      onDone?.();
    }
  }, [left, onDone]);
  if (left <= 0) return <span>ended</span>;
  const d = Math.floor(left / 86_400_000);
  const h = Math.floor((left % 86_400_000) / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  const sec = Math.floor((left % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return <span className="tabular-nums">{d > 0 ? `${d}d ${h}h ${m}m` : `${pad(h)}:${pad(m)}:${pad(sec)}`}</span>;
}

const inr = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0 })}`;
const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";
const durationLabel = (m: number) => (m === 1 ? "1 Month" : m % 12 === 0 ? `${m / 12} Year${m / 12 > 1 ? "s" : ""}` : `${m} Months`);

function addMonthsClamped(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d;
}

export default function PremiumPage() {
  const tr = useT();
  const router = useRouter();
  const [plans, setPlans] = React.useState<Plan[]>([]);
  const [subscription, setSubscription] = React.useState<Subscription | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [selectedPlan, setSelectedPlan] = React.useState<Plan | null>(null);
  const [couponCode, setCouponCode] = React.useState("");
  const [couponResult, setCouponResult] = React.useState<CouponValidation | null>(null);
  const [couponError, setCouponError] = React.useState("");
  const [couponBusy, setCouponBusy] = React.useState(false);
  const [processing, setProcessing] = React.useState(false);
  const [error, setError] = React.useState("");

  const loadData = React.useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [plansRes, subRes] = await Promise.all([
        fetchAuth(`${API_BASE}/payments/plans`),
        fetchAuth(`${API_BASE}/payments/subscription`),
      ]);
      if (!plansRes.ok || !subRes.ok) throw new Error("load failed");
      const plansData: Plan[] = await plansRes.json();
      // server order (admin "order on the page", then duration)
      setPlans(plansData.filter((p) => p.isActive));
      setSubscription(await subRes.json());
    } catch {
      setLoadError(tr("Could not load the plans. Please refresh the page and try again.", "Plans load nahi ho paye. Page refresh karke dobara try karein."));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  // Price per month (at today's selling price) → used for the "best value" badge and per-month hint.
  const perMonth = (p: Plan) => priceOf(p).perMonthInr;
  const bestValueId = React.useMemo(() => {
    if (plans.length < 2) return null;
    return [...plans].sort((a, b) => perMonth(a) - perMonth(b))[0]?.id ?? null;
  }, [plans]);

  // quiet refresh (an offer just ended or started): prices stay correct without a manual reload
  const refreshPlans = React.useCallback(async () => {
    try {
      const r = await fetchAuth(`${API_BASE}/payments/plans`);
      if (!r.ok) return;
      const data: Plan[] = await r.json();
      const active = data.filter((p) => p.isActive);
      setPlans(active);
      setSelectedPlan((cur) => (cur ? active.find((p) => p.id === cur.id) ?? cur : cur));
      setCouponResult(null); // the amount changed — apply the coupon again on the new price
    } catch {
      /* keep what is on screen */
    }
  }, []);

  const selectPlan = (plan: Plan) => {
    // the subscription card carries a bare plan row: use the live one (with today's price) when it is still on sale
    const live = plans.find((p) => p.id === plan.id);
    if (!live) {
      setSelectedPlan(null);
      setError(tr("This plan is no longer on sale — please choose one of the plans below.", "Ye plan ab available nahi hai — neeche se koi plan chunein."));
      return;
    }
    setSelectedPlan(live);
    setCouponCode("");
    setCouponResult(null);
    setCouponError("");
    setError("");
  };

  const applyCoupon = async () => {
    if (!selectedPlan || !couponCode.trim()) {
      setCouponError(tr("Coupon code daalein", "Coupon code daalein"));
      return;
    }
    setCouponBusy(true);
    setCouponError("");
    try {
      const res = await fetchAuth(`${API_BASE}/payments/coupon/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // the server prices the plan itself (offer included) and checks plan-wise coupon rules
        body: JSON.stringify({ code: couponCode.trim(), planId: selectedPlan.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Invalid coupon");
      setCouponResult(data);
    } catch (e: any) {
      setCouponError(e.message || "Invalid coupon");
      setCouponResult(null);
    } finally {
      setCouponBusy(false);
    }
  };

  const payNow = async () => {
    if (!selectedPlan || processing) return;
    setProcessing(true);
    setError("");
    try {
      const r = await startCashfreeCheckout({ planId: selectedPlan.id, couponCode: couponResult?.code });
      if (r.free && r.orderId) {
        // 100%-off coupon: nothing to pay, plan is already active.
        router.push(`/payment/success?order_id=${encodeURIComponent(r.orderId)}`);
        return;
      }
      // Otherwise the tab is being redirected to Cashfree; keep the button locked.
    } catch (e: any) {
      setError(e?.message || "Could not start the payment");
      setProcessing(false);
    }
  };

  const selPricing = selectedPlan ? priceOf(selectedPlan) : null;
  const finalPrice = selectedPlan && selPricing ? (couponResult ? couponResult.finalAmountInr : selPricing.salePriceInr) : 0;
  const totalSaved = selPricing ? (selPricing.strikeInr ?? selPricing.regularInr) - finalPrice : 0;
  const hasActive = !!subscription?.active && !subscription.admin && !!subscription.endsAt;
  // What the user will actually get: stacks after the current expiry.
  const newEndsAt = React.useMemo(() => {
    if (!selectedPlan) return null;
    const base = hasActive ? new Date(subscription!.endsAt!) : new Date();
    return addMonthsClamped(base, selectedPlan.durationMonths);
  }, [selectedPlan, hasActive, subscription]);

  const header = <ShellHeader />;

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        {header}
        <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
          <CardSkeletons count={3} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {header}
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
        <PageHeading
          title={tr("Premium", "Premium")}
          subtitle={tr("Unlimited practice, all mocks and detailed solutions. Plans stack, so renewing early never wastes time.", "Unlimited practice, saare mocks aur detailed solutions. Plans stack hote hain, isliye jaldi renew karne se time waste nahi hota.")}
          actions={<Link href="/premium/history" className="btn btn-outline btn-sm">{tr("Payment history", "Payment history")}</Link>}
        />
        {loadError && (
          <div className="mb-6 flex items-center justify-between rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
            <span>{loadError}</span>
            <button onClick={loadData} className="btn btn-outline btn-sm">
              {tr("Retry", "Dobara try karein")}
            </button>
          </div>
        )}

        {/* Current status */}
        {subscription?.active && subscription.admin && (
          <div className="mb-8 rounded-lg border border-success/30 bg-success/10 p-4">
            <p className="font-semibold text-success">Admin — full premium access</p>
          </div>
        )}

        {hasActive && subscription?.plan && (
          <div
            className={`mb-8 rounded-xl border p-5 ${
              subscription.expiringSoon ? "border-warning/40 bg-warning/10" : "border-success/30 bg-success/10"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className={`font-semibold ${subscription.expiringSoon ? "text-warning" : "text-success"}`}>
                  {subscription.plan.name}
                </p>
                <p className={`text-sm text-foreground/80`}>
                  {tr("Valid until", "Valid until")} <strong>{fmtDate(subscription.endsAt)}</strong> ·{" "}
                  {subscription.daysLeft} {tr("days left", "din baaki")}
                </p>
              </div>
              <button
                onClick={() => selectPlan(subscription.plan!)}
                className="btn btn-primary"
              >
                {tr("Renew / extend", "Renew / extend karein")}
              </button>
            </div>
            {subscription.expiringSoon && (
              <p className="mt-2 text-sm text-foreground/80">
                {tr(
                  "Your plan is about to expire — renew now and your remaining time will be added.",
                  "Aapka plan jaldi khatam ho raha hai — abhi renew karein, baaki bacha hua time add ho jayega.",
                )}
              </p>
            )}
          </div>
        )}

        {!subscription?.active && (
          <div className="mb-8 rounded-xl border border-warning/30 bg-warning/10 p-5">
            <p className="font-semibold text-warning">
              {subscription?.lastEndedAt ? tr("Your plan has expired", "Aapka plan khatam ho chuka hai") : "Free Tier"}
            </p>
            <p className="text-sm text-foreground/80">
              {subscription?.lastEndedAt
                ? `${tr("Expired on", "Khatam hua")} ${fmtDate(subscription.lastEndedAt)}. `
                : ""}
              {tr(
                "Free users get 3 practice sets for every subject / chapter. Get a plan for unlimited access.",
                "Free me har subject/chapter ke 3 practice sets milte hain. Unlimited access ke liye plan lein.",
              )}
            </p>
          </div>
        )}

        {/* Plans */}
        <section className="mb-8">
          <h2 className="mb-5 text-2xl font-bold">{tr("Choose your plan", "Apna plan chunein")}</h2>
          {plans.length === 0 && !loadError && <p className="text-sm text-muted-foreground">{tr("No plans are available right now.", "Abhi koi plan available nahi hai.")}</p>}
          <div className="grid gap-4 pt-2 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => {
              const selected = selectedPlan?.id === plan.id;
              const pr = priceOf(plan);
              const ribbon = plan.badge || (bestValueId === plan.id ? "Best value" : null);
              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => selectPlan(plan)}
                  aria-pressed={selected}
                  className={`card card-hover relative min-h-[48px] touch-manipulation p-4 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    selected ? "!border-primary bg-primary/5 ring-2 ring-primary/30" : ""
                  }`}
                >
                  {ribbon && (
                    <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
                      {ribbon}
                    </span>
                  )}
                  <h3 className="font-semibold">{plan.name}</h3>
                  {pr.offerActive && pr.offerPct != null && (
                    <span className="mt-1 inline-block rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-bold text-accent">
                      {pr.offerLabel ? `${pr.offerLabel} · ` : ""}{pr.offerPct}% OFF
                    </span>
                  )}
                  <p className="mt-2 flex items-baseline justify-center gap-2">
                    {pr.strikeInr != null && <s className="text-sm text-muted-foreground">{inr(pr.strikeInr)}</s>}
                    <span className="text-3xl font-bold">{inr(pr.salePriceInr)}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">{durationLabel(plan.durationMonths)}</p>
                  {plan.durationMonths > 1 && (
                    <p className="mt-1 text-xs text-muted-foreground">≈ {inr(perMonth(plan))} / month</p>
                  )}
                  {pr.savingsInr > 0 && (
                    <p className="mt-1 text-xs font-semibold text-success">
                      {tr("You save", "Aapki bachat")} {inr(pr.savingsInr)} ({pr.savingsPct}%)
                    </p>
                  )}
                  {pr.offerActive && pr.offerEndsAt && (
                    <p className="mt-1 text-[11px] font-semibold text-warning">
                      ⏳ {tr("Offer ends in", "Offer khatam hone me")} <Countdown endsAt={pr.offerEndsAt} onDone={refreshPlans} />
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* Checkout */}
        {selectedPlan && (
          <section className="card mb-10 p-5 sm:p-6" aria-label={selectedPlan.name}>
            <h3 className="mb-4 text-xl font-bold">{selectedPlan.name}</h3>

            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium">{tr("Coupon code (optional)", "Coupon code (optional)")}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && !couponResult && applyCoupon()}
                  placeholder="Enter coupon code"
                  className="min-w-0 flex-1 rounded-lg border border-input bg-background px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label={tr("Coupon code", "Coupon code")}
                  disabled={!!couponResult}
                />
                {couponResult ? (
                  <button
                    onClick={() => {
                      setCouponCode("");
                      setCouponResult(null);
                    }}
                    className="btn btn-outline"
                  >
                    {tr("Remove", "Hatayein")}
                  </button>
                ) : (
                  <button
                    onClick={applyCoupon}
                    disabled={!couponCode.trim() || couponBusy || processing}
                    className="btn btn-primary"
                  >
                    {couponBusy ? "…" : tr("Apply", "Lagayein")}
                  </button>
                )}
              </div>
              {couponError && <p className="mt-1 text-sm text-danger">{couponError}</p>}
              {couponResult && (
                <div className="mt-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
                  <strong>{couponResult.code}</strong> applied{couponResult.description ? `: ${couponResult.description}` : ""} — you save{" "}
                  <strong>{inr(couponResult.discount)}</strong>
                </div>
              )}
            </div>

            {/* Order summary */}
            <div className="mb-4 space-y-1 rounded-lg bg-muted/50 p-4 text-sm">
              <div className="flex justify-between">
                <span>{selectedPlan.name}</span>
                <span>{inr(selPricing!.regularInr)}</span>
              </div>
              {selPricing!.offerDiscountInr > 0 && (
                <div className="flex justify-between text-success">
                  <span>{selPricing!.offerLabel || tr("Offer", "Offer")} ({selPricing!.offerPct}%)</span>
                  <span>− {inr(selPricing!.offerDiscountInr)}</span>
                </div>
              )}
              {couponResult && (
                <div className="flex justify-between text-success">
                  <span>Coupon ({couponResult.code})</span>
                  <span>− {inr(couponResult.discount)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-2 text-lg font-semibold">
                <span>Total</span>
                <span>{finalPrice <= 0 ? "FREE" : inr(finalPrice)}</span>
              </div>
              {totalSaved > 0.009 && (
                <p className="text-right text-xs font-semibold text-success">{tr("You save", "Aapki bachat")} {inr(totalSaved)}</p>
              )}
              {newEndsAt && (
                <p className="pt-2 text-xs text-muted-foreground">
                  {hasActive
                    ? tr(
                        `Your remaining time is safe — the new plan is added after ${fmtDate(subscription!.endsAt)}. New expiry: `,
                        `Aapka bacha hua time safe rahega — naya plan ${fmtDate(subscription!.endsAt)} ke baad add hoga. Nayi expiry: `,
                      )
                    : tr("Premium becomes active now, expiry: ", "Premium abhi se active hoga, expiry: ")}
                  <strong>{fmtDate(newEndsAt.toISOString())}</strong>
                </p>
              )}
            </div>

            <button
              onClick={payNow}
              disabled={processing}
              className="btn btn-primary btn-lg w-full"
            >
              {processing
                ? tr("Opening secure checkout…", "Secure checkout khul raha hai…")
                : finalPrice <= 0
                  ? tr("Activate for free", "Free me activate karein")
                  : `${tr("Pay", "Pay")} ${inr(finalPrice)} ${tr("securely", "securely")}`}
            </button>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              🔒 Cards, UPI, netbanking, wallets — powered by Cashfree. We never store your card / UPI details.
            </p>

            {error && <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</div>}
          </section>
        )}

        {/* Features */}
        <section>
          <h2 className="mb-5 text-2xl font-bold">{tr("What you get", "Premium me kya milta hai")}</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              ["Unlimited Practice", "No limit on question bank practice sets"],
              ["All Mock Tests", "All premium mocks, with detailed analytics"],
              ["Chapter PDFs", "Download all chapter PDFs and answer keys"],
              ["Weak Areas Practice", "Targeted practice built from your mistakes"],
              ["Progress Analytics", "Topic-wise performance tracking and recommendations"],
              ["Priority Support", "Faster responses and dedicated help"],
            ].map(([t, d]) => (
              <div key={t} className="card p-4">
                <h4 className="mb-1 font-semibold">{t}</h4>
                <p className="text-sm text-muted-foreground">{d}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
