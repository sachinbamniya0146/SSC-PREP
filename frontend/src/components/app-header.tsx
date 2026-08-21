"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeContext } from "@/components/theme-provider";

interface AppHeaderProps {
  title?: string;
  showSupport?: boolean;
}

export function AppHeader({ title, showSupport = true }: AppHeaderProps) {
  const { theme, toggleTheme } = React.useContext(ThemeContext);
  const pathname = usePathname();
  const [user, setUser] = React.useState<{ fullName: string; email: string } | null>(null);

  React.useEffect(() => {
    const raw = localStorage.getItem("ssc_user");
    if (raw) {
      try {
        setUser(JSON.parse(raw));
      } catch {
        /* ignore */
      }
    }
  }, []);

  const navItems = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/question-bank", label: "Question Bank" },
    { href: "/mocks", label: "Mock Tests" },
    { href: "/weak-topics", label: "Weak Topics" },
    { href: "/weak-practice", label: "Weak Practice" },
    { href: "/leaderboard", label: "Leaderboard" },
    { href: "/study-plan", label: "Study Plan" },
    { href: "/achievements", label: "Achievements" },
    { href: "/referral", label: "Refer & Earn" },
    { href: "/support", label: "Support" },
  ];

  const isActive = (href: string) => pathname === href || (href !== "/dashboard" && pathname.startsWith(href));

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/dashboard" className="text-lg font-bold">
          SSC<span className="text-primary">PrepHub</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                isActive(item.href)
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {showSupport && (
            <Link
              href="/support"
              className="hidden sm:flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
            >
              🎧 Support
            </Link>
          )}

          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="rounded-lg border border-border p-2 text-sm"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>

          {user ? (
            <div className="flex items-center gap-2">
              <span className="hidden sm:block text-sm font-medium">{user.fullName}</span>
              <Link
                href="/login"
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold hover:bg-muted"
                onClick={() => {
                  localStorage.clear();
                }}
              >
                Logout
              </Link>
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Login
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

export function SimpleHeader({ title }: { title?: string }) {
  const { theme, toggleTheme } = React.useContext(ThemeContext);
  const pathname = usePathname();
  const [user, setUser] = React.useState<{ fullName: string; email: string } | null>(null);

  React.useEffect(() => {
    const raw = localStorage.getItem("ssc_user");
    if (raw) {
      try {
        setUser(JSON.parse(raw));
      } catch {
        /* ignore */
      }
    }
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
        <Link href="/dashboard" className="text-lg font-bold">
          SSC<span className="text-primary">PrepHub</span>
        </Link>

        <div className="flex items-center gap-3 text-sm">
          <Link
            href="/support"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            🎧 Support
          </Link>

          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="rounded-lg border border-border p-2 text-sm"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>

          {user ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="hidden font-medium sm:block">{user.fullName}</span>
              <Link
                href="/login"
                className="rounded-lg border border-border px-4 py-2 font-semibold hover:bg-muted"
                onClick={() => {
                  localStorage.clear();
                }}
              >
                Logout
              </Link>
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground hover:opacity-90"
            >
              Login
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}