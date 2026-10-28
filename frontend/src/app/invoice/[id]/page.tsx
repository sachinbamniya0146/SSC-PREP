"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchAuth, API_BASE } from "@/lib/api";

type Invoice = {
  invoiceNo: string;
  date: string;
  orderId: string;
  transactionId: string | null;
  customer: { name: string | null; email: string; phone: string | null };
  item: string;
  listPriceInr: number;
  discountInr: number;
  offerDiscountInr?: number;
  offerPct?: number | null;
  couponCode: string | null;
  paidInr: number;
  validFrom: string | null;
  validUntil: string | null;
  seller: string;
};

const d = (v?: string | null) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const [inv, setInv] = React.useState<Invoice | null>(null);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetchAuth(`${API_BASE}/payments/invoice/${id}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Invoice not found");
        setInv(data);
      } catch (e: any) {
        setError(e.message || "Invoice not found");
      }
    })();
  }, [id]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background text-foreground">
        <p>{error}</p>
        <Link href="/premium/history" className="text-primary hover:underline">← Payment history</Link>
      </div>
    );
  }
  if (!inv) return <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground">
      <div className="mx-auto mb-4 flex max-w-2xl justify-between print:hidden">
        <Link href="/premium/history" className="text-sm text-muted-foreground hover:text-foreground">← Back</Link>
        <button onClick={() => window.print()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
          Print / Save as PDF
        </button>
      </div>
      <div className="mx-auto max-w-2xl rounded-xl border bg-card p-8">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{inv.seller}</h1>
            <p className="text-sm text-muted-foreground">Payment receipt</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold">{inv.invoiceNo}</p>
            <p className="text-muted-foreground">{d(inv.date)}</p>
          </div>
        </div>
        <div className="mb-6 text-sm">
          <p className="font-medium">Billed to</p>
          <p>{inv.customer.name || inv.customer.email}</p>
          <p className="text-muted-foreground">{inv.customer.email}{inv.customer.phone ? ` · ${inv.customer.phone}` : ""}</p>
        </div>
        <table className="mb-4 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground"><th className="py-2">Item</th><th className="py-2 text-right">Amount</th></tr>
          </thead>
          <tbody>
            <tr className="border-b">
              <td className="py-2">
                {inv.item}
                {inv.validUntil && <div className="text-xs text-muted-foreground">Valid {d(inv.validFrom)} – {d(inv.validUntil)}</div>}
              </td>
              <td className="py-2 text-right">₹{inv.listPriceInr}</td>
            </tr>
            {(inv.offerDiscountInr ?? 0) > 0 && (
              <tr className="border-b text-green-700">
                <td className="py-2">Offer{inv.offerPct ? ` (${inv.offerPct}%)` : ""}</td>
                <td className="py-2 text-right">− ₹{inv.offerDiscountInr}</td>
              </tr>
            )}
            {inv.discountInr > 0 && (
              <tr className="border-b text-green-700">
                <td className="py-2">Coupon {inv.couponCode}</td>
                <td className="py-2 text-right">− ₹{inv.discountInr}</td>
              </tr>
            )}
            <tr className="font-bold"><td className="py-3">Total paid</td><td className="py-3 text-right">₹{inv.paidInr}</td></tr>
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground">Order {inv.orderId}{inv.transactionId ? ` · Txn ${inv.transactionId}` : ""}</p>
      </div>
    </div>
  );
}
