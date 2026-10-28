"use client";
/**
 * Admin console frame: one sidebar for every /admin page (drawer on phones), a slim top bar, live badges for the
 * queues that need a human, and the User Management entry as a big button at the top of the menu.
 *
 * Permission model is unchanged: ADMIN sees everything, MODERATOR only the departments granted to them
 * (see lib/permissions.ts). Each page still enforces its own access.
 */
import * as React from "react";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { API_BASE, fetchAuth } from "@/lib/api";
import { logoutAndClear } from "@/lib/session-cache";
import { useAccess, type Access } from "@/lib/permissions";

type IconName =
  | "home" | "users" | "bell" | "chat" | "flag" | "tag" | "gift" | "upload" | "plus" | "list" | "check" | "copy"
  | "book" | "layers" | "grid" | "clock" | "cal" | "download" | "shield" | "help" | "target" | "award";

const ICONS: Record<IconName, string> = {
  home: "M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  flag: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7",
  tag: "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01",
  gift: "M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  plus: "M12 5v14M5 12h14",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  check: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  copy: "M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z",
  layers: "M12 2l10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  cal: "M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM16 2v4M8 2v4M3 10h18",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01",
  target: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  award: "M12 15a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM8.21 13.89L7 23l5-3 5 3-1.21-9.12",
};

