"use client";

import * as React from "react";
import { fetchAuth } from "@/lib/api";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

function PaymentSuccessContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = React.useState<"checking" | "success" | "failed">("checking");
  const [message, setMessage] = React.useState("");

  React.useEffect(() => {
    const verifyPayment = async () => {
      const txnid = searchParams.get("txnid");
      const payuPaymentId = searchParams.get("mihpayid");
      const hash = searchParams.get("hash");
      const paymentStatus = searchParams.get("status");
      const amount = searchParams.get("amount");
      const productinfo = searchParams.get("productinfo");
      const firstname = searchParams.get("firstname");
      const email = searchParams.get("email");
      const udf1 = searchParams.get("udf1");
      const udf2 = searchParams.get("udf2");
      const udf3 = searchParams.get("udf3");
      const udf4 = searchParams.get("udf4");
      const udf5 = searchParams.get("udf5");

      if (!txnid || !payuPaymentId || !hash || !paymentStatus) {
        setStatus("failed");
        setMessage("Invalid payment response");
        return;
      }

      try {
        const res = await fetchAuth("/payments/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            txnid,
            payuPaymentId,
            hash,
            status: paymentStatus,
            amount,
            productinfo,
            firstname,
            email,
            udf1,
            udf2,
            udf3,
            udf4,
            udf5,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || "Payment verification failed");
        }

        setStatus("success");
        setMessage("Payment successful! Your premium subscription is now active.");
      } catch (e: any) {
        setStatus("failed");
        setMessage(e.message);
      }
    };

    verifyPayment();
  }, [searchParams]);

  if (status === "checking") {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-lg">Verifying payment...</p>
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