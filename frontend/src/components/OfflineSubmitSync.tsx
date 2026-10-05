"use client";
import * as React from "react";
import { flushPendingSubmits, getPendingSubmits } from "@/lib/offline-submit";

/**
 * Mounted once in the root layout. If a test finished while the student was offline and the tab/app was closed
 * before the queue could be sent, this sends it the next time the app opens or the network returns.
 */
export default function OfflineSubmitSync() {
  React.useEffect(() => {
    const run = () => {
      if (getPendingSubmits().length) void flushPendingSubmits();
    };
    run();
    window.addEventListener("online", run);
    const t = window.setInterval(run, 30000);
    return () => {
      window.removeEventListener("online", run);
      window.clearInterval(t);
    };
  }, []);
  return null;
}
