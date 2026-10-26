"use client";

import * as React from "react";

/** Pages (and all their JS/CSS) that get saved on the device after the first online visit. */
export const WARM_URLS = [
  "/offline",
  "/dashboard",
  "/mocks",
  "/test", // the exam screen itself: /test?template=X falls back to this saved shell offline
  "/sectional",
  "/year-wise",
  "/question-bank",
  "/question-bank-practice",
  "/review",
  "/weak-topics",
  "/study-plan",
  "/vocabulary",
  "/leaderboard",
  "/results",
  "/profile",
];

/** Bump when the saved-page list changes: forces one fresh warm on the next visit. */
export const WARM_VERSION = "3";
const WARM_AT_KEY = "ssc_warm_at";
const WARM_VER_KEY = "ssc_warm_ver";

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

/** Sends a message to the worker and collects its replies (progress + final) until `isFinal` returns true. */
function askSw<T extends { type: string }>(msg: unknown, isFinal: (m: T) => boolean, onMessage?: (m: T) => void, timeoutMs = 120000): Promise<T | null> {
  return new Promise((resolve) => {
    if (!swSupported()) return resolve(null);
    navigator.serviceWorker.ready
      .then((reg) => {
        if (!reg.active) return resolve(null);
        const ch = new MessageChannel();
        const t = setTimeout(() => resolve(null), timeoutMs);
        ch.port1.onmessage = (e: MessageEvent<T>) => {
          onMessage?.(e.data);
          if (isFinal(e.data)) {
            clearTimeout(t);
            resolve(e.data);
          }
        };
        reg.active.postMessage(msg, [ch.port2]);
      })
      .catch(() => resolve(null));
  });
}

export type WarmProgress = { type: string; done: number; total: number; failed: number; at?: number };

/** Saves the main pages (HTML + JS + CSS + fonts) on the device. Reports progress; remembers when it finished. */
export async function warmPages(urls: string[] = WARM_URLS, onProgress?: (p: WarmProgress) => void): Promise<WarmProgress | null> {
  const res = await askSw<WarmProgress>({ type: "WARM", urls }, (m) => m.type === "WARM_DONE", (m) => (m.type === "WARM_PROGRESS" || m.type === "WARM_DONE") && onProgress?.(m));
  if (res && res.done > 0 && res.failed < res.total) {
    try {
      localStorage.setItem(WARM_AT_KEY, String(Date.now()));
      localStorage.setItem(WARM_VER_KEY, WARM_VERSION);
    } catch {
      /* ignore */
    }
  }
  return res;
}

export function lastWarmAt(): number {
  try {
    return Number(localStorage.getItem(WARM_AT_KEY) || 0);
  } catch {
    return 0;
  }
}

/** True when pages were never saved, the saved-page list changed, or the copy is older than a day. */
export function warmIsDue(): boolean {
  try {
    if (localStorage.getItem(WARM_VER_KEY) !== WARM_VERSION) return true;
    return Date.now() - lastWarmAt() > 24 * 3600 * 1000;
  } catch {
    return true;
  }
}

export type SwStatus = { type: string; version: string; caches: Record<string, number>; pages?: string[]; packImages?: string[] };

/** What the service worker holds right now (null when there is no worker, e.g. dev server / unsupported browser). */
export const getSwStatus = () => askSw<SwStatus>({ type: "STATUS" }, (m) => m.type === "STATUS", undefined, 8000);

/** Saves pack images in the never-trimmed pack cache. */
export const cachePackImages = (urls: string[], onProgress?: (done: number, total: number) => void) =>
  askSw<{ type: string; done: number; total: number; failed: number }>({ type: "CACHE_IMAGES", urls }, (m) => m.type === "IMAGES_DONE", (m) => onProgress?.(m.done, m.total));

export const dropPackImages = (urls: string[]) => postToSw({ type: "DROP_IMAGES", urls });

/** Ask the browser not to evict our saved data when the phone runs low on space. Returns true when granted. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Drops cached per-user API data / pages (call on logout or when a different account signs in). */
export async function clearUserCaches(): Promise<void> {
  await postToSw({ type: "CLEAR_USER_DATA" });
  try {
    // downloaded packs carry answers + solutions: they must not survive into the next account on a shared phone
    const { clearAllOfflineData } = await import("@/lib/offline-packs");
    await clearAllOfflineData();
  } catch {
    /* ignore */
  }
}

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
