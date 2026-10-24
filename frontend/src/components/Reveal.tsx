"use client";

import * as React from "react";

type RevealProps = {
  as?: React.ElementType;
  delay?: number; // seconds
  className?: string;
  children?: React.ReactNode;
  [key: string]: unknown;
};

/**
 * Lightweight scroll-reveal (IntersectionObserver + CSS). Replaces
 * framer-motion on public pages so the landing page ships far less JS and
 * animates on the compositor only (opacity/transform).
 */
export function Reveal({ as: Tag = "div", delay = 0, className = "", children, ...rest }: RevealProps) {
  const ref = React.useRef<HTMLElement | null>(null);
  const [shown, setShown] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return React.createElement(
    Tag,
    {
      ref,
      className: `reveal ${shown ? "reveal-in" : ""} ${className}`,
      style: { transitionDelay: shown ? `${delay}s` : "0s" },
      ...rest,
    },
    children,
  );
}
