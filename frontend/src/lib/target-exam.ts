"use client";

import { API_BASE, fetchAuth } from "@/lib/api";

/** The exam the student is preparing for (User.targetExamId, S48). null = not chosen yet or not logged in. Never throws. */
export async function loadTargetExamId(): Promise<string | null> {
  try {
    const r = await fetchAuth(`${API_BASE}/users/me`);
    if (!r.ok) return null;
    const d = await r.json();
    const id = d?.targetExamId ?? d?.user?.targetExamId;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

/** Saves (or, with null, clears) the target exam. Returns true when the server accepted it. */
export async function saveTargetExamId(examId: string | null): Promise<boolean> {
  try {
    const r = await fetchAuth(`${API_BASE}/users/me/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetExamId: examId ?? "" }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
