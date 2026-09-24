"use client";

import * as React from "react";
import { api } from "@/lib/api";
import { getChatSocket } from "@/lib/chat-socket";

/**
 * SupportChatWidget — floating "Chat with Admin" button + panel, for
 * general questions NOT tied to a specific question/report (Sachin's
 * "general support chat bhi" requirement, separate from the per-question
 * ReportQuestion thread). Meant to be dropped once into a root layout so
 * it's available everywhere a logged-in student is.
 */

interface ChatMessage {
  id: string;
  senderId: string;
  senderRole: "STUDENT" | "ADMIN" | "MODERATOR";
  senderName: string;
  content: string;
  createdAt: string;
}

export function SupportChatWidget({ currentUserId }: { currentUserId: string }) {
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [unread, setUnread] = React.useState(0);
  const bottomRef = React.useRef<HTMLDivElement | null>(null);

  const openPanel = async () => {
    setPanelOpen(true);
    setUnread(0);
    if (conversationId) return;
    setLoading(true);
    try {
      const res = await api<{ conversation: { id: string } }>("/support-chat/start", { method: "POST" });
      setConversationId(res.conversation.id);
      const msgs = await api<{ messages: ChatMessage[] }>(`/support-chat/${res.conversation.id}/messages`);
      setMessages(msgs.messages);
      api(`/support-chat/${res.conversation.id}/messages/read`, { method: "POST" }).catch(() => {});
    } catch {
      // leave panel open with empty state — student can retry by closing/reopening
    } finally {
      setLoading(false);
    }
  };

  // Listen for notifications even while the panel is closed, so the
  // floating button can show an unread badge (matches WhatsApp-style
  // "always listening" behavior, not just "listening while chat is open").
  React.useEffect(() => {
    const socket = getChatSocket();
    if (!socket) return;

    const onNotify = (data: { conversationId: string; message: ChatMessage }) => {
      if (data.message?.senderId === currentUserId) return; // ignore our own echo
      if (!panelOpen || data.conversationId !== conversationId) {
        setUnread((n) => n + 1);
      }
    };
    socket.on("conversation:notify", onNotify);
    return () => { socket.off("conversation:notify", onNotify); };
  }, [panelOpen, conversationId, currentUserId]);

  React.useEffect(() => {
    if (!conversationId) return;
    const socket = getChatSocket();
    if (!socket) return;
    socket.emit("conversation:join", { conversationId });

    const onMessage = (data: { conversationId: string; message: ChatMessage & { system?: boolean } }) => {
      if (data.conversationId !== conversationId) return;
      if ((data.message as any).system) return; // system status notices aren't rendered as chat bubbles here
      setMessages((prev) => (prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]));
      if (data.message.senderId !== currentUserId && panelOpen) {
        api(`/support-chat/${conversationId}/messages/read`, { method: "POST" }).catch(() => {});
      }
    };
    socket.on("conversation:message", onMessage);
    return () => {
      socket.emit("conversation:leave", { conversationId });
      socket.off("conversation:message", onMessage);
    };
  }, [conversationId, currentUserId, panelOpen]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const send = async () => {
    const content = draft.trim();
    if (!content || !conversationId) return;
    setSending(true);
    setDraft("");
    try {
      await api(`/support-chat/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ content }) });
    } catch {
      setDraft(content);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {panelOpen && (
        <div className="mb-3 flex h-[26rem] w-80 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-border bg-primary px-4 py-3">
            <p className="text-sm font-bold text-white">💬 Chat with Admin</p>
            <button onClick={() => setPanelOpen(false)} className="text-white/80 hover:text-white">✕</button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {loading ? (
              <p className="py-6 text-center text-xs text-muted-foreground">Connecting…</p>
            ) : messages.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Koi bhi sawaal ya problem ho, yahan directly admin se pooch sakte hain.
              </p>
            ) : (
              messages.map((m) => {
                const mine = m.senderId === currentUserId;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-xl px-3 py-1.5 text-xs ${mine ? "bg-primary text-white" : "bg-muted text-foreground"}`}>
                      {!mine && <p className="text-[10px] font-bold opacity-70">{m.senderName} (Admin)</p>}
                      <p className="whitespace-pre-line">{m.content}</p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>
          <div className="flex gap-2 border-t border-border p-3">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Apna message likhein…"
              maxLength={4000}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs"
            />
            <button onClick={send} disabled={sending || !draft.trim()} className="btn btn-primary text-xs disabled:opacity-50">
              Send
            </button>
          </div>
        </div>
      )}
      <button
        onClick={() => (panelOpen ? setPanelOpen(false) : openPanel())}
        className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary text-2xl text-white shadow-xl hover:scale-105 transition"
      >
        💬
        {unread > 0 && !panelOpen && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}
