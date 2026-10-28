"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchAuth, API_BASE } from "@/lib/api";
import { startCashfreeCheckout } from "@/lib/vocab-pay";
import { useT } from "@/lib/i18n";
import { ShellHeader, PageHeading, CardSkeletons } from "@/components/AppShell";

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
                  "Aapka plan jaldi khatam ho raha hai — abhi renew karein, baaki bacha hua time add ho jayega.",
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
                "Free me har subject/chapter ke 3 practice sets milte hain. Unlimited access ke liye plan lein.",
                "Free me har subject/chapter ke 3 practice sets milte hain. Unlimited access ke liye plan lein.",
              )}
            </p>
          </div>
        )}

        {/* Plans */}
        <section className="mb-8">
          <h2 className="mb-5 text-2xl font-bold">{tr("Choose your plan", "Apna plan chunein")}</h2>
          {plans.length === 0 && !loadError && <p className="text-sm text-muted-foreground">{tr("No plans are available right now.", "Abhi koi plan available nahi hai.")}</p>}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => {
              const selected = selectedPlan?.id === plan.id;
              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => selectPlan(plan)}
                  aria-pressed={selected}
                  className={`card card-hover relative p-4 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    selected ? "!border-primary bg-primary/5 ring-2 ring-primary/30" : ""
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
                <span>{inr(selectedPlan.priceInr)}</span>
              </div>
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
              className="btn btn-primary btn-lg w-full"
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

            {error && <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</div>}
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
