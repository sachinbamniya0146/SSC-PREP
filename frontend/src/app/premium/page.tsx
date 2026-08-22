"use client";

import * as React from "react";
import { fetchAuth } from "@/lib/api";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Plan = {
  id: string;
  name: string;
  durationMonths: number;
  priceInr: number;
  isActive: boolean;
};

type Subscription = {
  active: boolean;
  plan?: Plan;
  endsAt?: string;
};

type CouponValidation = {
  code: string;
  description: string;
  discountPct?: number;
  discountInr?: number;
  discount: number;
  finalAmountInr: number;
};

export default function PremiumPage() {
  const router = useRouter();
  const [plans, setPlans] = React.useState<Plan[]>([]);
  const [subscription, setSubscription] = React.useState<Subscription | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [selectedPlan, setSelectedPlan] = React.useState<Plan | null>(null);
  const [couponCode, setCouponCode] = React.useState("");
  const [couponResult, setCouponResult] = React.useState<CouponValidation | null>(null);
  const [couponError, setCouponError] = React.useState("");
  const [payuForm, setPayuForm] = React.useState<any>(null);
  const [processing, setProcessing] = React.useState(false);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");

  React.useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [plansRes, subRes] = await Promise.all([
        fetchAuth("/payments/plans"),
        fetchAuth("/payments/subscription"),
      ]);
      const plansData = await plansRes.json();
      const subData = await subRes.json();
      setPlans(plansData.filter((p: Plan) => p.isActive));
      setSubscription(subData);
    } catch (e) {
      console.error(e);
      setError("Failed to load plans");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPlan = (plan: Plan) => {
    setSelectedPlan(plan);
    setCouponCode("");
    setCouponResult(null);
    setCouponError("");
    setPayuForm(null);
    setError("");
    setSuccess("");
  };

  const validateCoupon = async () => {
    if (!selectedPlan || !couponCode.trim()) {
      setCouponError("Enter a coupon code");
      return;
    }
    setCouponError("");
    try {
      const res = await fetchAuth("/payments/coupon/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: couponCode, amountInr: selectedPlan.priceInr }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Invalid coupon");
      }
      const data = await res.json();
      setCouponResult(data);
    } catch (e: any) {
      setCouponError(e.message);
      setCouponResult(null);
    }
  };

  const createOrder = async () => {
    if (!selectedPlan) return;
    setProcessing(true);
    setError("");
    try {
      const res = await fetchAuth("/payments/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          planId: selectedPlan.id, 
          couponCode: couponResult?.code || undefined 
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to create order");
      }
      const data = await res.json();
      setPayuForm(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setProcessing(false);
    }
  };

  const redirectToPayU = () => {
    if (!payuForm) return;
    
    // Create a form and submit to PayU
    const form = document.createElement("form");
    form.method = "POST";
    form.action = payuForm.payuUrl;
    
    Object.entries(payuForm.formData).forEach(([key, value]) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = key;
      input.value = String(value);
      form.appendChild(input);
    });
    
    document.body.appendChild(form);
    form.submit();
  };

  const formatPrice = (price: number) => {
    return `₹${price.toFixed(2)}`;
  };

  const formatDuration = (months: number) => {
    if (months === 1) return "1 Month";
    if (months === 6) return "6 Months";
    if (months === 12) return "12 Months";
    if (months === 24) return "24 Months";
    return `${months} Months`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
          <div className="mx-auto max-w-4xl flex items-center justify-between">
            <h1 className="text-xl font-bold">Premium Upgrade</h1>
            <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
              ← Dashboard
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-10">
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto max-w-4xl flex items-center justify-between">
          <h1 className="text-xl font-bold">Premium Upgrade</h1>
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
            ← Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10">
        {/* Current Subscription */}
        {subscription?.active && subscription.plan && (
          <div className="mb-8 p-4 rounded-lg border bg-green-50 border-green-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-green-800">Active Subscription</p>
                <p className="text-sm text-green-700">
                  {subscription.plan.name} • Expires {new Date(subscription.endsAt!).toLocaleDateString()}
                </p>
              </div>
              <span className="px-3 py-1 rounded-full bg-green-100 text-green-800 text-sm font-medium">
                Premium Active
              </span>
            </div>
          </div>
        )}

        {subscription?.active && !subscription.plan && (
          <div className="mb-8 p-4 rounded-lg border bg-green-50 border-green-200">
            <p className="font-semibold text-green-800">Admin / Premium Active</p>
          </div>
        )}

        {!subscription?.active && (
          <div className="mb-8 p-4 rounded-lg border bg-amber-50 border-amber-200">
            <p className="font-semibold text-amber-800">Free Tier</p>
            <p className="text-sm text-amber-700">
              You have access to 3 free practice sets per subject/chapter. Upgrade for unlimited access.
            </p>
          </div>
        )}

        {/* Plans */}
        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-6">Choose Your Plan</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => (
              <div
                key={plan.id}
                onClick={() => handleSelectPlan(plan)}
                className={`relative p-4 rounded-lg border cursor-pointer transition-all ${
                  selectedPlan?.id === plan.id
                    ? "border-primary bg-primary/5 shadow-lg"
                    : "border-border hover:border-primary/50 hover:shadow-md"
                }`}
              >
                {selectedPlan?.id === plan.id && (
                  <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs">
                    ✓
                  </div>
                )}
                <div className="text-center">
                  <h3 className="font-semibold">{plan.name}</h3>
                  <p className="text-3xl font-bold my-2">{formatPrice(plan.priceInr)}</p>
                  <p className="text-sm text-muted-foreground">{formatDuration(plan.durationMonths)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Coupon & Payment */}
        {selectedPlan && (
          <section className="mb-8 p-6 rounded-lg border bg-card">
            <h3 className="text-xl font-bold mb-4">{selectedPlan.name}</h3>
            
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Coupon Code (Optional)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  placeholder="Enter coupon code"
                  className="flex-1 px-4 py-2 border border-input rounded-lg bg-background"
                  disabled={!!couponResult}
                />
                {couponResult ? (
                  <button
                    onClick={() => { setCouponCode(""); setCouponResult(null); }}
                    className="px-4 py-2 border border-input rounded-lg bg-background hover:bg-muted"
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    onClick={validateCoupon}
                    disabled={!couponCode.trim() || processing}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
                  >
                    Apply
                  </button>
                )}
              </div>
              {couponError && <p className="text-sm text-red-600 mt-1">{couponError}</p>}
              {couponResult && (
                <div className="mt-2 p-3 rounded-lg bg-green-50 border border-green-200">
                  <p className="text-sm text-green-800">
                    <strong>{couponResult.code}</strong> applied: {couponResult.description}
                  </p>
                  <p className="text-sm text-green-800">
                    Discount: {formatPrice(couponResult.discount)} → Pay: <strong>{formatPrice(couponResult.finalAmountInr)}</strong>
                  </p>
                </div>
              )}
            </div>

            <div className="text-right text-lg font-semibold mb-4">
              Total: {couponResult ? formatPrice(couponResult.finalAmountInr) : formatPrice(selectedPlan.priceInr)}
            </div>

            {payuForm && (
              <div className="space-y-4 p-4 rounded-lg border bg-muted/50">
                <p className="text-sm text-muted-foreground">
                  Redirecting to PayU secure payment page...
                </p>
                <button
                  onClick={redirectToPayU}
                  disabled={processing}
                  className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 disabled:opacity-50"
                >
                  {processing ? "Processing..." : "Pay Securely via PayU"}
                </button>
                <p className="text-xs text-muted-foreground text-center">
                  You will be redirected to PayU's secure payment page. After payment, you'll return here.
                </p>
              </div>
            )}

            {!payuForm && (
              <button
                onClick={createOrder}
                disabled={processing}
                className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 disabled:opacity-50"
              >
                {processing ? "Creating Order..." : "Proceed to Payment"}
              </button>
            )}

            {error && (
              <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
                {error}
              </div>
            )}

            {success && (
              <div className="mt-4 p-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm">
                {success}
              </div>
            )}
          </section>
        )}

        {/* Features */}
        <section>
          <h2 className="text-2xl font-bold mb-6">Premium Features</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="p-4 rounded-lg border bg-card">
              <h4 className="font-semibold mb-2">Unlimited Practice</h4>
              <p className="text-sm text-muted-foreground">No limits on question bank practice sets per subject/chapter</p>
            </div>
            <div className="p-4 rounded-lg border bg-card">
              <h4 className="font-semibold mb-2">All Mock Tests</h4>
              <p className="text-sm text-muted-foreground">Access to all 60+ premium mock tests with detailed analytics</p>
            </div>
            <div className="p-4 rounded-lg border bg-card">
              <h4 className="font-semibold mb-2">Chapter PDFs</h4>
              <p className="text-sm text-muted-foreground">Download all chapter PDFs and answer keys</p>
            </div>
            <div className="p-4 rounded-lg border bg-card">
              <h4 className="font-semibold mb-2">Weak Areas Practice</h4>
              <p className="text-sm text-muted-foreground">AI-generated practice from your mistakes</p>
            </div>
            <div className="p-4 rounded-lg border bg-card">
              <h4 className="font-semibold mb-2">Progress Analytics</h4>
              <p className="text-sm text-muted-foreground">Detailed performance tracking and recommendations</p>
            </div>
            <div className="p-4 rounded-lg border bg-card">
              <h4 className="font-semibold mb-2">Priority Support</h4>
              <p className="text-sm text-muted-foreground">Faster response times and dedicated help</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}