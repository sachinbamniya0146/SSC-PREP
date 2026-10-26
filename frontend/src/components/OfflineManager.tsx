"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { registerServiceWorker, warmPages, warmIsDue, syncOfflineOwner, requestPersistentStorage, useOnline } from "@/lib/offline";
import { getPendingSubmits, flushPendingSubmits, pruneOfflineJunk } from "@/lib/offline-submit";

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
  const [syncingNow, setSyncingNow] = React.useState(false);
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
      pruneOfflineJunk();
      const loggedIn = !!localStorage.getItem("ssc_access_token");
      if (loggedIn) void requestPersistentStorage(); // keep packs safe when the phone runs low on space
      // saved pages: first visit, a new saved-page list, or older than a day. Only when signed in, after the page
      // is idle, and never on Data Saver.
      const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
      if (loggedIn && navigator.onLine && !conn?.saveData && warmIsDue()) {
        const run = () => void warmPages();
        const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
        if (ric) ric(run);
        else setTimeout(run, 4000);
      }
    })();
    // a new worker took over (deploy): saved pages of the old build are refreshed once
    const onSw = (e: MessageEvent) => {
      if (e.data?.type === "SW_ACTIVATED" && navigator.onLine && localStorage.getItem("ssc_access_token")) void warmPages();
    };
    if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", onSw);
    return () => {
      cancelled = true;
      if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("message", onSw);
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

  // Replay saved submits: on app open, when the network returns, when the tab becomes visible again, and every
  // minute while something is waiting. (The old code only replayed after an offline->online switch seen in the SAME
  // tab session, so a test queued, app closed, app reopened online was never sent.)
  const syncing = React.useRef(false);
  const replay = React.useCallback(async () => {
    if (syncing.current || !navigator.onLine || getPendingSubmits().length === 0) return;
    syncing.current = true;
    setPending(getPendingSubmits().length);
    setSyncingNow(true);
    try {
      await flushPendingSubmits();
    } finally {
      syncing.current = false;
      setSyncingNow(false);
      setPending(getPendingSubmits().length);
    }
  }, []);

  React.useEffect(() => {
    setPending(getPendingSubmits().length);
    void replay();
    const onVis = () => document.visibilityState === "visible" && void replay();
    document.addEventListener("visibilitychange", onVis);
    const t = window.setInterval(() => void replay(), 60000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(t);
    };
  }, [replay]);

  // connection transitions
  React.useEffect(() => {
    setPending(getPendingSubmits().length);
    if (!online) {
      setWasOffline(true);
      return;
    }
    if (wasOffline) {
      setShowBack(true);
      void replay();
      const t = setTimeout(() => setShowBack(false), 4000);
      return () => clearTimeout(t);
    }
  }, [online, wasOffline, replay]);

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
  if (pending > 0) {
    return pill(
      <>
        <span className="h-2 w-2 rounded-full bg-warning" />
        <span>
          {syncingNow ? "Syncing" : "Waiting to sync"}: {pending} saved test{pending > 1 ? "s" : ""}
        </span>
        {!syncingNow && (
          <button className="rounded-full bg-primary px-3 py-1 text-primary-foreground" onClick={() => void replay()}>
            Retry
          </button>
        )}
      </>,
      "border-warning/40 bg-card text-foreground",
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
