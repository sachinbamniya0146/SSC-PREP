"use client";

// Admin Help desk (Oct 28 2026): ticket inbox with filters and a reply-time (SLA) flag, one-click saved replies, private
// internal notes, a 360 view of the student (plan, payments, tests), assign / priority / category, stats and settings.

import * as React from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getChatSocket } from "@/lib/chat-socket";
import { Skeleton } from "@/components/Skeleton";

type Sla = "none" | "ok" | "due" | "late";
interface Row {
  id: string;
  ticketNo: number;
  student: { id: string; fullName: string; email: string };
  status: "OPEN" | "RESOLVED";
  category: string;
  priority: string;
  subject: string | null;
  assignedAdminId: string | null;
  messageCount: number;
  unreadCount: number;
  waitingMinutes: number | null;
  sla: Sla;
  rating: number | null;
  updatedAt: string;
}
interface Msg {
  id: string;
  senderId: string;
  senderRole: "STUDENT" | "ADMIN" | "MODERATOR";
  senderName: string;
  content: string;
  isInternal?: boolean;
  createdAt: string;
}
interface Detail {
  ticket: { id: string; ticketNo: number; status: string; category: string; priority: string; subject: string | null; assignedAdminId: string | null; context: Record<string, string | number> | null; createdAt: string; firstResponseAt: string | null; resolvedAt: string | null; rating: number | null; ratingNote: string | null };
  student: { id: string; fullName: string; email: string; phone: string | null; state: string | null; createdAt: string; isSuspended: boolean; isEmailVerified: boolean; xp: number };
  plan: { name: string; endsAt: string } | null;
  payments: { gatewayOrderId: string | null; amountInr: number; status: string; createdAt: string }[];
  testsTaken: number;
  ticketsTotal: number;
}
interface Stats {
  open: number; waiting: number; late: number; unassigned: number; mine: number; resolved24h: number;
  avgFirstResponseMin: number | null; medianFirstResponseMin: number | null; avgRating: number | null; ratingCount: number; slaMinutes: number;
}
interface Canned { id: string; title: string; text: string }
interface Cfg { slaMinutes: number; autoCloseDays: number; reopenDays: number; canned: Canned[] }

const CATS = ["GENERAL", "PAYMENT", "TEST", "QUESTION", "ACCOUNT", "TECHNICAL"];
const PRIOS = ["LOW", "NORMAL", "HIGH", "URGENT"];
const PRIO_CLS: Record<string, string> = { LOW: "badge-primary", NORMAL: "bg-muted text-muted-foreground", HIGH: "badge-warning", URGENT: "badge-danger" };

const waitText = (m: number | null) => (m == null ? "" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d`);
const minText = (m: number | null) => (m == null ? "-" : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`);

