"use client";
/**
 * Tiny UI-language switch: English (default) or Hinglish.
 *
 * The student picks the language once in Profile; it is saved on the account (User.preferredLanguage) and mirrored in
 * localStorage so every page renders instantly. Student-facing copy is written as t("English text", "Hinglish text"):
 * English is what everybody sees by default, Hinglish only shows when the student chose it.
 */
import * as React from "react";

export type Lang = "en" | "hinglish";
const KEY = "ssc_lang";
const EVENT = "ssc-lang-change";

export function getStoredLang(): Lang {
  if (typeof window === "undefined") return "en";
  try {
    return localStorage.getItem(KEY) === "hinglish" ? "hinglish" : "en";
  } catch {
    return "en";
  }
}

export function setStoredLang(lang: Lang) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Current language. Starts as "en" on the server AND first client render (no hydration mismatch), then syncs. */
export function useLang(): Lang {
  const [lang, setLang] = React.useState<Lang>("en");
  React.useEffect(() => {
    const sync = () => setLang(getStoredLang());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return lang;
}

/** const t = useT();  t("Wrong answers", "Galat jawab") — falls back to English when no Hinglish text is given. */
export function useT() {
  const lang = useLang();
  return React.useCallback((en: string, hi?: string) => (lang === "hinglish" && hi ? hi : en), [lang]);
}
