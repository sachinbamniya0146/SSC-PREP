"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import {
  pushSupported,
  registerServiceWorker,
  subscribeToPush,
} from "@/lib/push";

const DISMISSED_KEY = "ssc_push_prompt_dismissed";

/**
 * Mounted once in the root layout (mirrors SupportChatMount's pattern):
 *   1. Always registers the service worker (needed for installability +
 *      push), for every visitor, regardless of login state.
 *   2. For a logged-in STUDENT who hasn't granted or permanently dismissed
 *      notification permission yet, shows a small bottom banner so they can
 *      opt in to admin broadcast notifications with one tap.
 * Not shown on auth pages or inside /admin (staff enable it from their own
 * settings, not via a student-facing banner).
 */
export function PushNotificationMount() {
  const pathname = usePathname();
  const [showBanner, setShowBanner] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const hideOnThisRoute =
    pathname?.startsWith("/login") ||
    pathname?.startsWith("/signup") ||
    pathname?.startsWith("/admin") ||
    pathname?.startsWith("/verification");

  React.useEffect(() => {
    registerServiceWorker();
  }, []);

  React.useEffect(() => {
    if (hideOnThisRoute || !pushSupported()) return;
    if (typeof Notification === "undefined" || Notification.permission !== "default") return;
    if (localStorage.getItem(DISMISSED_KEY)) return;

    const token = localStorage.getItem("ssc_access_token");
    if (!token) return;

    let cancelled = false;
    api<{ role: string }>("/users/me")
      .then((me) => {
        if (!cancelled && me.role === "STUDENT") setShowBanner(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hideOnThisRoute, pathname]);

  if (!showBanner) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setShowBanner(false);
  };

  const enable = async () => {
    setBusy(true);
    const result = await subscribeToPush().catch(() => "denied" as const);
    setBusy(false);
    // Whatever the outcome (granted, denied, or dismissed by the OS
    // prompt), don't ask again this session/device — the OS prompt itself
    // won't re-fire until the user resets site permissions anyway.
    dismiss();
    void result;
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]">
      <div className="flex w-full max-w-md items-center gap-3 rounded-2xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur-lg">
        <span className="text-2xl">🔔</span>
        <div className="flex-1 text-sm">
          <p className="font-semibold">Turn on notifications</p>
          <p className="text-muted-foreground">
            Get notified about new mock tests, results and updates.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <button
            onClick={enable}
            disabled={busy}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy ? "..." : "Enable"}
          </button>
          <button
            onClick={dismiss}
            className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