export default function AdminHelpDeskPage() {
  const router = useRouter();
  const [adminId, setAdminId] = React.useState("");
  const [isAdmin, setIsAdmin] = React.useState(false);
  const [ready, setReady] = React.useState(false);

  const [rows, setRows] = React.useState<Row[]>([]);
  const [slaMin, setSlaMin] = React.useState(120);
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState("");

  const [status, setStatus] = React.useState<"OPEN" | "RESOLVED" | "">("OPEN");
  const [category, setCategory] = React.useState("");
  const [priority, setPriority] = React.useState("");
  const [assigned, setAssigned] = React.useState("");
  const [lateOnly, setLateOnly] = React.useState(false);
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [q, setQ] = React.useState("");

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [detail, setDetail] = React.useState<Detail | null>(null);
  const [showPanel, setShowPanel] = React.useState(true);
  const [draft, setDraft] = React.useState("");
  const [internal, setInternal] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [cfg, setCfg] = React.useState<Cfg | null>(null);
  const [showSettings, setShowSettings] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement | null>(null);
  const inboxReq = React.useRef(0);

  // who am I
  React.useEffect(() => {
    api<{ id: string; role: string }>("/users/me")
      .then((me) => {
        if (me.role !== "ADMIN" && me.role !== "MODERATOR") {
          router.replace("/dashboard");
          return;
        }
        setAdminId(me.id);
        setIsAdmin(me.role === "ADMIN");
        setReady(true);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  React.useEffect(() => {
    const t = window.setTimeout(() => setQ(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const loadInbox = React.useCallback(async () => {
    const id = ++inboxReq.current;
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (category) p.set("category", category);
    if (priority) p.set("priority", priority);
    if (assigned) p.set("assigned", assigned);
    if (q) p.set("q", q);
    if (lateOnly) p.set("late", "1");
    if (unreadOnly) p.set("unread", "1");
    try {
      const [inbox, st] = await Promise.all([
        api<{ conversations: Row[]; slaMinutes: number }>(`/support-chat/admin/inbox?${p}`),
        api<Stats>("/support-chat/admin/stats").catch(() => null),
      ]);
      if (id !== inboxReq.current) return;
      setRows(inbox.conversations);
      setSlaMin(inbox.slaMinutes);
      if (st) setStats(st);
      setErr("");
    } catch (e) {
      if (id === inboxReq.current) setErr(e instanceof Error ? e.message : "Could not load the inbox");
    } finally {
      if (id === inboxReq.current) setLoading(false);
    }
  }, [status, category, priority, assigned, q, lateOnly, unreadOnly]);

  React.useEffect(() => {
    if (!ready) return;
    setLoading(true);
    void loadInbox();
  }, [ready, loadInbox]);

  // keep fresh: socket ping (debounced) + slow poll
  React.useEffect(() => {
    if (!ready) return;
    let t: number | undefined;
    const ping = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => void loadInbox(), 600);
    };
    const socket = getChatSocket();
    socket?.on("conversation:new-message-admin-inbox", ping);
    const poll = window.setInterval(() => document.visibilityState === "visible" && void loadInbox(), 30_000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(poll);
      socket?.off("conversation:new-message-admin-inbox", ping);
    };
  }, [ready, loadInbox]);

  React.useEffect(() => {
    if (!ready) return;
    api<{ config: Cfg }>("/support-chat/admin/config").then((d) => setCfg(d.config)).catch(() => {});
  }, [ready]);

  const loadMessages = React.useCallback(async (id: string, quiet = false) => {
    try {
      const d = await api<{ messages: Msg[] }>(`/support-chat/${id}/messages`);
      setMessages(d.messages);
      if (!quiet) api(`/support-chat/${id}/messages/read`, { method: "POST" }).then(() => loadInbox()).catch(() => {});
    } catch (e) {
      if (!quiet) setErr(e instanceof Error ? e.message : "Could not load the chat");
    }
  }, [loadInbox]);

  const loadDetail = React.useCallback(async (id: string) => {
    try {
      setDetail(await api<Detail>(`/support-chat/${id}/detail`));
    } catch {
      setDetail(null);
    }
  }, []);

  const open = (id: string) => {
    setSelectedId(id);
    setMessages([]);
    setDetail(null);
    setInternal(false);
    setDraft("");
    void loadMessages(id);
    void loadDetail(id);
  };

  React.useEffect(() => {
    if (!selectedId) return;
    const socket = getChatSocket();
    socket?.emit("conversation:join", { conversationId: selectedId });
    const onMessage = (data: { conversationId: string; message: Msg & { system?: boolean } }) => {
      if (data.conversationId !== selectedId || data.message.system) return;
      setMessages((prev) => (prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]));
      api(`/support-chat/${selectedId}/messages/read`, { method: "POST" }).catch(() => {});
    };
    socket?.on("conversation:message", onMessage);
    const poll = window.setInterval(() => document.visibilityState === "visible" && void loadMessages(selectedId, true), 20_000);
    return () => {
      socket?.emit("conversation:leave", { conversationId: selectedId });
      socket?.off("conversation:message", onMessage);
      window.clearInterval(poll);
    };
  }, [selectedId, loadMessages]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, selectedId]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const ticketStatus = detail?.ticket.status ?? selected?.status ?? "OPEN";
  const resolved = ticketStatus === "RESOLVED";

  const send = async () => {
    const content = draft.trim();
    if (!content || !selectedId || sending) return;
    setSending(true);
    setErr("");
    try {
      const r = await api<{ message: Msg }>(`/support-chat/${selectedId}/messages`, { method: "POST", body: JSON.stringify({ content, internal }) });
      setDraft("");
      setMessages((prev) => (prev.some((m) => m.id === r.message.id) ? prev : [...prev, r.message]));
      void loadInbox();
      void loadDetail(selectedId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not send");
    } finally {
      setSending(false);
    }
  };

  const act = async (path: string, init?: RequestInit) => {
    if (!selectedId) return;
    setErr("");
    try {
      await api(`/support-chat/${selectedId}/${path}`, init);
      await Promise.all([loadInbox(), loadDetail(selectedId)]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed");
    }
  };

  if (!ready) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[30rem]" />
      </div>
    );
  }

  const chipBtn = (active: boolean) =>
    `rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg" data-legacy-chrome>
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <a href="/admin" className="text-lg font-bold">← Admin</a>
          <span className="text-sm text-muted-foreground">Help desk</span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">💬 Help desk</h1>
            <p className="mt-1 text-sm text-muted-foreground">Student tickets. Waiting the longest comes first; reply target is {minText(slaMin)}.</p>
          </div>
          {isAdmin && (
            <button onClick={() => setShowSettings(true)} className="btn btn-outline btn-sm">⚙️ Settings &amp; saved replies</button>
          )}
        </div>

        {/* stats */}
        {stats && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {[
              { l: "Open", v: stats.open },
              { l: "Waiting for us", v: stats.waiting, tone: stats.waiting ? "text-warning" : "" },
              { l: "Late", v: stats.late, tone: stats.late ? "text-danger" : "" },
              { l: "Unassigned", v: stats.unassigned },
              { l: "Mine", v: stats.mine },
              { l: "Solved (24h)", v: stats.resolved24h },
              { l: "Avg 1st reply", v: minText(stats.avgFirstResponseMin) },
              { l: "Rating (30d)", v: stats.avgRating != null ? `${stats.avgRating} ★` : "-", sub: stats.ratingCount ? `${stats.ratingCount} votes` : "" },
            ].map((s) => (
              <div key={s.l} className="card px-3 py-2">
                <p className={`text-lg font-extrabold leading-tight ${s.tone || ""}`}>{s.v}</p>
                <p className="text-[11px] text-muted-foreground">{s.l}{s.sub ? ` · ${s.sub}` : ""}</p>
              </div>
            ))}
          </div>
        )}

        {err && (
          <p role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {err} <button className="ml-2 underline" onClick={() => setErr("")}>dismiss</button>
          </p>
        )}

        <div className="mt-5 grid gap-4 lg:grid-cols-[24rem_1fr]">
          {/* LIST */}
          <div className={`card flex flex-col overflow-hidden ${selectedId ? "hidden lg:flex" : ""}`}>
            <div className="space-y-2 border-b border-border p-3">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, #ticket, text…" className="w-full border bg-background px-3 py-2 text-sm" aria-label="Search tickets" />
              <div className="flex flex-wrap gap-1.5">
                {(["OPEN", "RESOLVED", ""] as const).map((s) => (
                  <button key={s || "ALL"} onClick={() => setStatus(s)} className={chipBtn(status === s)}>{s || "ALL"}</button>
                ))}
                <button onClick={() => setLateOnly((v) => !v)} className={chipBtn(lateOnly)}>⏰ Late</button>
                <button onClick={() => setUnreadOnly((v) => !v)} className={chipBtn(unreadOnly)}>● Unread</button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="border bg-background px-1.5 py-1.5 text-xs" aria-label="Category">
                  <option value="">Any type</option>
                  {CATS.map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}
                </select>
                <select value={priority} onChange={(e) => setPriority(e.target.value)} className="border bg-background px-1.5 py-1.5 text-xs" aria-label="Priority">
                  <option value="">Any priority</option>
                  {PRIOS.map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}
                </select>
                <select value={assigned} onChange={(e) => setAssigned(e.target.value)} className="border bg-background px-1.5 py-1.5 text-xs" aria-label="Assignee">
                  <option value="">Anyone</option>
                  <option value="mine">Mine</option>
                  <option value="unassigned">Unassigned</option>
                </select>
              </div>
            </div>
            <div className="max-h-[34rem] flex-1 overflow-y-auto">
              {loading ? (
                <div className="space-y-2 p-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
              ) : rows.length === 0 ? (
                <p className="p-6 text-center text-xs text-muted-foreground">No tickets match these filters.</p>
              ) : (
                rows.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => open(c.id)}
                    className={`flex w-full items-start gap-2 border-b border-border px-3 py-3 text-left transition hover:bg-muted/50 ${selectedId === c.id ? "bg-muted" : ""}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-bold text-muted-foreground">#{c.ticketNo}</span>
                        <p className="truncate text-sm font-semibold">{c.student.fullName}</p>
                        {c.status === "RESOLVED" && <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-bold text-muted-foreground">RESOLVED</span>}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{c.subject || "New ticket"}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold">{c.category.toLowerCase()}</span>
                        {c.priority !== "NORMAL" && <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${PRIO_CLS[c.priority] || ""}`}>{c.priority.toLowerCase()}</span>}
                        {c.sla === "late" && <span className="rounded bg-danger/15 px-1.5 py-0.5 text-[10px] font-bold text-danger">late · {waitText(c.waitingMinutes)}</span>}
                        {c.sla === "due" && <span className="rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-bold text-warning">due · {waitText(c.waitingMinutes)}</span>}
                        {c.sla === "ok" && <span className="text-[10px] text-muted-foreground">waiting {waitText(c.waitingMinutes)}</span>}
                        {c.assignedAdminId === adminId && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">mine</span>}
                        {!c.assignedAdminId && c.status === "OPEN" && <span className="text-[10px] text-muted-foreground">unassigned</span>}
                        {c.rating ? <span className="text-[10px] text-warning">{"★".repeat(c.rating)}</span> : null}
                      </div>
                    </div>
                    {c.unreadCount > 0 && (
                      <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{c.unreadCount > 9 ? "9+" : c.unreadCount}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* CHAT */}
          <div className={`card flex h-[40rem] max-h-[calc(100dvh-8rem)] flex-col overflow-hidden ${selectedId ? "" : "hidden lg:flex"}`}>
            {!selectedId ? (
              <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">Choose a ticket to open the chat.</div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <button onClick={() => setSelectedId(null)} className="btn btn-ghost btn-sm lg:hidden" aria-label="Back to list">←</button>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">#{detail?.ticket.ticketNo ?? selected?.ticketNo} · {detail?.student.fullName ?? selected?.student.fullName}</p>
                      <p className="truncate text-xs text-muted-foreground">{detail?.student.email ?? selected?.student.email}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      value={detail?.ticket.priority ?? "NORMAL"}
                      onChange={(e) => act("meta", { method: "PATCH", body: JSON.stringify({ priority: e.target.value }) })}
                      className="border bg-background px-1.5 py-1 text-xs"
                      aria-label="Priority"
                    >
                      {PRIOS.map((p) => <option key={p} value={p}>{p.toLowerCase()}</option>)}
                    </select>
                    <select
                      value={detail?.ticket.category ?? "GENERAL"}
                      onChange={(e) => act("meta", { method: "PATCH", body: JSON.stringify({ category: e.target.value }) })}
                      className="border bg-background px-1.5 py-1 text-xs"
                      aria-label="Category"
                    >
                      {CATS.map((p) => <option key={p} value={p}>{p.toLowerCase()}</option>)}
                    </select>
                    {detail?.ticket.assignedAdminId === adminId ? (
                      <button onClick={() => act("assign", { method: "POST", body: JSON.stringify({ to: "none" }) })} className="btn btn-outline btn-sm">Unassign</button>
                    ) : (
                      <button onClick={() => act("assign", { method: "POST", body: JSON.stringify({ to: "me" }) })} className="btn btn-outline btn-sm">Take it</button>
                    )}
                    {resolved ? (
                      <button onClick={() => act("reopen", { method: "POST" })} className="btn btn-outline btn-sm">Reopen</button>
                    ) : (
                      <button
                        onClick={() => confirm("Mark this ticket as resolved? The student can still reopen it by writing again (within the reopen window).") && act("resolve", { method: "POST" })}
                        className="btn btn-sm border border-success/40 bg-success/10 text-success hover:bg-success/20"
                      >
                        ✅ Resolve
                      </button>
                    )}
                    <button onClick={() => setShowPanel((v) => !v)} className="btn btn-ghost btn-sm" aria-pressed={showPanel}>👤</button>
                  </div>
                </div>

                {showPanel && detail && (
                  <div className="animate-page grid gap-x-6 gap-y-1 border-b border-border bg-muted/30 px-4 py-2 text-xs sm:grid-cols-2">
                    <p><span className="text-muted-foreground">Plan:</span> <b>{detail.plan ? `${detail.plan.name} (till ${new Date(detail.plan.endsAt).toLocaleDateString("en-IN")})` : "Free"}</b></p>
                    <p><span className="text-muted-foreground">Tests taken:</span> <b>{detail.testsTaken}</b> · <span className="text-muted-foreground">Tickets:</span> <b>{detail.ticketsTotal}</b></p>
                    <p><span className="text-muted-foreground">Phone:</span> {detail.student.phone || "-"} · <span className="text-muted-foreground">State:</span> {detail.student.state || "-"}</p>
                    <p>
                      <span className="text-muted-foreground">Joined:</span> {new Date(detail.student.createdAt).toLocaleDateString("en-IN")}
                      {detail.student.isSuspended ? <b className="ml-1 text-danger">suspended</b> : null}
                      {!detail.student.isEmailVerified ? <b className="ml-1 text-warning">email not verified</b> : null}
                    </p>
                    {detail.ticket.context && (
                      <p className="sm:col-span-2">
                        <span className="text-muted-foreground">Was on:</span>{" "}
                        {detail.ticket.context.page ? <code className="rounded bg-muted px-1">{String(detail.ticket.context.page)}</code> : null}
                        {detail.ticket.context.attemptId ? <a className="ml-2 text-primary underline" href={`/results/${detail.ticket.context.attemptId}`} target="_blank" rel="noreferrer">open that result</a> : null}
                      </p>
                    )}
                    {detail.payments.length > 0 && (
                      <div className="sm:col-span-2">
                        <span className="text-muted-foreground">Recent payments:</span>
                        <ul className="mt-0.5">
                          {detail.payments.map((p, i) => (
                            <li key={i} className="flex flex-wrap gap-x-3">
                              <span>₹{p.amountInr}</span><span className={p.status === "SUCCESS" || p.status === "PAID" ? "text-success" : "text-warning"}>{p.status}</span>
                              <span className="text-muted-foreground">{new Date(p.createdAt).toLocaleDateString("en-IN")}</span>
                              <code className="text-muted-foreground">{p.gatewayOrderId || "-"}</code>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {detail.ticket.rating ? <p className="sm:col-span-2"><span className="text-muted-foreground">Student rated:</span> <b className="text-warning">{"★".repeat(detail.ticket.rating)}</b> {detail.ticket.ratingNote ? `- “${detail.ticket.ratingNote}”` : ""}</p> : null}
                  </div>
                )}

                <div className="flex-1 space-y-2 overflow-y-auto p-4">
                  {messages.map((m) => {
                    const mine = m.senderId === adminId;
                    const staff = m.senderRole !== "STUDENT";
                    return (
                      <div key={m.id} className={`flex ${staff ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                            m.isInternal ? "border border-dashed border-warning/60 bg-warning/10 text-foreground" : staff ? "rounded-br-sm bg-primary text-white" : "rounded-bl-sm bg-muted text-foreground"
                          }`}
                        >
                          <p className="text-[10px] font-bold opacity-70">
                            {m.isInternal ? "🔒 Internal note · " : ""}{mine ? "You" : m.senderName}
                          </p>
                          <p className="whitespace-pre-line break-words">{m.content}</p>
                          <p className="mt-0.5 text-right text-[9px] opacity-60">{new Date(m.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>

                <div className="border-t border-border p-3">
                  {resolved && !internal && (
                    <p className="mb-2 text-xs text-muted-foreground">This ticket is resolved. Reopen it to reply to the student, or add an internal note.</p>
                  )}
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-full border border-border p-0.5 text-xs font-semibold">
                      <button onClick={() => setInternal(false)} disabled={resolved} className={`rounded-full px-3 py-1 ${!internal ? "bg-primary text-primary-foreground" : "text-muted-foreground"} disabled:opacity-40`}>Reply</button>
                      <button onClick={() => setInternal(true)} className={`rounded-full px-3 py-1 ${internal ? "bg-warning text-white" : "text-muted-foreground"}`}>🔒 Internal note</button>
                    </div>
                    {cfg && cfg.canned.length > 0 && (
                      <select
                        value=""
                        onChange={(e) => {
                          const c = cfg.canned.find((x) => x.id === e.target.value);
                          if (c) setDraft((d) => (d ? `${d}\n${c.text}` : c.text));
                        }}
                        className="max-w-[14rem] border bg-background px-2 py-1 text-xs"
                        aria-label="Saved replies"
                      >
                        <option value="">⚡ Saved reply…</option>
                        {cfg.canned.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                      </select>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                      rows={2}
                      maxLength={4000}
                      placeholder={internal ? "Private note for the team (the student never sees it)…" : "Reply to the student… (Ctrl+Enter to send)"}
                      className={`min-w-0 flex-1 resize-none border bg-background px-3 py-2 text-sm ${internal ? "border-warning/60" : ""}`}
                    />
                    <button onClick={() => void send()} disabled={sending || !draft.trim() || (resolved && !internal)} className="btn btn-primary self-end">
                      {sending ? "…" : internal ? "Save note" : "Send"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </main>

      {showSettings && cfg && (
        <SettingsDialog
          cfg={cfg}
          onClose={() => setShowSettings(false)}
          onSaved={(c) => {
            setCfg(c);
            setSlaMin(c.slaMinutes);
            setShowSettings(false);
            void loadInbox();
          }}
        />
      )}
    </div>
  );
}

function SettingsDialog({ cfg, onClose, onSaved }: { cfg: Cfg; onClose: () => void; onSaved: (c: Cfg) => void }) {
  const [sla, setSla] = React.useState(cfg.slaMinutes);
  const [auto, setAuto] = React.useState(cfg.autoCloseDays);
  const [reopen, setReopen] = React.useState(cfg.reopenDays);
  const [canned, setCanned] = React.useState<Canned[]>(cfg.canned);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ config: Cfg }>("/support-chat/admin/config", {
        method: "PUT",
        body: JSON.stringify({ slaMinutes: sla, autoCloseDays: auto, reopenDays: reopen, canned }),
      });
      onSaved(r.config);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Help desk settings" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="animate-pop flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-card shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-lg font-bold">Help desk settings</h2>
          <button onClick={onClose} className="text-xl leading-none text-muted-foreground" aria-label="Close">×</button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold">Reply target (minutes)
              <input type="number" min={5} max={10080} value={sla} onChange={(e) => setSla(Number(e.target.value))} className="mt-1 w-full border bg-background px-3 py-2 text-sm" />
              <span className="mt-1 block font-normal text-muted-foreground">Student waiting longer = “late”.</span>
            </label>
            <label className="text-xs font-semibold">Auto-close after (days)
              <input type="number" min={1} max={90} value={auto} onChange={(e) => setAuto(Number(e.target.value))} className="mt-1 w-full border bg-background px-3 py-2 text-sm" />
              <span className="mt-1 block font-normal text-muted-foreground">We replied, student silent.</span>
            </label>
            <label className="text-xs font-semibold">Student can reopen (days)
              <input type="number" min={0} max={90} value={reopen} onChange={(e) => setReopen(Number(e.target.value))} className="mt-1 w-full border bg-background px-3 py-2 text-sm" />
              <span className="mt-1 block font-normal text-muted-foreground">After resolved. 0 = never.</span>
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">Saved replies ({canned.length}/40)</h3>
              <button onClick={() => canned.length < 40 && setCanned([...canned, { id: `new-${Date.now()}`, title: "", text: "" }])} className="btn btn-outline btn-sm">+ Add</button>
            </div>
            <div className="mt-2 space-y-3">
              {canned.map((c, i) => (
                <div key={c.id} className="rounded-xl border border-border p-3">
                  <div className="flex gap-2">
                    <input value={c.title} onChange={(e) => setCanned(canned.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} maxLength={80} placeholder="Title (shown in the list)" className="min-w-0 flex-1 border bg-background px-3 py-1.5 text-sm" />
                    <button onClick={() => setCanned(canned.filter((_, j) => j !== i))} className="btn btn-ghost btn-sm text-danger" aria-label="Delete reply">Delete</button>
                  </div>
                  <textarea value={c.text} onChange={(e) => setCanned(canned.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} maxLength={2000} rows={3} placeholder="The message that is inserted…" className="mt-2 w-full border bg-background p-2 text-sm" />
                </div>
              ))}
            </div>
          </div>
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button onClick={onClose} className="btn btn-outline">Cancel</button>
          <button onClick={save} disabled={busy} className="btn btn-primary">{busy ? "Saving…" : "Save settings"}</button>
        </div>
      </div>
    </div>
  );
}
