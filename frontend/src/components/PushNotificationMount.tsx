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
// "Not now" used to hide the prompt for ever; now it comes back after a week (the Notifications page also has a Turn on button).
const DISMISS_DAYS = 7;
function recentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at) || at < 1e12) return false; // the old permanent value "1": ask again once
    return Date.now() - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

/**
 * Mounted once in the root layout (mirrors SupportChatMount's pattern):
 *   1. Always registers the service worker (needed for installability +
 *      push), for every visitor, regardless of login state.
 *   2. For a logged-in STUDENT, ADMIN or MODERATOR who hasn't granted or
 *      permanently dismissed notification permission yet, shows a small
 *      bottom banner so they can opt in with one tap (students: admin
 *      broadcasts; staff: new question-error reports).
 * Not shown on auth pages.
 */
export function PushNotificationMount() {
  const pathname = usePathname();
  const [showBanner, setShowBanner] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [isStaff, setIsStaff] = React.useState(false);

  const hideOnThisRoute =
    pathname?.startsWith("/login") ||
    pathname?.startsWith("/signup") ||
    pathname?.startsWith("/verification");

  React.useEffect(() => {
    registerServiceWorker();
  }, []);

  React.useEffect(() => {
    if (hideOnThisRoute || !pushSupported()) return;
    if (typeof Notification === "undefined" || Notification.permission !== "default") return;
    if (recentlyDismissed()) return;

    const token = localStorage.getItem("ssc_access_token");
    if (!token) return;

    let cancelled = false;
    api<{ role: string }>("/users/me")
      .then((me) => {
        if (cancelled) return;
        // Students opt in to admin broadcasts; ADMIN/MODERATOR opt in to
        // alerts such as "a student reported a question error".
        if (me.role === "STUDENT") {
          setShowBanner(true);
        } else if (me.role === "ADMIN" || me.role === "MODERATOR") {
          setIsStaff(true);
          setShowBanner(true);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hideOnThisRoute, pathname]);

  if (!showBanner) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISSED_KEY, String(Date.now())); } catch { /* ignore */ }
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
            {isStaff
              ? "Get notified when a student reports a question error."
              : "Get notified about new mock tests, results and updates."}
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
