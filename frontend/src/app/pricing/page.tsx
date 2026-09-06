"use client";

// BUGFIX: /pricing was a stale, orphaned duplicate of /premium that tried
// to open a Razorpay checkout modal (`checkout.razorpay.com` +
// `new Razorpay({ key: d.keyId, ... })`). The backend
// (monetization.service.ts) only implements PayU — `POST /payments/order`
// returns a PayU `formData` + `payuUrl` for a hidden-form POST redirect,
// not a Razorpay key/order. So `d.keyId` was actually the PayU merchant
// key, Razorpay's SDK would reject it, and "Buy Now" on this page could
// never complete a real payment.
//
// Nothing in the app links to /pricing (dashboard, payment success/
// failure/cancel, and telegram settings all point to /premium, which
// already implements the correct PayU hidden-form redirect flow — see
// frontend/src/app/premium/page.tsx). Rather than maintain two payment
// UIs, this route now just forwards to the real one so a stray bookmark
// or direct URL hit can't land on the broken flow.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PricingPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/premium");
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <p className="text-sm text-muted-foreground">Redirecting to Premium…</p>
    </div>
  );
}
