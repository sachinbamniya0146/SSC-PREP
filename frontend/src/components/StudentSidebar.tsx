"use client";
/**
 * Left-side menu for signed-in students on tablets and desktops (the admin console already has its own sidebar).
 * Phones (< 768 px) keep the bottom tab bar (MobileTabBar); the two never show together.
 *
 * - Mounted once in app/layout.tsx. The markup is always rendered (so there is no flash on slow phones); CSS in
 *   globals.css shows it only when <html> has `has-sidebar`, which the boot script in <head> sets before the first paint
 *   and this component keeps in step after hydration. That also reserves the space on the left, so the page does not jump.
 * - Collapsible: full menu on desktop, icon rail on tablets by default; the student's choice is remembered.
 * - Never rendered on test / quiz / result screens (see SIDEBAR_ROUTES in lib/student-nav.ts).
 * - Items follow the feature controller (a switched-off feature disappears) and the UI language (English / Hinglish).
 */
import * as React from "react";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";
import { useFeatures } from "@/lib/features";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/api";
import {
  NAV_ICONS,
  RAIL_BELOW_PX,
  SIDEBAR_PREF_KEY,
  STUDENT_NAV,
  isNavItemActive,
  isSidebarRoute,
  type NavIconName,
} from "@/lib/student-nav";

function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={NAV_ICONS[name]} />
    </svg>
  );
}

export function StudentSidebar() {
  const path = usePathname() || "";
  const t = useT();
  const { on } = useFeatures();
  const [rail, setRail] = React.useState(false);
  const [unread, setUnread] = React.useState(0);

  // Keep <html class="has-sidebar sidebar-rail"> right for this route / window size (the boot script did the first pass).
  const apply = React.useCallback(() => {
    const d = document.documentElement;
    let signedIn = false;
    let pref: string | null = null;
    try {
      signedIn = !!localStorage.getItem("ssc_access_token");
      pref = localStorage.getItem(SIDEBAR_PREF_KEY);
    } catch {
      /* private mode: no saved choice, default by width */
    }
    const show = signedIn && isSidebarRoute(path);
    const r = pref ? pref === "rail" : window.innerWidth < RAIL_BELOW_PX;
    d.classList.toggle("has-sidebar", show);
    d.classList.toggle("sidebar-rail", show && r);
    setRail(r);
  }, [path]);

  React.useEffect(() => {
    apply();
    window.addEventListener("resize", apply);
    window.addEventListener("storage", apply);
    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("storage", apply);
    };
  }, [apply]);

  // unread count for the Notifications item; quiet on failure (the badge just stays hidden)
  React.useEffect(() => {
    let live = true;
    try {
      if (!localStorage.getItem("ssc_access_token") || !isSidebarRoute(path)) return;
    } catch {
      return;
    }
    api<{ unread?: number }>("/notifications/unread-count")
      .then((d) => { if (live) setUnread(Number(d?.unread) || 0); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [path]);

  const toggle = () => {
    const next = !rail;
    try {
      localStorage.setItem(SIDEBAR_PREF_KEY, next ? "rail" : "full");
    } catch {
      /* ignore */
    }
    document.documentElement.classList.toggle("sidebar-rail", next);
    setRail(next);
  };

  return (
    <aside id="student-sidebar" className="student-sidebar fixed inset-y-0 left-0 z-40 flex-col border-r border-border bg-card" aria-label={t("Student menu", "Student menu")}>
      <div className="sb-head flex h-16 shrink-0 items-center border-b border-border px-4">
        <a href="/dashboard" aria-label={t("Dashboard", "Dashboard")} className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">
          <span className="sb-logo-full">
            <Logo size={32} />
          </span>
          <span className="sb-logo-rail">
            <Logo size={32} withWordmark={false} />
          </span>
        </a>
      </div>

      <nav className="flex-1 overflow-y-auto overscroll-contain px-2 py-2" aria-label={t("Main menu", "Main menu")}>
        {STUDENT_NAV.map((group, gi) => {
          const items = group.items.filter((i) => !i.flag || on(i.flag));
          if (items.length === 0) return null;
          return (
            <div key={group.id} className={gi === 0 ? "" : "mt-2"}>
              <p className="sb-label px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t(group.en, group.hi)}</p>
              {gi > 0 && <div className="sb-divider mx-3 my-2 h-px bg-border" aria-hidden />}
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = isNavItemActive(item, path);
                  const label = t(item.en, item.hi);
                  return (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        title={label}
                        aria-label={label}
                        aria-current={active ? "page" : undefined}
                        className={`sb-link flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
                          active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        <NavIcon name={item.icon} />
                        <span className="sb-label truncate">{label}</span>
                        {item.href === "/notifications" && unread > 0 && (
                          <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary-foreground" aria-label={`${unread} unread`}>
                            {unread > 99 ? "99+" : unread}
                          </span>
                        )}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-border p-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!rail}
          aria-controls="student-sidebar"
          aria-label={rail ? t("Expand menu", "Menu kholo") : t("Collapse menu", "Menu chhota karo")}
          title={rail ? t("Expand menu", "Menu kholo") : t("Collapse menu", "Menu chhota karo")}
          className="sb-link flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <svg className="sb-chevron h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span className="sb-label truncate">{t("Collapse", "Chhota karo")}</span>
        </button>
      </div>
    </aside>
  );
}
