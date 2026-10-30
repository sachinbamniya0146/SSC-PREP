"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useFeatures } from "@/lib/features";
import { useT } from "@/lib/i18n";
import { NAV_ICONS, STUDENT_NAV, isNavItemActive, isSidebarRoute } from "@/lib/student-nav";

const tabs = [
  { href: "/dashboard", label: "Home", d: "M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z" },
  { href: "/mocks", label: "Mocks", d: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" },
  { href: "/question-bank", label: "PYQs", d: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" },
  { href: "/leaderboard", label: "Rank", d: "M18 20V10M12 20V4M6 20v-6" },
];
const MENU_D = "M4 6h16M4 12h16M4 18h16";

// Same screens as the desktop left menu (lib/student-nav.ts), so every menu page also has the phone menu; never inside a test / quiz / admin screen.

/** App-style bottom navigation for signed-in users on phones. */
export function MobileTabBar() {
  const path = usePathname() || "";
  const t = useT();
  const { on } = useFeatures();
  const [signedIn, setSignedIn] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    try {
      setSignedIn(!!localStorage.getItem("ssc_access_token"));
    } catch {
      setSignedIn(false);
    }
  }, [path]);

  const visible = signedIn && isSidebarRoute(path) && !path.startsWith("/question-bank-practice");

  // the drawer closes on every page change and on Escape
  React.useEffect(() => {
    setOpen(false);
  }, [path]);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  React.useEffect(() => {
    document.body.classList.toggle("has-tabbar", visible);
    return () => document.body.classList.remove("has-tabbar");
  }, [visible]);

  if (!visible) return null;
  return (
    <>
    {open && (
      <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={t("Menu", "Menu")}>
        <button type="button" className="absolute inset-0 bg-black/50" aria-label={t("Close menu", "Menu band karo")} onClick={() => setOpen(false)} />
        <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-border bg-card pb-[env(safe-area-inset-bottom)] shadow-xl">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
            <span className="text-base font-bold">{t("Menu", "Menu")}</span>
            <button type="button" className="rounded-lg px-2 py-1 text-xl leading-none text-muted-foreground hover:bg-muted" aria-label={t("Close menu", "Menu band karo")} onClick={() => setOpen(false)}>×</button>
          </div>
          <nav className="flex-1 px-2 py-2" aria-label={t("Student menu", "Student menu")}>
            {STUDENT_NAV.map((group) => {
              const items = group.items.filter((i) => !i.flag || on(i.flag));
              if (items.length === 0) return null;
              return (
                <div key={group.id} className="mb-2">
                  <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t(group.en, group.hi)}</p>
                  <ul className="space-y-0.5">
                    {items.map((item) => {
                      const active = isNavItemActive(item, path);
                      return (
                        <li key={item.href}>
                          <a
                            href={item.href}
                            aria-current={active ? "page" : undefined}
                            className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium ${active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"}`}
                          >
                            <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={NAV_ICONS[item.icon]} /></svg>
                            <span className="truncate">{t(item.en, item.hi)}</span>
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </nav>
        </aside>
      </div>
    )}
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {tabs.map((tab) => {
          const active = path === tab.href || path.startsWith(tab.href + "/");
          return (
            <li key={tab.href}>
              <a href={tab.href} aria-current={active ? "page" : undefined} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold transition ${active ? "text-primary" : "text-muted-foreground"}`}>
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round"><path d={tab.d} /></svg>
                {tab.label}
              </a>
            </li>
          );
        })}
        <li>
          <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className="flex w-full flex-col items-center gap-0.5 py-2 text-[11px] font-semibold text-muted-foreground transition">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={MENU_D} /></svg>
            {t("Menu", "Menu")}
          </button>
        </li>
      </ul>
    </nav>
    </>
  );
}
