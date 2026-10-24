"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/dashboard", label: "Home", d: "M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z" },
  { href: "/mocks", label: "Mocks", d: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" },
  { href: "/question-bank", label: "PYQs", d: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" },
  { href: "/leaderboard", label: "Rank", d: "M18 20V10M12 20V4M6 20v-6" },
  { href: "/profile", label: "Profile", d: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" },
];

// Only on main browsing screens, never inside a test / quiz / admin screen.
const SHOW_ON = ["/dashboard", "/mocks", "/question-bank", "/leaderboard", "/profile", "/vocabulary", "/study-plan", "/weak-topics", "/referral"];

/** App-style bottom navigation for signed-in users on phones. */
export function MobileTabBar() {
  const path = usePathname() || "";
  const [signedIn, setSignedIn] = React.useState(false);

  React.useEffect(() => {
    try {
      setSignedIn(!!localStorage.getItem("ssc_access_token"));
    } catch {
      setSignedIn(false);
    }
  }, [path]);

  const visible = signedIn && SHOW_ON.some((p) => path === p || path.startsWith(p + "/")) && !path.startsWith("/question-bank-practice");

  React.useEffect(() => {
    document.body.classList.toggle("has-tabbar", visible);
    return () => document.body.classList.remove("has-tabbar");
  }, [visible]);

  if (!visible) return null;
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {tabs.map((t) => {
          const active = path === t.href || path.startsWith(t.href + "/");
          return (
            <li key={t.href}>
              <a href={t.href} aria-current={active ? "page" : undefined} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold transition ${active ? "text-primary" : "text-muted-foreground"}`}>
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round"><path d={t.d} /></svg>
                {t.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
