"use client";

// Admin Support Chat Inbox — the general student <-> admin chat (Sachin's
// "dono — per-report thread + general support chat bhi" requirement).
// Separate from /admin/error-reports (which is per-question report threads).
// Lists every conversation, lets an admin open one and reply in real time
// (Socket.io via ChatGateway), and mark it resolved once handled.

import * as React from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getChatSocket } from "@/lib/chat-socket";

interface ConversationRow {
  id: string;
  student: { id: string; fullName: string; email: string };
  status: "OPEN" | "RESOLVED";
  subject: string | null;
  messageCount: number;
  unreadCount: number;
  updatedAt: string;
}

interface ChatMessage {
  id: string;
  senderId: string;
  senderRole: "STUDENT" | "ADMIN" | "MODERATOR";
  senderName: string;
  content: string;
  createdAt: string;
}

export default function AdminSupportChatPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = React.useState(false);
  const [adminId, setAdminId] = React.useState("");
  const [conversations, setConversations] = React.useState<ConversationRow[]>([]);
  const [statusFilter, setStatusFilter] = React.useState<"OPEN" | "RESOLVED" | "">("OPEN");
  const [loading, setLoading] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [err, setErr] = React.useState("");
  const bottomRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem("ssc_user");
      const user = raw ? JSON.parse(raw) : null;
      const isAdmin = user?.role === "ADMIN" || user?.role === "MODERATOR";
      if (!isAdmin) {
        router.replace("/dashboard");
        return;
      }
      if (user?.id) setAdminId(user.id);
    } catch {
      router.replace("/dashboard");
      return;
    }
    setAuthChecked(true);
  }, [router]);

  const loadInbox = React.useCallback(async () => {
    setLoading(true);
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : "";
      const res = await api<{ conversations: ConversationRow[] }>(`/support-chat/admin/inbox${qs}`);
      setConversations(res.conversations);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Inbox load nahi ho paya");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  React.useEffect(() => {
    if (!authChecked) return;
    loadInbox();
  }, [authChecked, loadInbox]);

  // Live-update the inbox list (new message dot) without a full reload —
  // ChatGateway broadcasts this to the 'admins' room on every new message
  // across ALL conversations, so any admin's inbox stays current even if
  // a different admin/student is chatting elsewhere.
  React.useEffect(() => {
    if (!authChecked) return;
    const socket = getChatSocket();
    if (!socket) return;
    const onInboxPing = () => loadInbox();
    socket.on("conversation:new-message-admin-inbox", onInboxPing);
    return () => { socket.off("conversation:new-message-admin-inbox", onInboxPing); };
  }, [authChecked, loadInbox]);

  const openConversation = async (id: string) => {
    setSelectedId(id);
    try {
      const res = await api<{ messages: ChatMessage[] }>(`/support-chat/${id}/messages`);
      setMessages(res.messages);
      await api(`/support-chat/${id}/messages/read`, { method: "POST" });
      loadInbox(); // refresh unread badge
    } catch {
      setMessages([]);
    }
  };

  React.useEffect(() => {
    if (!selectedId) return;
    const socket = getChatSocket();
    if (!socket) return;
    socket.emit("conversation:join", { conversationId: selectedId });

    const onMessage = (data: { conversationId: string; message: ChatMessage & { system?: boolean } }) => {
      if (data.conversationId !== selectedId) return;
      if ((data.message as any).system) return;
      setMessages((prev) => (prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]));
    };
    socket.on("conversation:message", onMessage);
    return () => {
      socket.emit("conversation:leave", { conversationId: selectedId });
      socket.off("conversation:message", onMessage);
    };
  }, [selectedId]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const send = async () => {
    const content = draft.trim();
    if (!content || !selectedId) return;
    setSending(true);
    setDraft("");
    try {
      await api(`/support-chat/${selectedId}/messages`, { method: "POST", body: JSON.stringify({ content }) });
    } catch {
      setDraft(content);
    } finally {
      setSending(false);
    }
  };

  const resolve = async () => {
    if (!selectedId) return;
    if (!confirm("Yeh conversation resolved mark karni hai? Student ko naya chat shuru karna padega agar dobara baat karni ho.")) return;
    try {
      await api(`/support-chat/${selectedId}/resolve`, { method: "POST" });
      loadInbox();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Resolve fail ho gaya");
    }
  };

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Checking access...</p>
      </div>
    );
  }

  const selected = conversations.find((c) => c.id === selectedId);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">← <span className="text-primary">SSC</span>PrepHub</a>
          <span className="text-sm text-muted-foreground">💬 Support Chat</span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-bold">💬 Support Chat Inbox</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Students ke general sawaal/problems yahan aate hain — reply live chat se milega.
        </p>

        {err && <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{err}</p>}

        <div className="mt-6 grid gap-4 lg:grid-cols-[22rem_1fr]">
          {/* Conversation list */}
          <div className="card overflow-hidden">
            <div className="flex gap-2 border-b border-border p-3">
              {(["OPEN", "RESOLVED", ""] as const).map((s) => (
                <button
                  key={s || "ALL"}
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${statusFilter === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                >
                  {s || "ALL"}
                </button>
              ))}
            </div>
            <div className="max-h-[32rem] overflow-y-auto">
              {loading ? (
                <p className="p-4 text-center text-xs text-muted-foreground">Loading…</p>
              ) : conversations.length === 0 ? (
                <p className="p-4 text-center text-xs text-muted-foreground">Koi conversation nahi hai is filter mein.</p>
              ) : (
                conversations.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => openConversation(c.id)}
                    className={`flex w-full items-start gap-2 border-b border-border px-3 py-3 text-left transition hover:bg-muted/50 ${selectedId === c.id ? "bg-muted" : ""}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-sm font-semibold">{c.student.fullName}</p>
                        {c.status === "RESOLVED" && <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-bold text-muted-foreground">RESOLVED</span>}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{c.subject || "New conversation"}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{new Date(c.updatedAt).toLocaleString()}</p>
                    </div>
                    {c.unreadCount > 0 && (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white">
                        {c.unreadCount > 9 ? "9+" : c.unreadCount}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Chat panel */}
          <div className="card flex h-[36rem] flex-col overflow-hidden">
            {!selected ? (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                Ek conversation chuno chat dekhne ke liye.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div>
                    <p className="text-sm font-bold">{selected.student.fullName}</p>
                    <p className="text-xs text-muted-foreground">{selected.student.email}</p>
                  </div>
                  {selected.status === "OPEN" && (
                    <button onClick={resolve} className="rounded-lg border border-success/40 bg-success/10 px-3 py-1.5 text-xs font-bold text-success hover:bg-success/20">
                      ✅ Mark Resolved
                    </button>
                  )}
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto p-4">
                  {messages.map((m) => {
                    const mine = m.senderId === adminId;
                    return (
                      <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${mine ? "bg-primary text-white" : "bg-muted text-foreground"}`}>
                          {!mine && <p className="text-[10px] font-bold opacity-70">{m.senderName}</p>}
                          <p className="whitespace-pre-line">{m.content}</p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>
                <div className="flex gap-2 border-t border-border p-3">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder="Reply likhein…"
                    maxLength={4000}
                    disabled={selected.status === "RESOLVED"}
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
                  />
                  <button onClick={send} disabled={sending || !draft.trim() || selected.status === "RESOLVED"} className="btn btn-primary text-sm disabled:opacity-50">
                    Send
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
