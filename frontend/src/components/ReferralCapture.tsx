"use client";
import * as React from "react";

export const REF_STORAGE_KEY = "ssc_ref";
const REF_TTL_MS = 30 * 86_400_000;

/** The saved invite code (if still fresh). Used by the signup page when the visitor did not come straight to /signup?ref=… */
export function readSavedReferral(): string {
  try {
    const raw = localStorage.getItem(REF_STORAGE_KEY);
    if (!raw) return "";
    const { code, at } = JSON.parse(raw) as { code?: string; at?: number };
    if (!code || !at || Date.now() - at > REF_TTL_MS) {
      localStorage.removeItem(REF_STORAGE_KEY);
      return "";
    }
    return String(code);
  } catch {
    return "";
  }
}

export function clearSavedReferral() {
  try {
    localStorage.removeItem(REF_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Remembers ?ref=CODE from ANY page (home page, a shared blog link …) for 30 days, so a friend who browses first
 * and signs up later still counts for the person who invited them. Renders nothing.
 */
export function ReferralCapture() {
  React.useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      const code = (ref || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
      if (code.length >= 4) localStorage.setItem(REF_STORAGE_KEY, JSON.stringify({ code, at: Date.now() }));
    } catch {
      /* private mode: the ?ref= on the signup URL still works */
    }
  }, []);
  return null;
}
