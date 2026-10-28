"use client";

import * as React from "react";
import { getChatSocket } from "@/lib/chat-socket";
import { useT } from "@/lib/i18n";
import HelpDeskPanel from "@/components/HelpDeskPanel";

/**
 * Floating help button (students only, mounted once in the root layout). Opens the help desk panel: quick answers,
 * tickets, live chat. The red badge counts unanswered replies and also updates while the panel is closed.
 */
export function SupportChatWidget({ currentUserId }: { currentUserId: string }) {
  const tr = useT();
  const [open, setOpen] = React.useState(false);
  const [unread, setUnread] = React.useState(0);
  const [mountedOnce, setMountedOnce] = React.useState(false);

  // live "new reply" pings while the panel is closed
  React.useEffect(() => {
    const socket = getChatSocket();
    if (!socket) return;
    const onNotify = (data: { message?: { senderId?: string } }) => {
      if (data.message?.senderId === currentUserId) return;
      if (!open) setUnread((n) => n + 1);
    };
    socket.on("conversation:notify", onNotify);
    return () => {
      socket.off("conversation:notify", onNotify);
    };
  }, [open, currentUserId]);

  // Esc closes the panel
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const toggle = () => {
    setOpen((o) => !o);
    setMountedOnce(true);
    setUnread(0);
  };

  return (
    <div className="fixed bottom-20 right-4 z-50 lg:bottom-5 lg:right-5">
      {mountedOnce && (
        <div className={open ? "mb-3 animate-pop" : "hidden"}>
          <HelpDeskPanel currentUserId={currentUserId} variant="widget" onUnread={setUnread} onClose={() => setOpen(false)} />
        </div>
      )}
      <button
        onClick={toggle}
        aria-label={open ? tr("Close help", "Help band karo") : tr("Open help desk", "Help desk kholo")}
        aria-expanded={open}
        className="relative ml-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary text-2xl text-white shadow-xl transition hover:scale-105 active:scale-95"
      >
        {open ? "✕" : "💬"}
        {unread > 0 && !open && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}
