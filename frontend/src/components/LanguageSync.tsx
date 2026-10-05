"use client";
import * as React from "react";
import { fetchAuth, API_BASE } from "@/lib/api";
import { getStoredLang, setStoredLang } from "@/lib/i18n";

/** Keeps the saved account language (set in Profile) in step with this device after login / on a new device. */
export default function LanguageSync() {
  React.useEffect(() => {
    if (typeof window === "undefined" || !localStorage.getItem("ssc_access_token")) return;
    let cancelled = false;
    fetchAuth(`${API_BASE}/users/me`)
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        if (cancelled || !u) return;
        const server = u.preferredLanguage === "hinglish" ? "hinglish" : "en";
        if (server !== getStoredLang()) setStoredLang(server);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
