"use client";

import * as React from "react";
import { api } from "@/lib/api";

// Department permissions an admin can give to a student email.
// ADMIN always has everything; MODERATOR (staff) only what is granted.
export type StaffPermission = "QUESTIONS" | "PRACTICE" | "VOCABULARY" | "SUPPORT";

export const PERMISSION_INFO: Record<
  StaffPermission,
  { label: string; emoji: string; desc: string; href: string }
> = {
  QUESTIONS: {
    label: "Questions (PYQ)",
    emoji: "📘",
    desc: "PYQ / main question bank upload, question manager, chapters, coverage, PDF studio",
    href: "/admin",
  },
  PRACTICE: {
    label: "Practice Questions",
    emoji: "📗",
    desc: "Sirf practice-only questions upload (apne uploads manage kar sakta hai)",
    href: "/admin",
  },
  VOCABULARY: {
    label: "Vocabulary",
    emoji: "📖",
    desc: "Vocabulary words + vocab questions upload / edit",
    href: "/admin/vocab",
  },
  SUPPORT: {
    label: "Support & Reports",
    emoji: "💬",
    desc: "Student support chat + question error reports",
    href: "/admin/support-chat",
  },
};

export const ALL_PERMISSIONS = Object.keys(PERMISSION_INFO) as StaffPermission[];

interface StoredUser {
  id?: string;
  email?: string;
  fullName?: string;
  role?: string;
  permissions?: StaffPermission[];
  [k: string]: unknown;
}

export function readStoredUser(): StoredUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("ssc_user");
    return raw ? (JSON.parse(raw) as StoredUser) : null;
  } catch {
    return null;
  }
}

/**
 * Refresh role + permissions from the server and write them back to
 * localStorage("ssc_user"). Needed because the role stored at login goes
 * stale the moment an admin grants (or takes back) staff access — before
 * this, a newly promoted staff member kept seeing a student UI (and every
 * /admin page bounced them to /dashboard) until they logged out and in.
 */
export async function syncSessionUser(): Promise<StoredUser | null> {
  if (typeof window === "undefined") return null;
  if (!localStorage.getItem("ssc_access_token")) return null;
  try {
    const d = await api<{ user: StoredUser }>("/auth/me");
    const fresh = d?.user;
    if (!fresh) return null;
    const old = readStoredUser() || {};
    const merged: StoredUser = {
      ...old,
      id: fresh.id ?? old.id,
      email: fresh.email ?? old.email,
      fullName: fresh.fullName ?? old.fullName,
      role: fresh.role ?? old.role,
      permissions: (fresh.permissions as StaffPermission[]) ?? [],
    };
    const changed =
      old.role !== merged.role ||
      JSON.stringify(old.permissions ?? []) !== JSON.stringify(merged.permissions ?? []);
    localStorage.setItem("ssc_user", JSON.stringify(merged));
    if (changed) window.dispatchEvent(new CustomEvent("ssc-user-updated"));
    return merged;
  } catch {
    return null;
  }
}

export interface Access {
  loading: boolean;
  role: string | null;
  permissions: StaffPermission[];
  isAdmin: boolean;
  isStaff: boolean; // ADMIN or MODERATOR
  can: (p: StaffPermission) => boolean;
}

function toAccess(u: StoredUser | null, loading: boolean): Access {
  const role = u?.role ?? null;
  const permissions = (u?.permissions ?? []) as StaffPermission[];
  const isAdmin = role === "ADMIN";
  return {
    loading,
    role,
    permissions,
    isAdmin,
    isStaff: isAdmin || role === "MODERATOR",
    can: (p) => isAdmin || (role === "MODERATOR" && permissions.includes(p)),
  };
}

/** Live view of the current user's role/permissions (starts from cache, then re-syncs). */
export function useAccess(): Access {
  const [state, setState] = React.useState<Access>(() => toAccess(null, true));

  React.useEffect(() => {
    let alive = true;
    setState(toAccess(readStoredUser(), true));
    syncSessionUser().then((u) => {
      if (alive) setState(toAccess(u ?? readStoredUser(), false));
    });
    const onUpdate = () => alive && setState(toAccess(readStoredUser(), false));
    window.addEventListener("ssc-user-updated", onUpdate);
    return () => {
      alive = false;
      window.removeEventListener("ssc-user-updated", onUpdate);
    };
  }, []);

  return state;
}
