"use client";

import * as React from "react";
import Link from "next/link";
import { fetchAuth, API_BASE } from "@/lib/api";

type Row = {
  id: string;
  orderId: string;
  title: string;
  amountInr: number;
  discount: number;
  couponDiscount?: number;
  offerDiscount?: number;
  couponCode: string | null;
  status: "PENDING" | "SUCCESS" | "FAILED" | "REFUNDED";
  createdAt: string;
  canInvoice: boolean;
};

const badge: Record<Row["status"], string> = {
  SUCCESS: "bg-green-100 text-green-800",
  PENDING: "bg-amber-100 text-amber-800",
  FAILED: "bg-red-100 text-red-800",
  REFUNDED: "bg-slate-100 text-slate-700",
};

export default function PaymentHistoryPage() {
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    setError("");
    try {
      const res = await fetchAuth(`${API_BASE}/payments/history`);
      if (!res.ok) throw new Error();
      setRows(await res.json());
    } catch {
      setError("Could not load your payment history.");
      setRows([]);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <h1 className="text-xl font-bold">Payment history</h1>
          <Link href="/premium" className="text-sm text-muted-foreground hover:text-foreground">
            ← Premium
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        {rows === null && <p className="text-sm text-muted-foreground">Loading…</p>}
        {rows && rows.length === 0 && !error && <p className="text-sm text-muted-foreground">No payments yet.</p>}
        <ul className="space-y-3">
          {rows?.map((r) => (
            <li key={r.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{r.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString("en-IN")} · {r.orderId}
                  </p>
                  {(r.offerDiscount ?? 0) > 0 && (
                    <p className="text-xs text-green-700">Offer (− ₹{r.offerDiscount})</p>
                  )}
                  {r.couponCode && (
                    <p className="text-xs text-green-700">
                      Coupon {r.couponCode} (− ₹{r.couponDiscount ?? r.discount})
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-bold">{r.amountInr <= 0 ? "FREE" : `₹${r.amountInr}`}</p>
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge[r.status]}`}>{r.status}</span>
                </div>
              </div>
              <div className="mt-3 flex gap-3 text-sm">
                {r.canInvoice && (
                  <Link href={`/invoice/${r.id}`} className="font-medium text-primary hover:underline">
                    View invoice
                  </Link>
                )}
                {r.status === "PENDING" && (
                  <Link href={`/payment/success?order_id=${encodeURIComponent(r.orderId)}`} className="font-medium text-primary hover:underline">
                    Check status
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
