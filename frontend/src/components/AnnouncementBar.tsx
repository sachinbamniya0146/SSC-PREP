"use client";
import * as React from "react";
import { usePathname } from "next/navigation";
import { useFeatures } from "@/lib/features";

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}

const TONE: Record<string, string> = {
  info: "border-info/30 bg-info/10 text-info",
  warn: "border-warning/40 bg-warning/15 text-warning",
  danger: "border-danger/30 bg-danger/10 text-danger",
};

/** Admin announcement from the Feature controller. A student can close it; a changed text shows again. */
export default function AnnouncementBar() {
  const { announcement } = useFeatures();
  const pathname = usePathname();
  // undefined = not read from the device yet (render nothing, so a closed banner never flashes)
  const [closed, setClosed] = React.useState<string | null | undefined>(undefined);

  const key = announcement ? hash(`${announcement.text}|${announcement.level}|${announcement.link}`) : "";
  React.useEffect(() => {
    if (!key) return;
    try {
      setClosed(localStorage.getItem("ssc_ann_closed"));
    } catch {
      setClosed(null);
    }
  }, [key]);

  // never on the live test screen (nothing may take space or attention there)
  if (pathname === "/test" || pathname?.startsWith("/test/") || pathname?.startsWith("/cgl-test")) return null;
  if (!announcement || !announcement.enabled || !announcement.text) return null;
  if (announcement.expiresAt && Date.parse(announcement.expiresAt) <= Date.now()) return null;
  if (closed === undefined || closed === key) return null;

  const close = () => {
    setClosed(key);
    try {
      localStorage.setItem("ssc_ann_closed", key);
    } catch {
      /* ignore */
    }
  };

  return (
    <div role="status" className={`animate-page flex items-start gap-3 border-b px-4 py-2 text-sm ${TONE[announcement.level] || TONE.info}`}>
      <p className="min-w-0 flex-1 leading-snug">
        <span className="font-semibold text-foreground">{announcement.text}</span>
        {announcement.link && (
          <a href={announcement.link} className="ml-2 whitespace-nowrap font-bold underline underline-offset-2">
            {announcement.linkLabel || "Open"} →
          </a>
        )}
      </p>
      <button type="button" onClick={close} aria-label="Close announcement" className="-m-1 rounded p-1 text-lg leading-none opacity-70 hover:opacity-100">
        ×
      </button>
    </div>
  );
}
