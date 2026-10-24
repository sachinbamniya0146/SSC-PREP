"use client";

import * as React from "react";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

const links = [
  { href: "/#exams", label: "Exams" },
  { href: "/mocks", label: "Mock Tests" },
  { href: "/question-bank", label: "PYQ Bank" },
  { href: "/vocabulary", label: "Vocabulary" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/#pricing", label: "Pricing" },
];

/**
 * Shared public header (home, login, signup). Sticky, blurred, responsive
 * with a slide-down mobile menu. Reads the stored token to switch between
 * "Login / Sign up" and "Dashboard".
 */
export function SiteHeader({ minimal = false }: { minimal?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [loggedIn, setLoggedIn] = React.useState(false);

  React.useEffect(() => {
    try {
      setLoggedIn(!!localStorage.getItem("ssc_access_token"));
    } catch {
      /* private mode */
    }
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-xl">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <a href="/" className="shrink-0" aria-label="SSC PrepHub home">
          <Logo />
        </a>

        {!minimal && (
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                {l.label}
              </a>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {loggedIn ? (
            <a href="/dashboard" className="btn btn-primary">
              Dashboard
            </a>
          ) : (
            <>
              <a href="/login" className="btn btn-ghost hidden sm:inline-flex">
                Login
              </a>
              <a href="/signup" className="btn btn-primary">
                Sign up
              </a>
            </>
          )}
          {!minimal && (
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
          )}
        </div>
      </div>

      {!minimal && open && (
        <nav className="border-t border-border bg-background lg:hidden" aria-label="Mobile">
          <div className="container-page flex flex-col py-2">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-3 text-sm font-medium hover:bg-muted"
              >
                {l.label}
              </a>
            ))}
            {!loggedIn && (
              <a href="/login" className="rounded-lg px-3 py-3 text-sm font-medium hover:bg-muted sm:hidden">
                Login
              </a>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
