"use client";

// Reusable "← Back" button.
// BUGFIX: it used to call router.back() whenever window.history.length > 1. That number also counts pages from
// OTHER sites and earlier logins, so Back could land on /login, an already-submitted test, a payment page, or leave
// the app entirely — which is why "back button proper kaam nahi karta" was reported. Now it follows the in-app trail
// recorded by <NavTracker /> (root layout), skips pages that make no sense to return to, and otherwise goes to
// `fallbackHref` (default /dashboard).
import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { readNavStack, writeNavStack } from "@/components/NavTracker";

const NEVER_RETURN_TO = ["/login", "/signup", "/forgot", "/reset", "/verify", "/payment", "/test"];
const skip = (p: string) => p === "/" || NEVER_RETURN_TO.some((x) => p === x || p.startsWith(x + "/") || p.startsWith(x + "?"));

export function BackButton({
  fallbackHref = "/dashboard",
  label = "Back",
  className = "",
}: {
  fallbackHref?: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const goBack = () => {
    const stack = readNavStack();
    // drop the current page, then walk back to the nearest page that is a sensible destination
    while (stack.length && stack[stack.length - 1] === pathname) stack.pop();
    let target: string | null = null;
    while (stack.length) {
      const p = stack.pop() as string;
      if (p !== pathname && !skip(p)) {
        target = p;
        break;
      }
    }
    writeNavStack(stack); // the destination re-adds itself via NavTracker
    router.push(target || fallbackHref);
  };

  return (
    <button
      onClick={goBack}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground ${className}`}
      aria-label={label}
    >
      ← {label}
    </button>
  );
}
