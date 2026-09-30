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
      reject(new Error("Payment SDK load nahi hua"));
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
  | { planId: string };

/** Creates the order and hands off to Cashfree checkout (redirects the tab). Throws on failure. */
export async function startCashfreeCheckout(product: PayProduct): Promise<void> {
  const res = await fetchAuth(`${API_BASE}/payments/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(product),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d?.message || "Order create nahi hua");
  }
  const order = await res.json();
  const Cashfree = await loadCashfreeSdk();
  if (!Cashfree) throw new Error("Payment SDK load nahi hua");
  const cashfree = Cashfree({ mode: order.cashfreeEnv === "PRODUCTION" ? "production" : "sandbox" });
  await cashfree.checkout({ paymentSessionId: order.paymentSessionId, redirectTarget: "_self" });
}
