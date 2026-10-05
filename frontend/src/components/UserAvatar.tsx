"use client";
import * as React from "react";

/** Google profile photo with a clean initials fallback (broken / blocked / missing photo never shows a broken-image icon). */
export default function UserAvatar({ name, email, src, size = 32 }: { name?: string | null; email?: string | null; src?: string | null; size?: number }) {
  const [broken, setBroken] = React.useState(false);
  React.useEffect(() => setBroken(false), [src]);
  const initial = (name || email || "?").trim().charAt(0).toUpperCase();
  const box = { width: size, height: size, minWidth: size };
  if (src && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name || "User"}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        style={box}
        className="rounded-full border border-border object-cover"
      />
    );
  }
  return (
    <div style={{ ...box, fontSize: Math.max(11, size * 0.4) }} className="flex items-center justify-center rounded-full bg-primary/15 font-bold text-primary">
      {initial}
    </div>
  );
}
