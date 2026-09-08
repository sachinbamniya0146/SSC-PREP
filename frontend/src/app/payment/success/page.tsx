"use client";

import * as React from "react";
import { fetchAuth, API_BASE } from "@/lib/api";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

function PaymentSuccessContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = React.useState<"checking" | "success" | "pending" | "failed">("checking");
  const [message, setMessage] = React.useState("");

  // Cashfree migration: we no longer read a payment status/hash out of the
  // URL and trust it — the URL only tells us WHICH order_id to ask about.
  // /payments/verify asks Cashfree's own server for the real status (see
  // monetization.service.ts verifyPayment()), so a tampered query string
  // can't fake a success here.
  React.useEffect(() => {
    const orderId = searchParams.get("order_id");

    if (!orderId) {
      setStatus("failed");
      setMessage("Invalid payment response — missing order id");
      return;
    }

    const verifyPayment = async (attempt = 1) => {
      try {
        const res = await fetchAuth(`${API_BASE}/payments/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          setStatus("failed");
          setMessage(data.message || "Payment verification failed");
          return;
        }

        if (data.pending) {
          // Some payment methods (e.g. UPI collect) can take a few seconds
          // to settle after the redirect — poll a few times before giving up.
          if (attempt < 6) {
            setStatus("pending");
            setMessage("Your payment is still processing…");
            setTimeout(() => verifyPayment(attempt + 1), 3000);
            return;
          }
          setStatus("pending");
          setMessage("Your payment is taking longer than usual. It will be confirmed automatically once done — check back in a few minutes.");
          return;
        }

        setStatus("success");
        setMessage(data.duplicate ? "Payment already confirmed." : "Payment successful! Your premium subscription is now active.");
      } catch (e: any) {
        setStatus("failed");
        setMessage(e.message || "Network error while verifying payment");
      }
    };

    verifyPayment();
  }, [searchParams]);

  if (status === "checking" || status === "pending") {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center px-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-lg">{status === "pending" ? message : "Verifying payment..."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        {status === "success" ? (
          <>
            <div className="mx-auto w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold mb-2">Payment Successful!</h1>
            <p className="text-muted-foreground mb-6">{message}</p>
            <Link href="/premium" className="inline-block w-full py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90">
              View Subscription
            </Link>
          </>
        ) : (
          <>
            <div className="mx-auto w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold mb-2">Payment Failed</h1>
            <p className="text-muted-foreground mb-6">{message}</p>
            <Link href="/premium" className="inline-block w-full py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90">
              Try Again
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-lg">Loading...</p>
        </div>
      </div>
    }>
      <PaymentSuccessContent />
    </Suspense>
  );
}
