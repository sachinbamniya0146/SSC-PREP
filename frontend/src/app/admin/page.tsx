"use client";

// Admin home: what happened today, what needs a human, and one-click doors into every tool.
import * as React from "react";
import { api } from "@/lib/api";
import { useAccess, type Access } from "@/lib/permissions";
import { Icon } from "@/components/AdminShell";

type Overview = {
  users: { total: number; new7d: number; suspended: number; activeSubscribers: number };
  revenue: { todayInr: number; todayCount: number; last7dInr: number; last7dCount: number; last30dInr: number; last30dCount: number };
  queues: { openChats: number; openReports: number; pendingWithdrawals: number; pendingWithdrawalsInr: number; commissionsInReview: number; questionsAwaitingReview: number };
  recentSignups: { id: string; fullName: string; email: string; createdAt: string }[];
  recentPayments: { id: string; amountInr: number; createdAt: string; user: string; kind: string | null; item: string | null }[];
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const num = (n: number) => n.toLocaleString("en-IN");
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};
const KIND: Record<string, string> = {
  PLAN: "Plan", CHAPTER: "Chapter PDF", MOCK: "Mock", VOCAB_WORD: "Vocab word", VOCAB_UNLOCK_ALL: "Vocab unlock all",
  VOCAB_SUBSCRIPTION: "Vocab plan", VOCAB_REVISION_SKIP: "Revision skip",
};

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "success" | "primary" }) {
  return (
    <div className="card p-4 sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1.5 text-2xl font-extrabold tabular-nums sm:text-3xl ${tone === "success" ? "text-success" : tone === "primary" ? "text-primary" : ""}`}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

type Tool = { href: string; label: string; desc: string; show: (a: Access) => boolean };
const TOOLS: { title: string; tools: Tool[] }[] = [
  {
    title: "Money",
    tools: [
      { href: "/admin/pricing", label: "Pricing & coupons", desc: "Plan prices, offers, coupon codes", show: (a) => a.isAdmin },
      { href: "/admin/referrals", label: "Refer & Earn", desc: "Rules, commissions, withdrawals", show: (a) => a.isAdmin },
      { href: "/admin/uploads", label: "Plans & bulk upload", desc: "Create plans, grant access, upload questions", show: (a) => a.can("QUESTIONS") || a.can("PRACTICE") },
    ],
  },
  {
    title: "Question bank",
    tools: [
      { href: "/admin/questions/add", label: "Add a question", desc: "One by one, with images and duplicate check", show: (a) => a.can("QUESTIONS") || a.can("PRACTICE") },
      { href: "/admin/questions/manage", label: "Question manager", desc: "Move, publish, hide or delete questions", show: (a) => a.can("QUESTIONS") },
      { href: "/verification", label: "Review queue", desc: "Approve or reject questions waiting for review", show: (a) => a.can("QUESTIONS") },
      { href: "/admin/questions/duplicates", label: "Duplicates", desc: "Keep one, keep both or remove", show: (a) => a.can("QUESTIONS") },
      { href: "/admin/chapters", label: "Chapters & topics", desc: "Syllabus structure", show: (a) => a.can("QUESTIONS") },
      { href: "/admin/coverage", label: "Coverage", desc: "Where the bank is thin", show: (a) => a.can("QUESTIONS") },
    ],
  },
  {
    title: "Exams & papers",
    tools: [
      { href: "/admin/exams", label: "Exams", desc: "Exams, tiers and subjects", show: (a) => a.isAdmin },
      { href: "/admin/patterns", label: "Exam patterns", desc: "Sections, marking, timers", show: (a) => a.isAdmin },
      { href: "/admin/pyq-papers", label: "PYQ papers", desc: "Date-wise papers: build and publish", show: (a) => a.isAdmin },
      { href: "/admin/pyq-dates", label: "PYQ date mapping", desc: "Exam date and tier for each paper", show: (a) => a.isAdmin },
      { href: "/admin/pyq-export", label: "PYQ export", desc: "Excel download by chapter / subject / exam", show: (a) => a.can("QUESTIONS") },
    ],
  },
  {
    title: "Learning & team",
    tools: [
      { href: "/admin/vocab", label: "Vocabulary", desc: "Words and quiz questions", show: (a) => a.can("VOCABULARY") },
      { href: "/admin/notifications", label: "Notifications", desc: "Push a message to every student", show: (a) => a.isAdmin },
      { href: "/admin/staff", label: "Staff access", desc: "Give moderators department access", show: (a) => a.isAdmin },
      { href: "/admin/help", label: "Admin help", desc: "How each tool works", show: () => true },
    ],
  },
];

export default function AdminHome() {
  const access = useAccess();
  const [d, setD] = React.useState<Overview | null>(null);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      setD(await api<Overview>("/admin/overview"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the overview");
    }
  }, []);

  React.useEffect(() => {
    if (access.loading || !access.isAdmin) return;
    void load();
  }, [access.loading, access.isAdmin, load]);

  const q = d?.queues;
  const attention = q
    ? [
        { n: q.openChats, label: "open support chats", href: "/admin/support-chat" },
        { n: q.openReports, label: "question error reports", href: "/admin/error-reports" },
        { n: q.pendingWithdrawals, label: `withdrawal requests (${inr(q.pendingWithdrawalsInr)})`, href: "/admin/referrals" },
        { n: q.commissionsInReview, label: "commissions held for review", href: "/admin/referrals" },
        { n: q.questionsAwaitingReview, label: "questions awaiting review", href: "/verification" },
      ].filter((x) => x.n > 0)
    : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{access.isAdmin ? "Admin dashboard" : "Staff workspace"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {access.isAdmin ? "Everything that needs you today, and every tool one click away." : "The tools your admin has opened for you are below."}
        </p>
      </div>

      {access.isAdmin && (
        <a
          href="/admin/users"
          className="group mb-6 flex items-center justify-between gap-4 rounded-2xl border border-primary/30 bg-gradient-to-r from-primary to-primary/80 p-5 text-primary-foreground shadow-lift transition hover:brightness-110 sm:p-6"
        >
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15"><Icon name="users" className="h-6 w-6" /></span>
            <div className="min-w-0">
              <p className="text-lg font-extrabold sm:text-xl">User Management</p>
              <p className="mt-0.5 text-sm text-primary-foreground/85">
                Search students · grant or cancel Premium · suspend, restore or delete accounts
                {d ? ` · ${num(d.users.total)} users${d.users.suspended ? `, ${d.users.suspended} suspended` : ""}` : ""}
              </p>
            </div>
          </div>
          <span className="hidden text-2xl transition group-hover:translate-x-1 sm:block" aria-hidden>→</span>
        </a>
      )}

      {error && access.isAdmin && (
        <div role="alert" className="card mb-5 flex flex-wrap items-center justify-between gap-3 border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          <span>{error}</span>
          <button className="btn btn-outline btn-sm" onClick={() => void load()}>Retry</button>
        </div>
      )}

      {access.isAdmin && (
        <>
          <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {d ? (
              <>
                <Kpi label="Revenue today" value={inr(d.revenue.todayInr)} sub={`${d.revenue.todayCount} payment${d.revenue.todayCount === 1 ? "" : "s"}`} tone="success" />
                <Kpi label="Last 7 days" value={inr(d.revenue.last7dInr)} sub={`${d.revenue.last7dCount} payments · 30d ${inr(d.revenue.last30dInr)}`} />
                <Kpi label="Students" value={num(d.users.total)} sub={`+${num(d.users.new7d)} this week`} tone="primary" />
                <Kpi label="Active Premium" value={num(d.users.activeSubscribers)} sub={d.users.total ? `${Math.round((d.users.activeSubscribers / d.users.total) * 1000) / 10}% of students` : undefined} />
              </>
            ) : (
              Array.from({ length: 4 }).map((_, i) => <div key={i} className="card skeleton h-[104px]" />)
            )}
          </section>

          <section aria-label="Needs attention" className="mt-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Needs attention</h2>
            {!d ? (
              <div className="card skeleton h-16" />
            ) : attention.length === 0 ? (
              <div className="card flex items-center gap-3 border-success/30 bg-success/5 px-4 py-3 text-sm">
                <span className="text-success" aria-hidden>✓</span> Nothing is waiting for you right now.
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {attention.map((a) => (
                  <a key={a.label} href={a.href} className="card card-hover flex items-center justify-between gap-3 px-4 py-3">
                    <span className="text-sm"><b className="mr-1.5 text-lg tabular-nums text-danger">{num(a.n)}</b>{a.label}</span>
                    <span className="text-muted-foreground" aria-hidden>→</span>
                  </a>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <div className="mt-8 space-y-8">
        {TOOLS.map((g) => {
          const tools = g.tools.filter((t) => t.show(access));
          if (!tools.length) return null;
          return (
            <section key={g.title}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {tools.map((t) => (
                  <a key={t.href} href={t.href} className="card card-hover block p-4">
                    <p className="font-semibold">{t.label}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{t.desc}</p>
                  </a>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {access.isAdmin && d && (
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <section className="card p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">New students</h2>
              <a href="/admin/users" className="text-sm font-medium text-primary hover:underline">All users</a>
            </div>
            <ul className="divide-y divide-border">
              {d.recentSignups.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{u.fullName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{ago(u.createdAt)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="card p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Latest payments</h2>
              <a href="/admin/pricing" className="text-sm font-medium text-primary hover:underline">Pricing</a>
            </div>
            {d.recentPayments.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">No paid orders yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {d.recentPayments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.user}</span>
                      <span className="block truncate text-xs text-muted-foreground">{p.item || (p.kind ? KIND[p.kind] ?? p.kind : "Purchase")} · {ago(p.createdAt)}</span>
                    </span>
                    <b className="shrink-0 tabular-nums text-success">{inr(p.amountInr)}</b>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
