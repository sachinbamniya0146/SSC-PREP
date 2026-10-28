"use client";

// Admin → Pricing, Offers & Coupons
// One screen to run the money side without touching the database:
//   • Coupons  : % or flat ₹ code, cap, minimum order, start/expiry, total + per-student limit, plan-wise, usage stats
//   • Plans    : price, MRP (struck-through), time-boxed % offer with label, badge, order, on/off
// Every rule is enforced on the server (backend/src/monetization/pricing.util.ts); the previews here are only a guide.
import * as React from "react";
import { useRouter } from "next/navigation";
import { BackButton } from "@/components/BackButton";
import { Logo } from "@/components/Logo";
import { TickBox } from "@/components/TickBox";
import { api } from "@/lib/api";
import { useAccess } from "@/lib/permissions";

type Pricing = {
  regularInr: number;
  salePriceInr: number;
  strikeInr: number | null;
  offerActive: boolean;
  offerPct: number | null;
  offerLabel: string | null;
  offerEndsAt: string | null;
  savingsInr: number;
  savingsPct: number;
  perMonthInr: number;
};
type AdminPlan = {
  id: string;
  name: string;
  durationMonths: number;
  priceInr: number;
  mrpInr: number | null;
  offerPct: number | null;
  offerLabel: string | null;
  offerStartsAt: string | null;
  offerEndsAt: string | null;
  badge: string | null;
  sortOrder: number;
  isActive: boolean;
  subscribers: number;
  pricing: Pricing;
};
type CouponStatus = "ACTIVE" | "SCHEDULED" | "EXPIRED" | "EXHAUSTED" | "INACTIVE";
type AdminCoupon = {
  id: string;
  code: string;
  description: string | null;
  discountPct: number | null;
  discountInr: number | null;
  maxDiscountInr: number | null;
  minOrderInr: number | null;
  maxUses: number;
  usesCount: number;
  perUserLimit: number;
  startsAt: string | null;
  expiresAt: string | null;
  planIds: string[];
  stackWithOffer: boolean;
  isActive: boolean;
  createdAt: string;
  status: CouponStatus;
  paidOrders: number;
  revenueInr: number;
  discountGivenInr: number;
};

const inr = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fmtDT = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
/** ISO -> value for <input type="datetime-local"> in the admin's own time zone */
const toLocalInput = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v: string): string | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const plusDays = (days: number) => toLocalInput(new Date(Date.now() + days * 86_400_000).toISOString());
const plusHours = (h: number) => toLocalInput(new Date(Date.now() + h * 3_600_000).toISOString());
const durationLabel = (m: number) => (m === 1 ? "1 month" : m % 12 === 0 ? `${m / 12} year${m / 12 > 1 ? "s" : ""}` : `${m} months`);

const STATUS_STYLE: Record<CouponStatus, { label: string; cls: string }> = {
  ACTIVE: { label: "Live", cls: "bg-success/15 text-success" },
  SCHEDULED: { label: "Scheduled", cls: "bg-info/15 text-info" },
  EXPIRED: { label: "Expired", cls: "bg-muted text-muted-foreground" },
  EXHAUSTED: { label: "Used up", cls: "bg-warning/15 text-warning" },
  INACTIVE: { label: "Paused", cls: "bg-danger/10 text-danger" },
};

const randomCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — easy to read out loud
  let s = "";
  const bytes = new Uint32Array(6);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 4294967295);
  for (let i = 0; i < bytes.length; i++) s += alphabet[bytes[i] % alphabet.length];
  return `SSC${s}`;
};

// ------------------------------------------------------------------ small UI pieces

function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-semibold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">{hint}</span>}
    </label>
  );
}
const inputCls = "w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm";

