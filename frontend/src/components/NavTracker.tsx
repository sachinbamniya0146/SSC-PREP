"use client";
import * as React from "react";
import { usePathname } from "next/navigation";

const KEY = "ssc_nav_stack";
const MAX = 30;

/** In-app navigation trail (per tab). BackButton reads it so "Back" returns to the previous APP page — never to login/signup, a finished test, or another website. */
export function readNavStack(): string[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
export function writeNavStack(stack: string[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(stack.slice(-MAX)));
  } catch {
    /* ignore */
  }
}

export default function NavTracker() {
  const pathname = usePathname();
  React.useEffect(() => {
    if (!pathname) return;
    const stack = readNavStack();
    const last = stack[stack.length - 1];
    if (last === pathname) return;
    // user pressed the browser back button onto an earlier page of the trail -> trim instead of growing
    const idx = stack.lastIndexOf(pathname);
    if (idx >= 0 && idx === stack.length - 2) stack.pop();
    else stack.push(pathname);
    writeNavStack(stack);
  }, [pathname]);
  return null;
}
