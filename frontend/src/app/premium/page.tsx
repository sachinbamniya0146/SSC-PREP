"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchAuth, API_BASE } from "@/lib/api";
import { startCashfreeCheckout } from "@/lib/vocab-pay";
import { useT } from "@/lib/i18n";

type Plan = {
  id: string;
  name: string;
  durationMonths: number;
  priceInr: number;
  isActive: boolean;
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
      setPlans(plansData.filter((p) => p.isActive).sort((a, b) => a.durationMonths - b.durationMonths));
      setSubscription(await subRes.json());
    } catch {
      setLoadError(tr("Plans load nahi ho paye. Page refresh karke dobara try karein.", "Plans load nahi ho paye. Page refresh karke dobara try karein."));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  // Price per month → used for the "best value" badge and per-month hint.
  const perMonth = (p: Plan) => p.priceInr / Math.max(1, p.durationMonths);
  const bestValueId = React.useMemo(() => {
    if (plans.length < 2) return null;
    return [...plans].sort((a, b) => perMonth(a) - perMonth(b))[0]?.id ?? null;
  }, [plans]);

  const selectPlan = (plan: Plan) => {
    setSelectedPlan(plan);
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
        body: JSON.stringify({ code: couponCode.trim(), amountInr: selectedPlan.priceInr }),
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
      setError(e?.message || "Payment start nahi ho paya");
      setProcessing(false);
    }
  };

  const finalPrice = selectedPlan ? (couponResult ? couponResult.finalAmountInr : selectedPlan.priceInr) : 0;
  const hasActive = !!subscription?.active && !subscription.admin && !!subscription.endsAt;
  // What the user will actually get: stacks after the current expiry.
  const newEndsAt = React.useMemo(() => {
    if (!selectedPlan) return null;
    const base = hasActive ? new Date(subscription!.endsAt!) : new Date();
    return addMonthsClamped(base, selectedPlan.durationMonths);
  }, [selectedPlan, hasActive, subscription]);

  const header = (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
      <div className="mx-auto flex max-w-4xl items-center justify-between">
        <h1 className="text-xl font-bold">{tr("Premium", "Premium")}</h1>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/premium/history" className="text-muted-foreground hover:text-foreground">
            {tr("Payment history", "Payment history")}
          </Link>
          <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
            ← Dashboard
          </Link>
        </div>
      </div>
    </header>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        {header}
        <main className="mx-auto max-w-4xl px-4 py-10">
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {header}
      <main className="mx-auto max-w-4xl px-4 py-8">
        {loadError && (
          <div className="mb-6 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <span>{loadError}</span>
            <button onClick={loadData} className="rounded-md border border-red-300 px-3 py-1 font-medium hover:bg-red-100">
              Retry
            </button>
          </div>
        )}

        {/* Current status */}
        {subscription?.active && subscription.admin && (
          <div className="mb-8 rounded-lg border border-green-200 bg-green-50 p-4">
            <p className="font-semibold text-green-800">Admin — full premium access</p>
          </div>
        )}

        {hasActive && subscription?.plan && (
          <div
            className={`mb-8 rounded-xl border p-5 ${
              subscription.expiringSoon ? "border-amber-300 bg-amber-50" : "border-green-200 bg-green-50"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className={`font-semibold ${subscription.expiringSoon ? "text-amber-900" : "text-green-800"}`}>
                  {subscription.plan.name}
                </p>
                <p className={`text-sm ${subscription.expiringSoon ? "text-amber-800" : "text-green-700"}`}>
                  {tr("Valid until", "Valid until")} <strong>{fmtDate(subscription.endsAt)}</strong> ·{" "}
                  {subscription.daysLeft} {tr("days left", "din baaki")}
                </p>
              </div>
              <button
                onClick={() => selectPlan(subscription.plan!)}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                {tr("Renew / extend", "Renew / extend karein")}
              </button>
            </div>
            {subscription.expiringSoon && (
              <p className="mt-2 text-sm text-amber-800">
                {tr(
                  "Aapka plan jaldi khatam ho raha hai — abhi renew karein, baaki bacha hua time add ho jayega.",
                  "Aapka plan jaldi khatam ho raha hai — abhi renew karein, baaki bacha hua time add ho jayega.",
                )}
              </p>
            )}
          </div>
        )}

        {!subscription?.active && (
          <div className="mb-8 rounded-xl border border-amber-200 bg-amber-50 p-5">
            <p className="font-semibold text-amber-800">
              {subscription?.lastEndedAt ? tr("Your plan has expired", "Aapka plan khatam ho chuka hai") : "Free Tier"}
            </p>
            <p className="text-sm text-amber-700">
              {subscription?.lastEndedAt
                ? `${tr("Expired on", "Khatam hua")} ${fmtDate(subscription.lastEndedAt)}. `
                : ""}
              {tr(
                "Free me har subject/chapter ke 3 practice sets milte hain. Unlimited access ke liye plan lein.",
                "Free me har subject/chapter ke 3 practice sets milte hain. Unlimited access ke liye plan lein.",
              )}
            </p>
          </div>
        )}

        {/* Plans */}
        <section className="mb-8">
          <h2 className="mb-5 text-2xl font-bold">{tr("Choose your plan", "Apna plan chunein")}</h2>
          {plans.length === 0 && !loadError && <p className="text-sm text-muted-foreground">No plans are available right now.</p>}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => {
              const selected = selectedPlan?.id === plan.id;
              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => selectPlan(plan)}
                  aria-pressed={selected}
                  className={`relative rounded-xl border p-4 text-center transition-all ${
                    selected ? "border-primary bg-primary/5 shadow-lg" : "border-border hover:border-primary/50 hover:shadow-md"
                  }`}
                >
                  {bestValueId === plan.id && (
                    <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
                      Best value
                    </span>
                  )}
                  <h3 className="font-semibold">{plan.name}</h3>
                  <p className="my-2 text-3xl font-bold">{inr(plan.priceInr)}</p>
                  <p className="text-sm text-muted-foreground">{durationLabel(plan.durationMonths)}</p>
                  {plan.durationMonths > 1 && (
                    <p className="mt-1 text-xs text-muted-foreground">≈ {inr(perMonth(plan))} / month</p>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* Checkout */}
        {selectedPlan && (
          <section className="mb-10 rounded-xl border bg-card p-6">
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
                  className="flex-1 rounded-lg border border-input bg-background px-4 py-2"
                  disabled={!!couponResult}
                />
                {couponResult ? (
                  <button
                    onClick={() => {
                      setCouponCode("");
                      setCouponResult(null);
                    }}
                    className="rounded-lg border border-input bg-background px-4 py-2 hover:bg-muted"
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    onClick={applyCoupon}
                    disabled={!couponCode.trim() || couponBusy || processing}
                    className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {couponBusy ? "…" : "Apply"}
                  </button>
                )}
              </div>
              {couponError && <p className="mt-1 text-sm text-red-600">{couponError}</p>}
              {couponResult && (
                <div className="mt-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                  <strong>{couponResult.code}</strong> applied{couponResult.description ? `: ${couponResult.description}` : ""} — you save{" "}
                  <strong>{inr(couponResult.discount)}</strong>
                </div>
              )}
            </div>

            {/* Order summary */}
            <div className="mb-4 space-y-1 rounded-lg bg-muted/50 p-4 text-sm">
              <div className="flex justify-between">
                <span>{selectedPlan.name}</span>
                <span>{inr(selectedPlan.priceInr)}</span>
              </div>
              {couponResult && (
                <div className="flex justify-between text-green-700">
                  <span>Coupon ({couponResult.code})</span>
                  <span>− {inr(couponResult.discount)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-2 text-lg font-semibold">
                <span>Total</span>
                <span>{finalPrice <= 0 ? "FREE" : inr(finalPrice)}</span>
              </div>
              {newEndsAt && (
                <p className="pt-2 text-xs text-muted-foreground">
                  {hasActive
                    ? tr(
                        `Aapka bacha hua time safe rahega — naya plan ${fmtDate(subscription!.endsAt)} ke baad add hoga. Nayi expiry: `,
                        `Aapka bacha hua time safe rahega — naya plan ${fmtDate(subscription!.endsAt)} ke baad add hoga. Nayi expiry: `,
                      )
                    : tr("Premium abhi se active hoga, expiry: ", "Premium abhi se active hoga, expiry: ")}
                  <strong>{fmtDate(newEndsAt.toISOString())}</strong>
                </p>
              )}
            </div>

            <button
              onClick={payNow}
              disabled={processing}
              className="w-full rounded-lg bg-primary py-3 font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {processing
                ? tr("Opening secure checkout…", "Secure checkout khul raha hai…")
                : finalPrice <= 0
                  ? tr("Activate for free", "Free me activate karein")
                  : `${tr("Pay", "Pay")} ${inr(finalPrice)} ${tr("securely", "securely")}`}
            </button>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              🔒 Cards, UPI, netbanking, wallets — powered by Cashfree. Hum aapka card/UPI detail kabhi store nahi karte.
            </p>

            {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
          </section>
        )}

        {/* Features */}
        <section>
          <h2 className="mb-5 text-2xl font-bold">{tr("What you get", "Premium me kya milta hai")}</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              ["Unlimited Practice", "Question bank practice sets par koi limit nahi"],
              ["All Mock Tests", "Saare premium mocks, detailed analytics ke saath"],
              ["Chapter PDFs", "Saare chapter PDFs aur answer keys download karein"],
              ["Weak Areas Practice", "Aapki galtiyon se bani targeted practice"],
              ["Progress Analytics", "Topic-wise performance tracking aur recommendations"],
              ["Priority Support", "Tez response aur dedicated help"],
            ].map(([t, d]) => (
              <div key={t} className="rounded-lg border bg-card p-4">
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
