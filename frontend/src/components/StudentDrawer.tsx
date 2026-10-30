"use client";
/**
 * Phone menu: a left drawer with EVERY student option (the same list as the desktop left menu, lib/student-nav.ts).
 * Opened by the menu button at the top-left of the header and by the "Menu" tab of the bottom bar, both through one window event, so there is
 * a single drawer (mounted once in app/layout.tsx). Closes on a tap outside, on Escape and on every page change. Renders nothing while closed.
 */
import * as React from "react";
import { usePathname } from "next/navigation";
import { useFeatures } from "@/lib/features";
import { useT } from "@/lib/i18n";
import { useAccess } from "@/lib/permissions";
import { logoutAndClear } from "@/lib/session-cache";
import { NAV_ICONS, STUDENT_NAV, isNavItemActive } from "@/lib/student-nav";

export const OPEN_MENU_EVENT = "ssc-open-menu";

/** Ask the drawer to open (used by the header button and the bottom-bar tab). */
export function openStudentMenu() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_MENU_EVENT));
}

export function StudentDrawer() {
  const path = usePathname() || "";
  const t = useT();
  const { on } = useFeatures();
  const access = useAccess();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_MENU_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_MENU_EVENT, onOpen);
  }, []);

  React.useEffect(() => {
    setOpen(false);
  }, [path]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] md:hidden" role="dialog" aria-modal="true" aria-label={t("Menu", "Menu")}>
      <button type="button" className="absolute inset-0 bg-black/50" aria-label={t("Close menu", "Menu band karo")} onClick={() => setOpen(false)} />
      <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-border bg-card pb-[env(safe-area-inset-bottom)] shadow-xl">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <span className="text-base font-bold">{t("Menu", "Menu")}</span>
          <button type="button" className="rounded-lg px-2 py-1 text-xl leading-none text-muted-foreground hover:bg-muted" aria-label={t("Close menu", "Menu band karo")} onClick={() => setOpen(false)}>×</button>
        </div>
        <nav className="flex-1 overflow-y-auto overscroll-contain px-2 py-2" aria-label={t("Student menu", "Student menu")}>
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
          {access.isStaff && (
            <div className="mb-2">
              <ul>
                <li><a href="/admin" className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-foreground hover:bg-muted">{t("Admin", "Admin")}</a></li>
              </ul>
            </div>
          )}
        </nav>
        <div className="shrink-0 border-t border-border p-2">
          <button type="button" onClick={() => void logoutAndClear()} className="w-full rounded-lg px-3 py-3 text-left text-sm font-medium text-danger hover:bg-danger/10">
            {t("Log out", "Logout")}
          </button>
        </div>
      </aside>
    </div>
  );
}
