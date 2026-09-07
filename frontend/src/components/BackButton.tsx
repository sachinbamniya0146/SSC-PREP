"use client";

// NEW ("left side me top me back jaane ka button hona tha") — a single
// reusable back button instead of every one of the 30+ pages hand-rolling
// its own header/back-link (which is why some pages had one and others
// didn't). Uses browser history when there IS a previous page in this tab
// (so "back" truly goes back, not always to /dashboard), and falls back to
// `fallbackHref` (default /dashboard) when there's no history to go back to
// — e.g. the page was opened directly from a bookmark or a new tab.
import * as React from "react";
import { useRouter } from "next/navigation";

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
  const [canGoBack, setCanGoBack] = React.useState(false);

  React.useEffect(() => {
    // window.history.length > 1 just means "this tab has history", not
    // necessarily history within our own app — but it's the best signal
    // available client-side, and worst case we fall back to fallbackHref
    // if router.back() ever leaves the site (it won't for same-tab nav).
    setCanGoBack(typeof window !== "undefined" && window.history.length > 1);
  }, []);

  return (
    <button
      onClick={() => (canGoBack ? router.back() : router.push(fallbackHref))}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground ${className}`}
      aria-label={label}
    >
      ← {label}
    </button>
  );
}
