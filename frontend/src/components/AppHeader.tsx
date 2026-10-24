"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { clearUserCaches } from "@/lib/offline";

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/mocks", label: "Mock Tests" },
  { href: "/question-bank", label: "PYQ Bank" },
  { href: "/question-bank-practice", label: "Practice" },
  { href: "/vocabulary", label: "Vocabulary" },
  { href: "/leaderboard", label: "Leaderboard" },
];

/** Header for signed-in student pages: nav, theme switch and account menu. */
export function AppHeader({ name }: { name?: string }) {
  const path = usePathname() || "";
  const [open, setOpen] = React.useState(false);
  const [menu, setMenu] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);
  const initials = (name || "S").trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  React.useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const logout = () => {
    void clearUserCaches();
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-xl">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-8">
          <a href="/dashboard" aria-label="Dashboard">
            <Logo size={32} />
          </a>
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
            {nav.map((l) => {
              const active = path === l.href || (l.href !== "/dashboard" && path.startsWith(l.href + "/"));
              return (
                <a
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                    active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {l.label}
                </a>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <div className="relative" ref={ref}>
            <button
              type="button"
              onClick={() => setMenu((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menu}
              className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card pl-1 pr-2.5 text-sm font-medium transition hover:bg-muted"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
                {initials}
              </span>
              <span className="hidden max-w-[8rem] truncate sm:block">{name || "Student"}</span>
              <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {menu && (
              <div role="menu" className="animate-pop absolute right-0 mt-2 w-52 overflow-hidden rounded-xl border border-border bg-card p-1 shadow-lift">
                {[
                  { href: "/profile", label: "My profile" },
                  { href: "/premium", label: "Premium plans" },
                  { href: "/referral", label: "Refer & earn" },
                  { href: "/offline", label: "Offline practice" },
                  { href: "/settings/telegram", label: "Telegram" },
                ].map((i) => (
                  <a key={i.href} href={i.href} role="menuitem" className="block rounded-lg px-3 py-2 text-sm hover:bg-muted">
                    {i.label}
                  </a>
                ))}
                <div className="my-1 h-px bg-border" />
                <a href="/login" role="menuitem" onClick={logout} className="block rounded-lg px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10">
                  Logout
                </a>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
            aria-expanded={open}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card lg:hidden"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-border bg-background lg:hidden" aria-label="Mobile">
          <div className="container-page grid grid-cols-2 gap-1 py-2">
            {nav.map((l) => (
              <a key={l.href} href={l.href} className="rounded-lg px-3 py-3 text-sm font-medium hover:bg-muted">
                {l.label}
              </a>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
