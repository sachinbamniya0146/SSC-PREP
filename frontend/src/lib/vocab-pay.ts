// Shared Cashfree checkout helper for the vocabulary pay-to-skip / pay-to-unlock
// flows (Sep 29 2026). Same order -> Cashfree SDK -> /payment/success?order_id=
// flow /premium and the vocab word page already use; the SERVER decides the
// amount (Rs 2 word, Rs 100 all, escalating revision skip) — the browser only
// says WHICH product it wants.
import { API_BASE, fetchAuth } from "@/lib/api";

export type BiMsg = { en: string; hi: string };

let sdkPromise: Promise<any> | null = null;
function loadCashfreeSdk(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if ((window as any).Cashfree) return Promise.resolve((window as any).Cashfree);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    script.async = true;
    script.onload = () => resolve((window as any).Cashfree);
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error("The payment SDK could not be loaded"));
    };
    document.body.appendChild(script);
  });
  return sdkPromise;
}

export type PayProduct =
  | { vocabWordId: string }
  | { vocabUnlockAll: true }
  | { vocabRevisionSkip: true }
  | { vocabSubscription: true }
  | { planId: string; couponCode?: string }
  | { chapterId: string }
  | { mockTemplateId: string };

/**
 * Creates the order and hands off to Cashfree checkout (redirects the tab).
 * Resolves with `{ free: true, orderId }` when a 100%-off coupon made the order
 * free (nothing to pay — access is already granted); otherwise the page is
 * redirected to Cashfree and this never resolves meaningfully. Throws on failure.
 */
export async function startCashfreeCheckout(product: PayProduct): Promise<{ free: boolean; orderId?: string }> {
  const res = await fetchAuth(`${API_BASE}/payments/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(product),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d?.message || "Could not create the order");
  }
  const order = await res.json();
  if (order.free) return { free: true, orderId: order.orderId };
  const Cashfree = await loadCashfreeSdk();
  if (!Cashfree) throw new Error("The payment SDK could not be loaded");
  const cashfree = Cashfree({ mode: order.cashfreeEnv === "PRODUCTION" ? "production" : "sandbox" });
  await cashfree.checkout({ paymentSessionId: order.paymentSessionId, redirectTarget: "_self" });
  return { free: false, orderId: order.orderId };
}
