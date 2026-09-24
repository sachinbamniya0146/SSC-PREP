"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { SupportChatWidget } from "./SupportChatWidget";

/**
 * SupportChatMount — decides WHETHER to render the floating support-chat
 * widget, so layout.tsx (a server component) can stay simple. Rules:
 *   - Only for logged-in users with an access token.
 *   - Only for STUDENT role — admins/moderators have their own inbox at
 *     /admin/support-chat instead of a floating "chat with admin" button.
 *   - Not on auth pages (login/signup) where there's no session yet, and
 *     not on admin pages generally, to avoid visual clutter for staff.
 */
export function SupportChatMount() {
  const pathname = usePathname();
  const [studentId, setStudentId] = React.useState<string | null>(null);

  const hideOnThisRoute =
    pathname?.startsWith("/login") ||
    pathname?.startsWith("/signup") ||
    pathname?.startsWith("/admin") ||
    pathname?.startsWith("/verification");

  React.useEffect(() => {
    if (hideOnThisRoute) {
      setStudentId(null);
      return;
    }
    const token = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") : null;
    if (!token) {
      setStudentId(null);
      return;
    }
    let cancelled = false;
    api<{ id: string; role: string }>("/users/me")
      .then((me) => {
        if (!cancelled && me.role === "STUDENT") setStudentId(me.id);
      })
      .catch(() => {
        // not logged in / token invalid — widget simply doesn't render
      });
    return () => { cancelled = true; };
  }, [hideOnThisRoute, pathname]);

  if (!studentId) return null;
  return <SupportChatWidget currentUserId={studentId} />;
}
