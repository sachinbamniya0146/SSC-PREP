"use client";

import * as React from "react";

type Plan = { id: string; name: string; durationMonths: number; priceInr: number };
type SubInfo = { active: boolean; plan?: Plan; endsAt?: string };

export default function PricingPage() {
  const [plans, setPlans] = React.useState<Plan[]>([]);
  const [sub, setSub] = React.useState<SubInfo | null>(null);
  const [coupon, setCoupon] = React.useState("");
  const [couponMsg, setCouponMsg] = React.useState("");
  const [discount, setDiscount] = React.useState<{ discount: number; finalAmountInr: number } | null>(null);
  const [buying, setBuying] = React.useState<string>("");
  const [error, setError] = React.useState("");

  const apiBase = () => process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
  const authHeaders = (): Record<string, string> => {
    const token = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  React.useEffect(() => {
    (async () => {
      try {
        const [pr, sr] = await Promise.all([
          fetch(`${apiBase()}/payments/plans`),
          fetch(`${apiBase()}/payments/subscription`, { headers: authHeaders() }),
        ]);
        if (pr.ok) setPlans(await pr.json());
        if (sr.ok) setSub(await sr.json());
      } catch {
        setError("Backend unreachable — payments unavailable");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validateCoupon = async () => {
    setCouponMsg("");
    setDiscount(null);
    if (!coupon.trim()) return;
    try {
      const r = await fetch(`${apiBase()}/payments/coupon/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ code: coupon.trim(), amountInr: 299 }),
      });
      const d = await r.json();
      if (r.ok) {
        setDiscount({ discount: d.discount, finalAmountInr: d.finalAmountInr });
        setCouponMsg(`✅ ${d.code}: ${d.discountPct ? d.discountPct + "% off" : "₹" + d.discount + " off"} → pay ₹${d.finalAmountInr}`);
      } else {
        setCouponMsg(`❌ ${d.message || "Invalid coupon"}`);
      }
    } catch {
      setCouponMsg("❌ Network error");
    }
  };

  const buy = async (plan: Plan) => {
    setBuying(plan.id);
    setError("");
    try {
      const r = await fetch(`${apiBase()}/payments/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ planId: plan.id, couponCode: coupon.trim() || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || "Order failed");
      // Razorpay checkout
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => {
        const rzp = new (window as any).Razorpay({
          key: d.keyId,
          amount: Math.round(d.amountInr * 100),
          currency: "INR",
          name: "SSC Prep Hub",
          description: d.planName || "Plan",
          prefill: { email: localStorage.getItem("ssc_email") || "" },
          handler: async (res: any) => {
            const v = await fetch(`${apiBase()}/payments/verify`, {
              method: "POST",
              headers: { "Content-Type": "application/json", ...authHeaders() },
              body: JSON.stringify(res),
            });
            if (v.ok) {
              setSub({ active: true, plan, endsAt: "" });
              alert("🎉 Payment successful! Subscription activated.");
            } else {
              const vd = await v.json().catch(() => ({}));
              alert("Payment verification failed: " + (vd.message || "try again"));
            }
            setBuying("");
          },
          modal: { ondismiss: () => setBuying("") },
        });
        rzp.open();
      };
      script.onerror = () => {
        setError("Could not load Razorpay checkout");
        setBuying("");
      };
      document.body.appendChild(script);
    } catch (e: any) {
      setError(e.message || "Order failed");
      setBuying("");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">
            ← <span className="text-primary">SSC</span>PrepHub
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-bold">💎 Premium Pass</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Unlimited mock tests, sectional tests & PDF downloads
        </p>

        {sub?.active && (
          <div className="mt-4 rounded-xl border border-green-500/40 bg-green-500/10 p-4 text-sm">
            ✅ Premium active{sub.plan ? ` — ${sub.plan.name}` : ""}
            {sub.endsAt ? ` (till ${new Date(sub.endsAt).toLocaleDateString()})` : ""}
          </div>
        )}
        {error && <p className="mt-4 text-sm text-danger">{error}</p>}

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {plans.map((p) => (
            <div key={p.id} className="card flex flex-col p-6">
              <p className="font-bold">{p.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{p.durationMonths} month{p.durationMonths > 1 ? "s" : ""}</p>
              <p className="mt-3 text-3xl font-extrabold">
                ₹{discount && discount.finalAmountInr < p.priceInr ? discount.finalAmountInr : p.priceInr}
              </p>
              {discount && discount.finalAmountInr < p.priceInr && (
                <p className="text-xs text-green-600 line-through">₹{p.priceInr}</p>
              )}
              <button
                onClick={() => buy(p)}
                disabled={!!buying}
                className="btn mt-4 bg-primary py-2.5 text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {buying === p.id ? "Redirecting…" : "Buy Now"}
              </button>
            </div>
          ))}
        </div>

        <div className="card mt-6 max-w-sm p-5">
          <p className="text-sm font-semibold">🎟️ Have a coupon?</p>
          <div className="mt-2 flex gap-2">
            <input
              value={coupon}
              onChange={(e) => setCoupon(e.target.value.toUpperCase())}
              placeholder="ENTER CODE"
              className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm uppercase"
            />
            <button onClick={validateCoupon} className="btn border border-border px-4 py-2 text-sm hover:bg-muted">
              Apply
            </button>
          </div>
          {couponMsg && <p className="mt-2 text-xs">{couponMsg}</p>}
        </div>
      </main>
    </div>
  );
}
