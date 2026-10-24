"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { registerServiceWorker, warmPages, syncOfflineOwner, useOnline } from "@/lib/offline";
import { getPendingSubmits, flushPendingSubmits } from "@/lib/offline-submit";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/**
 * Mounted once in the root layout:
 *  - registers the service worker (production builds only) and saves the main pages for offline use
 *  - shows a small status pill: offline / back online + syncing / install app
 */
export default function OfflineManager() {
  const online = useOnline();
  const path = usePathname() || "";
  const [wasOffline, setWasOffline] = React.useState(false);
  const [showBack, setShowBack] = React.useState(false);
  const [pending, setPending] = React.useState(0);
  const [install, setInstall] = React.useState<InstallEvent | null>(null);
  const [installDismissed, setInstallDismissed] = React.useState(true);

  // register + warm (production only: the dev server has no stable asset URLs)
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    let cancelled = false;
    (async () => {
      const reg = await registerServiceWorker();
      if (!reg || cancelled) return;
      await syncOfflineOwner();
      const loggedIn = !!localStorage.getItem("ssc_access_token");
      const last = Number(localStorage.getItem("ssc_warm_at") || 0);
      // once a day, after the page is idle, only on a decent connection and when signed in
      const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
      if (loggedIn && !conn?.saveData && Date.now() - last > 24 * 3600 * 1000) {
        const run = () => {
          warmPages();
          try {
            localStorage.setItem("ssc_warm_at", String(Date.now()));
          } catch {
            /* ignore */
          }
        };
        const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
        if (ric) ric(run);
        else setTimeout(run, 4000);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // install prompt
  React.useEffect(() => {
    try {
      setInstallDismissed(localStorage.getItem("ssc_install_dismissed") === "1");
    } catch {
      /* ignore */
    }
    const h = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", h);
    window.addEventListener("appinstalled", () => setInstall(null));
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  // connection transitions
  React.useEffect(() => {
    setPending(getPendingSubmits().length);
    if (!online) {
      setWasOffline(true);
      return;
    }
    if (wasOffline) {
      setShowBack(true);
      void flushPendingSubmits().finally(() => setPending(getPendingSubmits().length));
      const t = setTimeout(() => setShowBack(false), 4000);
      return () => clearTimeout(t);
    }
  }, [online, wasOffline]);

  // never cover the exam screen
  if (path.startsWith("/test") || path.startsWith("/cgl-test") || path === "/offline") return null;

  const pill = (children: React.ReactNode, tone: string) => (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[60] flex justify-center px-4 lg:bottom-5">
      <div role="status" className={`animate-pop pointer-events-auto flex max-w-md items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold shadow-lift ${tone}`}>
        {children}
      </div>
    </div>
  );

  if (!online) {
    return pill(
      <>
        <span className="h-2 w-2 rounded-full bg-warning" />
        <span>Offline mode: saved pages and downloaded packs work.</span>
        <a href="/offline" className="underline">Practice offline</a>
      </>,
      "border-warning/40 bg-card text-foreground",
    );
  }
  if (showBack) {
    return pill(
      <>
        <span className="h-2 w-2 rounded-full bg-success" />
        <span>Back online{pending > 0 ? `: syncing ${pending} saved test${pending > 1 ? "s" : ""}…` : ""}</span>
      </>,
      "border-success/40 bg-card text-foreground",
    );
  }
  if (install && !installDismissed && path === "/dashboard") {
    return pill(
      <>
        <span>Install SSC PrepHub as an app</span>
        <button
          className="rounded-full bg-primary px-3 py-1 text-primary-foreground"
          onClick={async () => {
            await install.prompt();
            setInstall(null);
          }}
        >
          Install
        </button>
        <button
          aria-label="Dismiss"
          className="px-1 text-muted-foreground"
          onClick={() => {
            setInstallDismissed(true);
            try {
              localStorage.setItem("ssc_install_dismissed", "1");
            } catch {
              /* ignore */
            }
          }}
        >
          ✕
        </button>
      </>,
      "border-primary/30 bg-card text-foreground",
    );
  }
  return null;
}