export function Icon({ name, className = "h-[18px] w-[18px]" }: { name: IconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

type Badge = "chats" | "reports" | "withdrawals" | "commissions" | "review";
type Item = { href: string; label: string; icon: IconName; show: (a: Access) => boolean; badge?: Badge };
type Group = { title: string; items: Item[] };

const admin = (a: Access) => a.isAdmin;
const questions = (a: Access) => a.can("QUESTIONS");
const anyQuestions = (a: Access) => a.can("QUESTIONS") || a.can("PRACTICE");

export const ADMIN_NAV: Group[] = [
  {
    title: "Students & support",
    items: [
      { href: "/admin/users", label: "Users", icon: "users", show: admin },
      { href: "/admin/support-chat", label: "Support chat", icon: "chat", show: (a) => a.can("SUPPORT"), badge: "chats" },
      { href: "/admin/error-reports", label: "Error reports", icon: "flag", show: (a) => a.can("SUPPORT"), badge: "reports" },
      { href: "/admin/notifications", label: "Notifications", icon: "bell", show: admin },
    ],
  },
  {
    title: "Money",
    items: [
      { href: "/admin/pricing", label: "Pricing & coupons", icon: "tag", show: admin },
      { href: "/admin/referrals", label: "Refer & Earn", icon: "gift", show: admin, badge: "withdrawals" },
      { href: "/admin/uploads", label: "Plans & bulk upload", icon: "upload", show: anyQuestions },
    ],
  },
  {
    title: "Question bank",
    items: [
      { href: "/admin/questions/add", label: "Add a question", icon: "plus", show: anyQuestions },
      { href: "/admin/questions/manage", label: "Question manager", icon: "list", show: questions },
      { href: "/verification", label: "Review queue", icon: "check", show: questions, badge: "review" },
      { href: "/admin/questions/review", label: "Upload review", icon: "shield", show: questions },
      { href: "/admin/questions/duplicates", label: "Duplicates", icon: "copy", show: questions },
      { href: "/admin/chapters", label: "Chapters", icon: "book", show: questions },
      { href: "/admin/topics", label: "Topics", icon: "layers", show: questions },
      { href: "/admin/duplicate-topics", label: "Duplicate topics", icon: "copy", show: questions },
      { href: "/admin/coverage", label: "Coverage", icon: "target", show: questions },
    ],
  },
  {
    title: "Exams & papers",
    items: [
      { href: "/admin/exams", label: "Exams", icon: "award", show: admin },
      { href: "/admin/patterns", label: "Exam patterns", icon: "grid", show: admin },
      { href: "/admin/pyq-papers", label: "PYQ papers", icon: "cal", show: admin },
      { href: "/admin/pyq-dates", label: "PYQ date mapping", icon: "clock", show: admin },
      { href: "/admin/pyq-export", label: "PYQ export", icon: "download", show: questions },
    ],
  },
  {
    title: "Learning content",
    items: [{ href: "/admin/vocab", label: "Vocabulary", icon: "book", show: (a) => a.can("VOCABULARY") }],
  },
  {
    title: "Team",
    items: [
      { href: "/admin/staff", label: "Staff access", icon: "shield", show: admin },
      { href: "/admin/help", label: "Admin help", icon: "help", show: () => true },
    ],
  },
];

/** Live counts for the sidebar badges. Quiet on failure: a badge just stays hidden. */
function useBadges(access: Access): Partial<Record<Badge, number>> {
  const [b, setB] = React.useState<Partial<Record<Badge, number>>>({});
  React.useEffect(() => {
    if (access.loading || !access.isStaff) return;
    let cancelled = false;
    const load = async () => {
      const next: Partial<Record<Badge, number>> = {};
      try {
        if (access.isAdmin) {
          const r = await fetchAuth(`${API_BASE}/admin/overview`);
          if (r.ok) {
            const d = await r.json();
            next.chats = d.queues?.openChats ?? 0;
            next.reports = d.queues?.openReports ?? 0;
            next.withdrawals = (d.queues?.pendingWithdrawals ?? 0) + (d.queues?.commissionsInReview ?? 0);
            next.review = d.queues?.questionsAwaitingReview ?? 0;
          }
        } else if (access.can("SUPPORT")) {
          const [c, rp] = await Promise.all([
            fetchAuth(`${API_BASE}/support-chat/admin/inbox?status=OPEN`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
            fetchAuth(`${API_BASE}/report-error/category-stats`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
          ]);
          const list = Array.isArray(c?.conversations) ? c.conversations : Array.isArray(c) ? c : [];
          next.chats = list.length;
          next.reports = Array.isArray(rp?.byCategory) ? rp.byCategory.reduce((s: number, x: { open?: number }) => s + (x.open ?? 0), 0) : 0;
        }
      } catch {
        /* keep previous */
      }
      if (!cancelled) setB(next);
    };
    void load();
    const id = window.setInterval(load, 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.loading, access.isAdmin, access.isStaff]);
  return b;
}

function NavLinks({ access, path, badges, onNavigate }: { access: Access; path: string; badges: Partial<Record<Badge, number>>; onNavigate?: () => void }) {
  const isActive = (href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(href + "/"));
  return (
    <nav aria-label="Admin" className="flex-1 overflow-y-auto px-3 pb-6">
      <a
        href="/admin"
        onClick={onNavigate}
        aria-current={path === "/admin" ? "page" : undefined}
        className={`mb-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
          path === "/admin" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        <Icon name="home" /> Dashboard
      </a>
      {ADMIN_NAV.map((g) => {
        const items = g.items.filter((i) => i.show(access));
        if (!items.length) return null;
        return (
          <div key={g.title} className="mt-5">
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">{g.title}</p>
            {items.map((i) => {
              const active = isActive(i.href);
              const n = i.badge ? badges[i.badge] ?? 0 : 0;
              return (
                <a
                  key={i.href}
                  href={i.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon name={i.icon} />
                  <span className="min-w-0 flex-1 truncate">{i.label}</span>
                  {n > 0 && (
                    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-bold text-danger-foreground">
                      {n > 99 ? "99+" : n}
                    </span>
                  )}
                </a>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

function Sidebar({ access, path, badges, onNavigate }: { access: Access; path: string; badges: Partial<Record<Badge, number>>; onNavigate?: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-16 shrink-0 items-center gap-2 px-5">
        <a href="/admin" aria-label="Admin home" onClick={onNavigate}>
          <Logo size={30} />
        </a>
        <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">Admin</span>
      </div>

      {access.isAdmin && (
        <div className="px-3 pb-4">
          <a
            href="/admin/users"
            onClick={onNavigate}
            className="flex items-center justify-center gap-2.5 rounded-xl bg-primary px-4 py-3 text-[15px] font-bold text-primary-foreground shadow-md transition hover:brightness-110 active:scale-[0.99]"
          >
            <Icon name="users" className="h-5 w-5" /> User Management
          </a>
        </div>
      )}

      <NavLinks access={access} path={path} badges={badges} onNavigate={onNavigate} />

      <div className="shrink-0 border-t border-border p-3">
        <a href="/dashboard" className="mb-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
          <Icon name="home" /> View student site
        </a>
        <button
          type="button"
          onClick={() => void logoutAndClear()}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
          Sign out
        </button>
      </div>
    </div>
  );
}

function currentSection(path: string): string {
  if (path === "/admin") return "Dashboard";
  for (const g of ADMIN_NAV) for (const i of g.items) if (path === i.href || path.startsWith(i.href + "/")) return i.label;
  return "Admin";
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "";
  const access = useAccess();
  const badges = useBadges(access);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => setOpen(false), [path]);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  // not signed in -> login (the API would 401 anyway)
  React.useEffect(() => {
    try {
      if (!localStorage.getItem("ssc_access_token")) window.location.href = "/login?expired=1";
    } catch {
      /* ignore */
    }
  }, []);

  if (!access.loading && !access.isStaff) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-center">
        <div className="card max-w-sm p-8">
          <p className="text-lg font-bold">Admin access only</p>
          <p className="mt-2 text-sm text-muted-foreground">This area is for SSC Prep Hub staff. If you should have access, ask an admin to enable it for your email.</p>
          <a href="/dashboard" className="btn btn-primary mt-5">Back to dashboard</a>
        </div>
      </div>
    );
  }

  const totalBadges = Object.values(badges).reduce((s, n) => s + (n ?? 0), 0);

  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[272px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen border-r border-border bg-card lg:block" aria-label="Admin menu">
        <Sidebar access={access} path={path} badges={badges} />
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col">
        <div className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open admin menu"
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card lg:hidden"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            {totalBadges > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-danger" aria-hidden />}
          </button>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">
            <span className="text-muted-foreground">Admin</span>
            <span className="mx-1.5 text-muted-foreground/60">/</span>
            {currentSection(path)}
          </p>
          {access.isAdmin && (
            <a href="/admin/users" className="btn btn-primary btn-sm hidden sm:inline-flex lg:hidden">
              <Icon name="users" className="h-4 w-4" /> Users
            </a>
          )}
          <ThemeToggle />
        </div>

        <div className="admin-content min-w-0 flex-1">{children}</div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Admin menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative h-full w-[84%] max-w-[300px] border-r border-border bg-card shadow-xl">
            <Sidebar access={access} path={path} badges={badges} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
