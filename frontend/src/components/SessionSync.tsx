"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { syncSessionUser } from "@/lib/permissions";

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
    const onFocus = () => run(true);
    window.addEventListener("focus", onFocus);
    const t = setInterval(() => run(true), 5 * 60 * 1000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(t);
    };
  }, [run]);

  return null;
}