function StatTile({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className={`text-xl font-extrabold tabular-nums ${tone}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

// ------------------------------------------------------------------ page

export default function AdminPricingPage() {
  const router = useRouter();
  const access = useAccess();
  const [tab, setTab] = React.useState<"coupons" | "plans">("coupons");
  const [plans, setPlans] = React.useState<AdminPlan[]>([]);
  const [coupons, setCoupons] = React.useState<AdminCoupon[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [info, setInfo] = React.useState("");

  React.useEffect(() => {
    if (!access.loading && !access.isAdmin) router.replace("/dashboard");
  }, [access.loading, access.isAdmin, router]);

  const flash = (m: string) => {
    setInfo(m);
    window.setTimeout(() => setInfo(""), 4000);
  };

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [p, c] = await Promise.all([
        api<{ plans: AdminPlan[] }>("/admin/pricing/plans"),
        api<{ coupons: AdminCoupon[] }>("/admin/coupons"),
      ]);
      setPlans(p.plans);
      setCoupons(c.coupons);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load nahi hua");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (access.isAdmin) void load();
  }, [access.isAdmin, load]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-3 py-3 sm:px-4">
          <BackButton fallbackHref="/admin" />
          <Logo size={28} withWordmark={false} />
          <h1 className="min-w-0 truncate text-base font-bold sm:text-lg">Pricing, Offers &amp; Coupons</h1>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-3 pb-24 pt-4 sm:px-4 sm:pt-6">
        {error && (
          <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            <span className="min-w-0 break-words">{error}</span>
            <button onClick={load} className="btn btn-outline btn-sm shrink-0">Retry</button>
          </div>
        )}
        {info && (
          <div role="status" className="mb-4 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">{info}</div>
        )}

        <div role="tablist" className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 text-sm font-semibold">
          {([
            ["coupons", `🎟️ Coupons (${coupons.length})`],
            ["plans", `💰 Plans & Offers (${plans.length})`],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`min-h-[44px] rounded-lg px-3 transition ${tab === k ? "bg-card shadow-sm" : "text-muted-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-3" aria-busy="true">
            <div className="skeleton h-24 w-full" />
            <div className="skeleton h-24 w-full" />
          </div>
        ) : tab === "coupons" ? (
          <CouponsTab coupons={coupons} plans={plans} reload={load} flash={flash} setError={setError} />
        ) : (
          <PlansTab plans={plans} reload={load} flash={flash} setError={setError} />
        )}
      </main>
    </div>
  );
}

// ------------------------------------------------------------------ coupons

type CouponForm = {
  id: string | null;
  code: string;
  description: string;
  kind: "PCT" | "INR";
  value: string;
  maxDiscountInr: string;
  minOrderInr: string;
  maxUses: string;
  perUserLimit: string;
  startsAt: string;
  expiresAt: string;
  planIds: string[];
  stackWithOffer: boolean;
  isActive: boolean;
};

const blankCoupon = (): CouponForm => ({
  id: null,
  code: randomCode(),
  description: "",
  kind: "PCT",
  value: "10",
  maxDiscountInr: "",
  minOrderInr: "",
  maxUses: "100",
  perUserLimit: "1",
  startsAt: "",
  expiresAt: plusDays(30),
  planIds: [],
  stackWithOffer: true,
  isActive: true,
});

const couponToForm = (c: AdminCoupon): CouponForm => ({
  id: c.id,
  code: c.code,
  description: c.description ?? "",
  kind: c.discountPct ? "PCT" : "INR",
  value: String(c.discountPct ?? c.discountInr ?? ""),
  maxDiscountInr: c.maxDiscountInr != null ? String(c.maxDiscountInr) : "",
  minOrderInr: c.minOrderInr != null ? String(c.minOrderInr) : "",
  maxUses: String(c.maxUses),
  perUserLimit: String(c.perUserLimit),
  startsAt: toLocalInput(c.startsAt),
  expiresAt: toLocalInput(c.expiresAt),
  planIds: c.planIds ?? [],
  stackWithOffer: c.stackWithOffer,
  isActive: c.isActive,
});

function describeDiscount(c: Pick<AdminCoupon, "discountPct" | "discountInr" | "maxDiscountInr">) {
  if (c.discountPct) return `${c.discountPct}% off${c.maxDiscountInr ? ` (max ${inr(c.maxDiscountInr)})` : ""}`;
  if (c.discountInr) return `${inr(c.discountInr)} off`;
  return "—";
}

