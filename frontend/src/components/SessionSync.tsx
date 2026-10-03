"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { syncSessionUser } from "@/lib/permissions";
import { ensureFreshToken } from "@/lib/api";

/**
 * Keeps localStorage("ssc_user") (role + staff permissions) in step with the
 * server: on first load, on page navigation (max once a minute — this also
 * covers "just logged in"), when the tab regains focus, and every 5 minutes.
 * Renders nothing.
 */
export default function SessionSync() {
  const pathname = usePathname();
  const last = React.useRef(0);

  const run = React.useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - last.current < 60_000) return;
    last.current = now;
    syncSessionUser();
  }, []);

  React.useEffect(() => {
    run();
  }, [pathname, run]);

  React.useEffect(() => {
    const onFocus = () => {
      void ensureFreshToken(); // tab was asleep -> renew before the first click
      run(true);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const t = setInterval(() => {
      void ensureFreshToken();
      run(true);
    }, 4 * 60 * 1000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(t);
    };
  }, [run]);

  return null;
}
