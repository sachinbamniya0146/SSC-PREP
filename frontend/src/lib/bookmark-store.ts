"use client";
/**
 * One shared set of bookmarked question ids for the whole tab (Oct 28 2026).
 * The star on the test screen, on the review and on the Bookmarks page all read this, so they never disagree, and a
 * tap flips instantly (optimistic) and is rolled back if the server says no.
 */
import * as React from "react";
import { api } from "@/lib/api";

const EVENT = "ssc-bookmarks";
let ids: Set<string> | null = null;
let loading: Promise<void> | null = null;
let disabledMsg: string | null = null;

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export async function loadBookmarkIds(force = false): Promise<void> {
  if (typeof window === "undefined") return;
  if (ids && !force) return;
  if (loading) return loading;
  loading = api<string[] | { ids: string[] }>("/bookmarks/ids")
    .then((d) => {
      const list = Array.isArray(d) ? d : d?.ids ?? [];
      ids = new Set(list);
      emit();
    })
    .catch(() => {
      if (!ids) ids = new Set();
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

export function clearBookmarkCache() {
  ids = null;
  emit();
}

/** Flip a bookmark. Returns the new state; throws (after rolling back) with a readable message on failure. */
export async function toggleBookmark(questionId: string): Promise<boolean> {
  if (!ids) await loadBookmarkIds();
  const set = ids ?? new Set<string>();
  const was = set.has(questionId);
  if (was) set.delete(questionId);
  else set.add(questionId);
  ids = new Set(set);
  emit();
  try {
    const r = await api<{ bookmarked?: boolean }>(`/bookmarks/${questionId}/toggle`, { method: "POST" });
    const now = typeof r?.bookmarked === "boolean" ? r.bookmarked : !was;
    if (now !== !was) {
      const fix = new Set(ids);
      if (now) fix.add(questionId);
      else fix.delete(questionId);
      ids = fix;
      emit();
    }
    return now;
  } catch (e) {
    const back = new Set(ids);
    if (was) back.add(questionId);
    else back.delete(questionId);
    ids = back;
    emit();
    disabledMsg = e instanceof Error ? e.message : "Could not save the bookmark";
    throw e;
  }
}

export function lastBookmarkError(): string | null {
  return disabledMsg;
}

export function useBookmarked(questionId: string | null | undefined): boolean {
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    window.addEventListener(EVENT, tick);
    void loadBookmarkIds();
    return () => window.removeEventListener(EVENT, tick);
  }, []);
  return !!questionId && !!ids?.has(questionId);
}

/** The whole set of saved question ids (re-renders when it changes). */
export function useBookmarkedSet(): ReadonlySet<string> {
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    window.addEventListener(EVENT, tick);
    void loadBookmarkIds();
    return () => window.removeEventListener(EVENT, tick);
  }, []);
  return ids ?? new Set<string>();
}
