"use client";
/**
 * Feature controller on the student side (Oct 28 2026).
 * GET /features is public and tiny. We keep ONE copy per tab, refresh it every 2 minutes and when the tab comes back to
 * the foreground, and until the first answer arrives every flag is treated as ON (so a slow network never hides a page).
 * The server stays the real gate for the flags marked "server"; this only hides the buttons / pages.
 */
import * as React from "react";
import { API_BASE } from "@/lib/api";

export interface Announcement {
  enabled: boolean;
  text: string;
  level: "info" | "warn" | "danger";
  link: string;
  linkLabel: string;
  expiresAt: string;
}
export interface FeatureState {
  flags: Record<string, boolean>;
  announcement: Announcement;
}

const EVENT = "ssc-features";
const CACHE_KEY = "ssc_features_v1";
let current: FeatureState | null = null;
let inFlight: Promise<void> | null = null;
let lastFetch = 0;

function readCache(): FeatureState | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as FeatureState) : null;
  } catch {
    return null;
  }
}

export async function refreshFeatures(force = false): Promise<void> {
  if (typeof window === "undefined") return;
  if (!force && Date.now() - lastFetch < 20_000) return;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/features`, { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as FeatureState;
      if (!d || typeof d !== "object" || !d.flags) return;
      current = d;
      lastFetch = Date.now();
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(d));
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new Event(EVENT));
    } catch {
      /* offline: keep what we have */
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

// ONE poller for the whole tab, no matter how many components use the hook (a review page has a star on every card).
let subscribers = 0;
let pollTimer: number | null = null;
const onVisible = () => {
  if (document.visibilityState === "visible") void refreshFeatures();
};
function startPolling() {
  subscribers += 1;
  if (subscribers > 1) return;
  void refreshFeatures();
  pollTimer = window.setInterval(() => void refreshFeatures(true), 120_000);
  document.addEventListener("visibilitychange", onVisible);
}
function stopPolling() {
  subscribers = Math.max(0, subscribers - 1);
  if (subscribers > 0) return;
  if (pollTimer != null) window.clearInterval(pollTimer);
  pollTimer = null;
  document.removeEventListener("visibilitychange", onVisible);
}

/** { flags, announcement, loaded } - flags default to ON until loaded. */
export function useFeatures() {
  const [state, setState] = React.useState<FeatureState | null>(null);
  React.useEffect(() => {
    if (!current) current = readCache();
    setState(current);
    const sync = () => setState(current);
    window.addEventListener(EVENT, sync);
    startPolling();
    return () => {
      window.removeEventListener(EVENT, sync);
      stopPolling();
    };
  }, []);
  const flags = state?.flags ?? {};
  return {
    loaded: !!state,
    flags,
    announcement: state?.announcement ?? null,
    /** unknown / not loaded yet = on */
    on: (key: string) => flags[key] !== false,
  };
}

/** <FeatureGate flag="vocabulary">...</FeatureGate> - renders children unless the admin switched it off. */
export function FeatureGate({ flag, children, fallback = null }: { flag: string; children: React.ReactNode; fallback?: React.ReactNode }) {
  const { on } = useFeatures();
  return <>{on(flag) ? children : fallback}</>;
}

/** Page-level message when the admin has switched a whole section off. */
export function FeatureOff({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mx-auto my-16 max-w-md rounded-xl border border-border bg-card p-8 text-center">
      <p className="text-lg font-bold">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{hint || "This section is switched off for now. Please check back soon."}</p>
      <a href="/dashboard" className="btn btn-primary mt-5">Go to dashboard</a>
    </div>
  );
}