function CouponsTab({
  coupons,
  plans,
  reload,
  flash,
  setError,
}: {
  coupons: AdminCoupon[];
  plans: AdminPlan[];
  reload: () => Promise<void>;
  flash: (m: string) => void;
  setError: (m: string) => void;
}) {
  const [form, setForm] = React.useState<CouponForm | null>(null);
  const [formError, setFormError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [filter, setFilter] = React.useState<"ALL" | CouponStatus>("ALL");
  const [q, setQ] = React.useState("");
  const formRef = React.useRef<HTMLDivElement>(null);

  const totals = React.useMemo(
    () => ({
      live: coupons.filter((c) => c.status === "ACTIVE").length,
      orders: coupons.reduce((s, c) => s + c.paidOrders, 0),
      given: coupons.reduce((s, c) => s + c.discountGivenInr, 0),
      revenue: coupons.reduce((s, c) => s + c.revenueInr, 0),
    }),
    [coupons],
  );

  const shown = coupons.filter((c) => (filter === "ALL" || c.status === filter) && (!q.trim() || c.code.includes(q.trim().toUpperCase())));
  const planName = (id: string) => plans.find((p) => p.id === id)?.name ?? "removed plan";

  const open = (f: CouponForm) => {
    setForm(f);
    setFormError("");
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  // live preview on the cheapest chosen plan (guide only — the server decides the real number)
  const previewPlan = React.useMemo(() => {
    if (!form) return null;
    const pool = plans.filter((p) => p.isActive && (form.planIds.length === 0 || form.planIds.includes(p.id)));
    return pool.sort((a, b) => a.pricing.salePriceInr - b.pricing.salePriceInr)[0] ?? null;
  }, [form, plans]);
  const preview = React.useMemo(() => {
    if (!form || !previewPlan) return null;
    const amount = previewPlan.pricing.salePriceInr;
    const v = Number(form.value);
    if (!Number.isFinite(v) || v <= 0) return null;
    let d = form.kind === "PCT" ? (amount * Math.min(v, 100)) / 100 : v;
    const cap = Number(form.maxDiscountInr);
    if (form.kind === "PCT" && cap > 0) d = Math.min(d, cap);
    d = Math.min(Math.round(d * 100) / 100, amount);
    return { plan: previewPlan.name, amount, discount: d, final: Math.max(0, Math.round((amount - d) * 100) / 100) };
  }, [form, previewPlan]);

  async function save() {
    if (!form) return;
    setFormError("");
    const value = Number(form.value);
    if (!Number.isFinite(value) || value <= 0) return setFormError("Discount value daalein (0 se zyada).");
    if (form.kind === "PCT" && value > 100) return setFormError("Percentage 100 se zyada nahi ho sakta.");
    const body: Record<string, unknown> = {
      description: form.description.trim() || null,
      discountPct: form.kind === "PCT" ? value : null,
      discountInr: form.kind === "INR" ? value : null,
      maxDiscountInr: form.kind === "PCT" && form.maxDiscountInr.trim() ? Number(form.maxDiscountInr) : null,
      minOrderInr: form.minOrderInr.trim() ? Number(form.minOrderInr) : null,
      maxUses: form.maxUses.trim() === "" ? 0 : Number(form.maxUses),
      perUserLimit: form.perUserLimit.trim() === "" ? 1 : Number(form.perUserLimit),
      startsAt: fromLocalInput(form.startsAt),
      expiresAt: fromLocalInput(form.expiresAt),
      planIds: form.planIds,
      stackWithOffer: form.stackWithOffer,
      isActive: form.isActive,
    };
    setSaving(true);
    try {
      if (form.id) {
        await api(`/admin/coupons/${form.id}`, { method: "PATCH", body: JSON.stringify(body) });
        flash(`Coupon ${form.code} update ho gaya.`);
      } else {
        await api("/admin/coupons", { method: "POST", body: JSON.stringify({ ...body, code: form.code }) });
        flash(`Coupon ${form.code} ban gaya.`);
      }
      setForm(null);
      await reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Save nahi hua");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(c: AdminCoupon) {
    try {
      await api(`/admin/coupons/${c.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !c.isActive }) });
      flash(c.isActive ? `${c.code} pause kiya.` : `${c.code} chalu kiya.`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update nahi hua");
    }
  }

  async function remove(c: AdminCoupon) {
    if (!window.confirm(`Coupon ${c.code} delete karein? (sirf bina use wale coupon delete hote hain)`)) return;
    try {
      await api(`/admin/coupons/${c.id}`, { method: "DELETE" });
      flash(`${c.code} delete ho gaya.`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete nahi hua");
    }
  }

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      flash(`${code} copy ho gaya.`);
    } catch {
      flash(code);
    }
  };

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Live coupons" value={String(totals.live)} tone="text-success" />
        <StatTile label="Paid orders with a coupon" value={String(totals.orders)} />
        <StatTile label="Discount given" value={inr(totals.given)} tone="text-warning" />
        <StatTile label="Revenue from those orders" value={inr(totals.revenue)} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button onClick={() => open(blankCoupon())} className="btn btn-primary min-h-[44px]">＋ New coupon</button>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search code…"
          aria-label="Search coupon code"
          className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2.5 text-sm sm:max-w-[14rem] sm:flex-none"
        />
      </div>
      <div className="-mx-3 mt-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
        {(["ALL", "ACTIVE", "SCHEDULED", "INACTIVE", "EXHAUSTED", "EXPIRED"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${filter === f ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}
          >
            {f === "ALL" ? "All" : STATUS_STYLE[f].label}
          </button>
        ))}
      </div>

      {form && (
        <div ref={formRef} className="card mt-4 scroll-mt-20 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold">{form.id ? `Edit ${form.code}` : "New coupon"}</h2>
            <button onClick={() => setForm(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs">✕ Close</button>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Coupon code" hint={form.id ? "Code badla nahi ja sakta." : "3–24 characters: letters, numbers, - or _ (auto upper-case)."}>
              <div className="flex gap-2">
                <input
                  value={form.code}
                  disabled={!!form.id}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") })}
                  maxLength={24}
                  className={`${inputCls} font-mono font-bold tracking-wide`}
                />
                {!form.id && (
                  <button type="button" onClick={() => setForm({ ...form, code: randomCode() })} className="btn btn-outline shrink-0" aria-label="Generate a random code">🎲</button>
                )}
              </div>
            </Field>
            <Field label="Note for yourself (optional)" hint="Student ko coupon lagne par ye line dikhegi.">
              <input value={form.description} maxLength={200} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Diwali special" className={inputCls} />
            </Field>

            <div className="sm:col-span-2">
              <span className="mb-1 block text-sm font-semibold">Discount</span>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 text-sm font-semibold sm:max-w-xs">
                {(["PCT", "INR"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={form.kind === k}
                    onClick={() => setForm({ ...form, kind: k })}
                    className={`min-h-[40px] rounded-lg ${form.kind === k ? "bg-card shadow-sm" : "text-muted-foreground"}`}
                  >
                    {k === "PCT" ? "% Percentage" : "₹ Flat amount"}
                  </button>
                ))}
              </div>
            </div>
            <Field label={form.kind === "PCT" ? "Discount %" : "Discount ₹"} hint={form.kind === "PCT" ? "1 – 100. 100 = free plan." : "Plan ke price se zyada nahi kategi."}>
              <input inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className={inputCls} />
            </Field>
            {form.kind === "PCT" && (
              <Field label="Max discount ₹ (optional)" hint="Bade plan par % coupon ki upar limit. Khali = no cap.">
                <input inputMode="decimal" value={form.maxDiscountInr} onChange={(e) => setForm({ ...form, maxDiscountInr: e.target.value })} placeholder="e.g. 200" className={inputCls} />
              </Field>
            )}
            <Field label="Minimum order ₹ (optional)" hint="Is amount se sasta plan ho to coupon nahi chalega.">
              <input inputMode="decimal" value={form.minOrderInr} onChange={(e) => setForm({ ...form, minOrderInr: e.target.value })} placeholder="e.g. 299" className={inputCls} />
            </Field>

            <Field label="Total uses" hint="Kul kitni baar chal sakta hai. 0 = unlimited.">
              <input inputMode="numeric" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value.replace(/\D/g, "") })} className={inputCls} />
            </Field>
            <Field label="Uses per student" hint="Ek student kitni baar. Normal: 1. 0 = unlimited.">
              <input inputMode="numeric" value={form.perUserLimit} onChange={(e) => setForm({ ...form, perUserLimit: e.target.value.replace(/\D/g, "") })} className={inputCls} />
            </Field>

            <Field label="Starts (optional)" hint="Is time se pehle coupon nahi chalega.">
              <input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Expires (optional)" hint="Khali = kabhi expire nahi.">
              <input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} className={inputCls} />
              <span className="mt-2 flex flex-wrap gap-1.5">
                {[["24 hours", plusHours(24)], ["7 days", plusDays(7)], ["30 days", plusDays(30)]].map(([l, v]) => (
                  <button key={l} type="button" onClick={() => setForm({ ...form, expiresAt: v })} className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold">+{l}</button>
                ))}
                <button type="button" onClick={() => setForm({ ...form, expiresAt: "" })} className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold">No expiry</button>
              </span>
            </Field>

            <div className="sm:col-span-2">
              <span className="mb-1 block text-sm font-semibold">Valid on</span>
              <p className="mb-2 text-[11px] text-muted-foreground">Kuch select na karein to coupon SAARE plans par chalega.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {plans.filter((p) => p.isActive || form.planIds.includes(p.id)).map((p) => (
                  <TickBox
                    key={p.id}
                    checked={form.planIds.includes(p.id)}
                    onChange={(v) => setForm({ ...form, planIds: v ? [...form.planIds, p.id] : form.planIds.filter((x) => x !== p.id) })}
                  >
                    <span className="font-semibold text-foreground">{p.name}</span> · {inr(p.pricing.salePriceInr)}
                  </TickBox>
                ))}
              </div>
            </div>

            <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
              <TickBox checked={form.stackWithOffer} onChange={(v) => setForm({ ...form, stackWithOffer: v })}>
                <span className="font-semibold text-foreground">Allow with a running plan offer</span>
                <span className="block text-[11px]">Band karne par coupon sirf un plans par chalega jinpe offer nahi chal raha.</span>
              </TickBox>
              <TickBox checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })}>
                <span className="font-semibold text-foreground">Active</span>
                <span className="block text-[11px]">Band = students ko "not active" dikhega.</span>
              </TickBox>
            </div>
          </div>

          {preview && (
            <p className="mt-4 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              Preview ({preview.plan}): {inr(preview.amount)} → student pays <b className="text-foreground">{preview.final <= 0 ? "FREE" : inr(preview.final)}</b> (saves {inr(preview.discount)}).
              Final number server calculate karta hai.
            </p>
          )}
          {formError && <p role="alert" className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{formError}</p>}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button onClick={save} disabled={saving} className="btn btn-primary min-h-[48px] flex-1">{saving ? "Saving…" : form.id ? "Save changes" : "Create coupon"}</button>
            <button onClick={() => setForm(null)} className="btn btn-outline min-h-[48px] flex-1">Cancel</button>
          </div>
        </div>
      )}

      <ul className="mt-4 space-y-3">
        {shown.length === 0 && (
          <li className="card p-8 text-center text-sm text-muted-foreground">
            {coupons.length === 0 ? "Abhi koi coupon nahi hai. “New coupon” se banayein." : "Is filter me koi coupon nahi."}
          </li>
        )}
        {shown.map((c) => {
          const st = STATUS_STYLE[c.status];
          const usedPct = c.maxUses > 0 ? Math.min(100, Math.round((c.usesCount / c.maxUses) * 100)) : 0;
          return (
            <li key={c.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => copy(c.code)} className="rounded-lg border border-dashed border-primary/50 bg-primary/5 px-3 py-1.5 font-mono text-base font-extrabold tracking-wide text-primary" aria-label={`Copy ${c.code}`}>
                  {c.code} <span aria-hidden className="text-xs font-normal">⧉</span>
                </button>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
                <span className="text-sm font-semibold">{describeDiscount(c)}</span>
              </div>
              {c.description && <p className="mt-1.5 text-xs text-muted-foreground">{c.description}</p>}

              <div className="mt-3">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Used {c.usesCount}{c.maxUses > 0 ? ` / ${c.maxUses}` : " (unlimited)"}</span>
                  {c.maxUses > 0 && <span>{usedPct}%</span>}
                </div>
                {c.maxUses > 0 && (
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div className="h-full rounded-full bg-primary" style={{ width: `${usedPct}%` }} />
                  </div>
                )}
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground sm:grid-cols-3">
                <div><dt className="inline">Per student: </dt><dd className="inline font-semibold text-foreground">{c.perUserLimit > 0 ? c.perUserLimit : "unlimited"}</dd></div>
                <div><dt className="inline">Min order: </dt><dd className="inline font-semibold text-foreground">{c.minOrderInr ? inr(c.minOrderInr) : "—"}</dd></div>
                <div><dt className="inline">With offer: </dt><dd className="inline font-semibold text-foreground">{c.stackWithOffer ? "allowed" : "not allowed"}</dd></div>
                <div><dt className="inline">Starts: </dt><dd className="inline font-semibold text-foreground">{c.startsAt ? fmtDT(c.startsAt) : "immediately"}</dd></div>
                <div><dt className="inline">Expires: </dt><dd className="inline font-semibold text-foreground">{c.expiresAt ? fmtDT(c.expiresAt) : "never"}</dd></div>
                <div className="col-span-2 sm:col-span-1">
                  <dt className="inline">Plans: </dt>
                  <dd className="inline font-semibold text-foreground">{c.planIds.length === 0 ? "all" : c.planIds.map(planName).join(", ")}</dd>
                </div>
              </dl>

              <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
                {c.paidOrders} paid order(s) · discount given <b className="text-foreground">{inr(c.discountGivenInr)}</b> · revenue <b className="text-foreground">{inr(c.revenueInr)}</b>
              </p>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <button onClick={() => open(couponToForm(c))} className="btn btn-outline min-h-[44px]">Edit</button>
                <button onClick={() => toggle(c)} className="btn btn-outline min-h-[44px]">{c.isActive ? "Pause" : "Resume"}</button>
                <button
                  onClick={() => remove(c)}
                  disabled={c.usesCount > 0}
                  title={c.usesCount > 0 ? "Used coupons are kept for the records — pause it instead" : "Delete"}
                  className="btn btn-outline min-h-[44px] text-danger disabled:opacity-40"
                >
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ plans

type PlanForm = {
  id: string | null;
  name: string;
  durationMonths: string;
  priceInr: string;
  mrpInr: string;
  offerPct: string;
  offerLabel: string;
  offerStartsAt: string;
  offerEndsAt: string;
  badge: string;
  sortOrder: string;
  isActive: boolean;
};

const blankPlan = (): PlanForm => ({
  id: null, name: "", durationMonths: "1", priceInr: "", mrpInr: "", offerPct: "", offerLabel: "", offerStartsAt: "", offerEndsAt: "", badge: "", sortOrder: "0", isActive: true,
});
const planToForm = (p: AdminPlan): PlanForm => ({
  id: p.id,
  name: p.name,
  durationMonths: String(p.durationMonths),
  priceInr: String(p.priceInr),
  mrpInr: p.mrpInr != null ? String(p.mrpInr) : "",
  offerPct: p.offerPct != null ? String(p.offerPct) : "",
  offerLabel: p.offerLabel ?? "",
  offerStartsAt: toLocalInput(p.offerStartsAt),
  offerEndsAt: toLocalInput(p.offerEndsAt),
  badge: p.badge ?? "",
  sortOrder: String(p.sortOrder),
  isActive: p.isActive,
});

function PlansTab({
  plans,
  reload,
  flash,
  setError,
}: {
  plans: AdminPlan[];
  reload: () => Promise<void>;
  flash: (m: string) => void;
  setError: (m: string) => void;
}) {
  const [form, setForm] = React.useState<PlanForm | null>(null);
  const [formError, setFormError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const formRef = React.useRef<HTMLDivElement>(null);

  const open = (f: PlanForm) => {
    setForm(f);
    setFormError("");
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  // what the student will see (guide only)
  const preview = React.useMemo(() => {
    if (!form) return null;
    const price = Number(form.priceInr);
    if (!Number.isFinite(price) || price <= 0) return null;
    const pct = Number(form.offerPct);
    const mrp = Number(form.mrpInr);
    const now = Date.now();
    const startOk = !form.offerStartsAt || new Date(form.offerStartsAt).getTime() <= now;
    const endOk = !form.offerEndsAt || new Date(form.offerEndsAt).getTime() > now;
    const live = pct > 0 && pct < 100 && startOk && endOk;
    const sale = live ? Math.round(price * (100 - pct)) / 100 : price;
    const strike = Math.max(price, mrp > price ? mrp : 0);
    return { sale, strike: strike > sale ? strike : null, live, scheduled: pct > 0 && !startOk, ended: pct > 0 && !endOk };
  }, [form]);

  async function save() {
    if (!form) return;
    setFormError("");
    const price = Number(form.priceInr);
    const months = Number(form.durationMonths);
    if (!form.name.trim()) return setFormError("Plan ka naam likhein.");
    if (!Number.isFinite(price) || price < 1) return setFormError("Price kam se kam ₹1 hona chahiye.");
    if (!Number.isInteger(months) || months < 1) return setFormError("Duration poore months me likhein (1, 3, 6, 12…).");
    const body = {
      name: form.name.trim(),
      durationMonths: months,
      priceInr: price,
      mrpInr: form.mrpInr.trim() ? Number(form.mrpInr) : null,
      offerPct: form.offerPct.trim() ? Number(form.offerPct) : null,
      offerLabel: form.offerLabel.trim() || null,
      offerStartsAt: fromLocalInput(form.offerStartsAt),
      offerEndsAt: fromLocalInput(form.offerEndsAt),
      badge: form.badge.trim() || null,
      sortOrder: form.sortOrder.trim() ? Number(form.sortOrder) : 0,
      isActive: form.isActive,
    };
    setSaving(true);
    try {
      if (form.id) await api(`/admin/plans/${form.id}`, { method: "PATCH", body: JSON.stringify(body) });
      else await api("/admin/plans", { method: "POST", body: JSON.stringify(body) });
      flash(form.id ? "Plan update ho gaya." : "Plan ban gaya.");
      setForm(null);
      await reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Save nahi hua");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(p: AdminPlan) {
    try {
      await api(`/admin/plans/${p.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !p.isActive }) });
      flash(p.isActive ? `${p.name} band kiya (students ko nahi dikhega).` : `${p.name} chalu kiya.`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update nahi hua");
    }
  }

  async function stopOffer(p: AdminPlan) {
    try {
      await api(`/admin/plans/${p.id}`, { method: "PATCH", body: JSON.stringify({ offerPct: null, offerStartsAt: null, offerEndsAt: null, offerLabel: null }) });
      flash(`${p.name}: offer band ho gaya.`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update nahi hua");
    }
  }

  async function remove(p: AdminPlan) {
    if (!window.confirm(`Plan "${p.name}" delete karein?`)) return;
    try {
      await api(`/admin/plans/${p.id}`, { method: "DELETE" });
      flash("Plan delete ho gaya.");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete nahi hua");
    }
  }

  return (
    <div>
      <button onClick={() => open(blankPlan())} className="btn btn-primary min-h-[44px]">＋ New plan</button>

      {form && (
        <div ref={formRef} className="card mt-4 scroll-mt-20 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold">{form.id ? "Edit plan" : "New plan"}</h2>
            <button onClick={() => setForm(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs">✕ Close</button>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Plan name">
              <input value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. 6 Month Pass" className={inputCls} />
            </Field>
            <Field label="Duration (months)">
              <input inputMode="numeric" value={form.durationMonths} onChange={(e) => setForm({ ...form, durationMonths: e.target.value.replace(/\D/g, "") })} className={inputCls} />
            </Field>
            <Field label="Price ₹ (regular)" hint="Offer na chale to student yehi deta hai.">
              <input inputMode="decimal" value={form.priceInr} onChange={(e) => setForm({ ...form, priceInr: e.target.value })} className={inputCls} />
            </Field>
            <Field label="MRP ₹ (optional)" hint="Sirf kata hua “was” price dikhane ke liye — charge nahi hota. Price se bada hona chahiye.">
              <input inputMode="decimal" value={form.mrpInr} onChange={(e) => setForm({ ...form, mrpInr: e.target.value })} className={inputCls} />
            </Field>
          </div>

          <div className="mt-5 rounded-xl border border-accent/30 bg-accent/5 p-3 sm:p-4">
            <h3 className="text-sm font-bold">🔥 Offer (time-boxed discount)</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Date ke baad apne aap band ho jata hai — price wapas regular. Khali chhodein = koi offer nahi.</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Offer % off" hint="1 – 90">
                <input inputMode="decimal" value={form.offerPct} onChange={(e) => setForm({ ...form, offerPct: e.target.value })} placeholder="e.g. 25" className={inputCls} />
              </Field>
              <Field label="Offer label" hint="Card par dikhega, e.g. “Diwali sale”.">
                <input value={form.offerLabel} maxLength={60} onChange={(e) => setForm({ ...form, offerLabel: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Starts (optional)">
                <input type="datetime-local" value={form.offerStartsAt} onChange={(e) => setForm({ ...form, offerStartsAt: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Ends (recommended)">
                <input type="datetime-local" value={form.offerEndsAt} onChange={(e) => setForm({ ...form, offerEndsAt: e.target.value })} className={inputCls} />
                <span className="mt-2 flex flex-wrap gap-1.5">
                  {[["24 hours", plusHours(24)], ["3 days", plusDays(3)], ["7 days", plusDays(7)]].map(([l, v]) => (
                    <button key={l} type="button" onClick={() => setForm({ ...form, offerStartsAt: "", offerEndsAt: v })} className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold">Now +{l}</button>
                  ))}
                </span>
              </Field>
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Badge (optional)" hint="e.g. Most popular, Best value.">
              <input value={form.badge} maxLength={30} onChange={(e) => setForm({ ...form, badge: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Order on the page" hint="Chhota number pehle dikhta hai.">
              <input inputMode="numeric" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value.replace(/[^\d-]/g, "") })} className={inputCls} />
            </Field>
            <div className="sm:col-span-2">
              <TickBox checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })}>
                <span className="font-semibold text-foreground">On sale</span>
                <span className="block text-[11px]">Band karne par plan students ko nahi dikhega; purane students ka access safe rehta hai.</span>
              </TickBox>
            </div>
          </div>

          {preview && (
            <div className="mt-4 rounded-xl border border-border bg-muted/40 p-3 text-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Student will see</p>
              <p className="mt-1">
                {preview.strike && <s className="mr-2 text-muted-foreground">{inr(preview.strike)}</s>}
                <b className="text-xl">{inr(preview.sale)}</b>
                {preview.live && <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-bold text-accent">{form.offerPct}% OFF</span>}
              </p>
              {preview.scheduled && <p className="mt-1 text-[11px] text-info">Offer abhi start nahi hua — start time par apne aap chalu hoga.</p>}
              {preview.ended && <p className="mt-1 text-[11px] text-warning">Offer ka end time nikal chuka hai — ye abhi lagu nahi hai.</p>}
            </div>
          )}
          {formError && <p role="alert" className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{formError}</p>}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button onClick={save} disabled={saving} className="btn btn-primary min-h-[48px] flex-1">{saving ? "Saving…" : form.id ? "Save changes" : "Create plan"}</button>
            <button onClick={() => setForm(null)} className="btn btn-outline min-h-[48px] flex-1">Cancel</button>
          </div>
        </div>
      )}

      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {plans.length === 0 && <li className="card p-8 text-center text-sm text-muted-foreground sm:col-span-2">Abhi koi plan nahi hai.</li>}
        {plans.map((p) => (
          <li key={p.id} className={`card p-4 ${p.isActive ? "" : "opacity-70"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 truncate text-base font-bold">{p.name}</h3>
              {!p.isActive && <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-bold text-danger">Off sale</span>}
              {p.badge && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">{p.badge}</span>}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{durationLabel(p.durationMonths)} · {p.subscribers} subscription(s) · order {p.sortOrder}</p>
            <p className="mt-2">
              {p.pricing.strikeInr && <s className="mr-2 text-sm text-muted-foreground">{inr(p.pricing.strikeInr)}</s>}
              <b className="text-2xl">{inr(p.pricing.salePriceInr)}</b>
              <span className="ml-2 text-xs text-muted-foreground">≈ {inr(p.pricing.perMonthInr)}/mo</span>
            </p>
            {p.pricing.offerActive ? (
              <p className="mt-2 rounded-lg bg-accent/10 px-3 py-2 text-xs text-accent">
                🔥 <b>{p.pricing.offerPct}% off</b>{p.pricing.offerLabel ? ` — ${p.pricing.offerLabel}` : ""}
                {p.offerEndsAt ? ` · till ${fmtDT(p.offerEndsAt)}` : " · no end date"}
              </p>
            ) : p.offerPct ? (
              <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                Offer {p.offerPct}% {p.offerStartsAt && new Date(p.offerStartsAt) > new Date() ? `starts ${fmtDT(p.offerStartsAt)}` : "ended"}
              </p>
            ) : null}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={() => open(planToForm(p))} className="btn btn-outline min-h-[44px]">Edit / set offer</button>
              <button onClick={() => toggle(p)} className="btn btn-outline min-h-[44px]">{p.isActive ? "Switch off" : "Switch on"}</button>
              {p.offerPct ? <button onClick={() => stopOffer(p)} className="btn btn-outline min-h-[44px]">End offer now</button> : <span />}
              <button onClick={() => remove(p)} disabled={p.subscribers > 0} title={p.subscribers > 0 ? "Has subscriptions — switch it off instead" : "Delete"} className="btn btn-outline min-h-[44px] text-danger disabled:opacity-40">Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
