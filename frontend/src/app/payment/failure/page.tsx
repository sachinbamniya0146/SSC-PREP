"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function PaymentFailureContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error") || searchParams.get("error_Message") || "Payment was not completed";

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="mx-auto w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold mb-2">Payment Failed</h1>
        <p className="text-muted-foreground mb-6">{error}</p>
        <Link href="/premium" className="inline-block w-full py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90">
          Try Again
        </Link>
      </div>
    </div>
  );
}

export default function PaymentFailurePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-lg">Loading...</p>
        </div>
      </div>
    }>
      <PaymentFailureContent />
    </Suspense>
  );
}