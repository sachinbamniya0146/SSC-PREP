"use client";

import * as React from "react";

/** Pages (and all their JS/CSS) that get saved on the device after the first online visit. */
export const WARM_URLS = ["/offline", "/dashboard", "/mocks", "/question-bank", "/question-bank-practice", "/vocabulary", "/leaderboard", "/results", "/profile"];

const UID_KEY = "ssc_offline_uid";

export function swSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!swSupported()) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

async function postToSw(msg: unknown) {
  if (!swSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage(msg);
  } catch {
    /* ignore */
  }
}

export const warmPages = (urls: string[] = WARM_URLS) => postToSw({ type: "WARM", urls });

/** Drops cached per-user API data / pages (call on logout or when a different account signs in). */
export const clearUserCaches = () => postToSw({ type: "CLEAR_USER_DATA" });

/** If another account is signed in than last time, wipe the previous user's offline caches and packs. */
export async function syncOfflineOwner(): Promise<void> {
  try {
    const raw = localStorage.getItem("ssc_user");
    const uid = raw ? (JSON.parse(raw)?.id as string | undefined) : undefined;
    if (!uid) return;
    const prev = localStorage.getItem(UID_KEY);
    if (prev && prev !== uid) {
      await clearUserCaches();
      const { clearAllOfflineData } = await import("@/lib/offline-packs");
      await clearAllOfflineData();
    }
    localStorage.setItem(UID_KEY, uid);
  } catch {
    /* ignore */
  }
}

/** Live online/offline flag. */
export function useOnline(): boolean {
  const [online, setOnline] = React.useState(true);
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
  return online;
}
