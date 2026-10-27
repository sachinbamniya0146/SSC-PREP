"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { getPendingSubmits, flushPendingSubmits, pruneStaleAttemptData } from "@/lib/submit-queue";
import { purgeLegacyOfflineDataOnce } from "@/lib/session-cache";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/**
 * Mounted once in the root layout. It is deliberately small:
 *  - sends a finished test that could not reach the server (internet dropped while submitting) as soon as the net returns
 *  - shows a status pill: no connection / back online + syncing / waiting to sync
 *  - offers "Install app" on the dashboard
 *  - one-time clean-up of data left by the removed offline-practice feature
 * (There is no offline browsing: pages and questions always load from the server.)
 */
export default function AppStatus() {
  const path = usePathname() || "";
  const [online, setOnline] = React.useState(true);
  const [wasOffline, setWasOffline] = React.useState(false);
  const [showBack, setShowBack] = React.useState(false);
  const [pending, setPending] = React.useState(0);
  const [syncingNow, setSyncingNow] = React.useState(false);
  const [install, setInstall] = React.useState<InstallEvent | null>(null);
  const [installDismissed, setInstallDismissed] = React.useState(true);

  React.useEffect(() => {
    void purgeLegacyOfflineDataOnce();
    pruneStaleAttemptData();
  }, []);

  // connectivity
  React.useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
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
    const done = () => setInstall(null);
    window.addEventListener("beforeinstallprompt", h);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", h);
      window.removeEventListener("appinstalled", done);
    };
  }, []);

  // Replay saved submits: on app open, when the network returns, when the tab becomes visible again, and every
  // minute while something is waiting.
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

  // never cover the exam screen (it has its own banners)
  if (path.startsWith("/test") || path.startsWith("/cgl-test")) return null;

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
        <span>Internet nahi hai. Connection wapas aane par page refresh karein.</span>
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
