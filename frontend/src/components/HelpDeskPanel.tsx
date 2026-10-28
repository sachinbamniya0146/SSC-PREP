"use client";
import * as React from "react";
import { api } from "@/lib/api";
import { getChatSocket } from "@/lib/chat-socket";
import { useFeatures } from "@/lib/features";
import { useT } from "@/lib/i18n";

/**
 * Student help desk (Oct 28 2026): quick answers (FAQ) -> one-tap ticket with a category and the page the student was on
 * -> live chat with the team -> resolved: rate it or bring it back. Used inside the floating chat button AND on /help.
 */

export interface Ticket {
  id: string;
  ticketNo: number;
  status: "OPEN" | "RESOLVED";
  category: string;
  subject: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  rating: number | null;
  unreadCount: number;
  canRate: boolean;
  canReopen: boolean;
}
interface Msg {
  id: string;
  senderId: string;
  senderRole: "STUDENT" | "ADMIN" | "MODERATOR";
  senderName: string;
  content: string;
  createdAt: string;
}

export const CATEGORIES: { key: string; en: string; hi: string; icon: string }[] = [
  { key: "PAYMENT", en: "Payment / plan", hi: "Payment / plan", icon: "💳" },
  { key: "TEST", en: "Test / result", hi: "Test / result", icon: "📝" },
  { key: "QUESTION", en: "Wrong question / answer", hi: "Galat question / answer", icon: "❓" },
  { key: "ACCOUNT", en: "Login / account", hi: "Login / account", icon: "👤" },
  { key: "TECHNICAL", en: "App problem", hi: "App me problem", icon: "🛠️" },
  { key: "GENERAL", en: "Something else", hi: "Kuch aur", icon: "💬" },
];

const FAQ: { q: [string, string]; a: [string, string]; k: string }[] = [
  {
    q: ["I paid but my plan is not active", "Payment ho gaya par plan active nahi hua"],
    a: ["Plans activate automatically within a few minutes of the payment (banks sometimes delay the confirmation). If it is still not active after 30 minutes, open a ticket with the order id / UTR from your bank SMS.", "Payment ke kuch minute me plan apne aap active ho jata hai (bank kabhi confirmation late bhejta hai). 30 minute baad bhi active na ho to bank SMS ka order id / UTR ke saath ticket kholo."],
    k: "payment plan active paid upi order",
  },
  {
    q: ["My test did not submit / score is missing", "Test submit nahi hua / score nahi dikha"],
    a: ["Your answers are saved on our server as you go, so nothing is lost. Open Results and check the latest attempt. If it is missing, open a ticket with the test name and the time you took it.", "Aapke jawab test ke dauran server par save hote rehte hain, kuch nahi khota. Results me latest attempt dekho. Na mile to test ka naam aur samay batakar ticket kholo."],
    k: "test submit score missing result attempt",
  },
  {
    q: ["How is my rank calculated?", "Meri rank kaise banti hai?"],
    a: ["Only each student's first attempt of a test counts. Higher score ranks higher; at the same score the faster time ranks higher; equal score and time share a rank. Retakes show a practice rank and never change real ranks. Choose your state in Profile to see your State rank too.", "Rank me sirf pehla attempt ginta hai. Zyada score upar; same score par kam time wala upar; score aur time dono same ho to rank share hoti hai. Retake practice rank dikhata hai, asli rank nahi badalta. State rank ke liye Profile me apna state chuno."],
    k: "rank state percentile leaderboard topper",
  },
  {
    q: ["I found a wrong question or answer", "Mujhe galat question ya answer mila"],
    a: ["Use the flag / report button on the question (in the test or in the review). Our team verifies it against the official answer key and fixes it within 24 hours. You can also open a ticket with the question number.", "Question par flag / report button dabao (test ya review me). Team official answer key se check karke 24 ghante me theek karti hai. Question number ke saath ticket bhi khol sakte ho."],
    k: "wrong question answer galat report error key",
  },
  {
    q: ["I cannot log in", "Login nahi ho raha"],
    a: ["Use “Forgot password” on the login page. If you signed up with Google, use “Continue with Google”. Still stuck? Open a ticket with your registered email.", "Login page par “Forgot password” use karo. Google se signup kiya ho to “Continue with Google” dabao. Phir bhi na ho to registered email ke saath ticket kholo."],
    k: "login password forgot google email otp",
  },
  {
    q: ["How do bookmarks work?", "Bookmark kaise kaam karta hai?"],
    a: ["Tap the ★ on any question in a test or in the review. Everything you save is in Bookmarks, with the real paper question number, your own notes, and a one-tap practice set. Answers unlock after you finish a test with that question.", "Test ya review me kisi bhi question par ★ dabao. Sab kuch Bookmarks me milta hai - asli paper ka question number, apne notes aur ek tap me practice set. Answer tab khulta hai jab aap us question ke saath test poora kar lo."],
    k: "bookmark star save revision note",
  },
  {
    q: ["Refund", "Refund"],
    a: ["Refunds follow our Refund Policy (/refund). Open a ticket with the order id and the reason and we will review it.", "Refund hamari Refund Policy (/refund) ke hisaab se hota hai. Order id aur wajah ke saath ticket kholo, hum check karenge."],
    k: "refund money back cancel",
  },
];

const timeAgo = (iso: string) => {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
};

function pageContext(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const ctx: Record<string, string> = { page: window.location.pathname + window.location.search.slice(0, 120) };
  const m = window.location.pathname.match(/^\/results\/([A-Za-z0-9_-]{6,80})/);
  if (m) ctx.attemptId = m[1];
  return ctx;
}

type View = "home" | "chat" | "list";

export default function HelpDeskPanel({
  currentUserId,
  variant,
  onUnread,
  onClose,
}: {
  currentUserId: string;
  variant: "widget" | "page";
  onUnread?: (n: number) => void;
  onClose?: () => void;
}) {
  const tr = useT();
  const { on } = useFeatures();
  const [tickets, setTickets] = React.useState<Ticket[] | null>(null);
  const [view, setView] = React.useState<View>("home");
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [msgLoading, setMsgLoading] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [faqQ, setFaqQ] = React.useState("");
  const [openFaq, setOpenFaq] = React.useState<number | null>(null);
  const [category, setCategory] = React.useState("");
  const [newText, setNewText] = React.useState("");
  const [rate, setRate] = React.useState(0);
  const [rateNote, setRateNote] = React.useState("");
  const bottomRef = React.useRef<HTMLDivElement | null>(null);
  const firstLoad = React.useRef(true);

  const active = tickets?.find((t) => t.id === activeId) ?? null;
  const openTicket = tickets?.find((t) => t.status === "OPEN") ?? null;

  const loadTickets = React.useCallback(async () => {
    try {
      const d = await api<{ conversations: Ticket[] }>("/support-chat/my-conversations");
      setTickets(d.conversations);
      onUnread?.(d.conversations.reduce((a, c) => a + (c.unreadCount || 0), 0));
      return d.conversations;
    } catch {
      setTickets((t) => t ?? []);
      return null;
    }
  }, [onUnread]);

  const loadMessages = React.useCallback(
    async (id: string, quiet = false) => {
      if (!quiet) setMsgLoading(true);
      try {
        const d = await api<{ messages: Msg[] }>(`/support-chat/${id}/messages`);
        setMessages((prev) => {
          const map = new Map<string, Msg>();
          for (const m of d.messages) map.set(m.id, m);
          // keep a message we just posted that the server list does not have yet
          for (const m of prev) if (!map.has(m.id) && m.id.startsWith("tmp-")) map.set(m.id, m);
          return [...map.values()].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
        });
        api(`/support-chat/${id}/messages/read`, { method: "POST" }).catch(() => {});
      } catch (e) {
        if (!quiet) setErr(e instanceof Error ? e.message : "Could not load the chat");
      } finally {
        if (!quiet) setMsgLoading(false);
      }
    },
    [],
  );

  // first load: jump straight into the open ticket, if any
  React.useEffect(() => {
    void loadTickets().then((list) => {
      if (!firstLoad.current || !list) return;
      firstLoad.current = false;
      const open = list.find((t) => t.status === "OPEN");
      if (open) {
        setActiveId(open.id);
        setView("chat");
      }
    });
    const timer = window.setInterval(() => void loadTickets(), 45_000);
    return () => window.clearInterval(timer);
  }, [loadTickets]);

  // messages of the active ticket: initial load + live socket + slow poll as a fallback
  React.useEffect(() => {
    if (view !== "chat" || !activeId) return;
    setMessages([]);
    setErr("");
    void loadMessages(activeId);
    const socket = getChatSocket();
    socket?.emit("conversation:join", { conversationId: activeId });
    const onMessage = (data: { conversationId: string; message: Msg & { system?: boolean } }) => {
      if (data.conversationId !== activeId) return;
      if (data.message.system) {
        void loadTickets();
        return;
      }
      setMessages((prev) => (prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]));
      if (data.message.senderId !== currentUserId) api(`/support-chat/${activeId}/messages/read`, { method: "POST" }).catch(() => {});
    };
    socket?.on("conversation:message", onMessage);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadMessages(activeId, true);
    }, 15_000);
    return () => {
      socket?.emit("conversation:leave", { conversationId: activeId });
      socket?.off("conversation:message", onMessage);
      window.clearInterval(poll);
    };
  }, [view, activeId, currentUserId, loadMessages, loadTickets]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, view]);

  const startTicket = async () => {
    const message = newText.trim();
    if (!message) {
      setErr(tr("Please describe your problem first.", "Pehle apni problem likho."));
      return;
    }
    setSending(true);
    setErr("");
    try {
      const r = await api<{ conversation: { id: string } }>("/support-chat/start", {
        method: "POST",
        body: JSON.stringify({ category: category || "GENERAL", message, context: pageContext() }),
      });
      setNewText("");
      setCategory("");
      await loadTickets();
      setActiveId(r.conversation.id);
      setView("chat");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not open the ticket");
    } finally {
      setSending(false);
    }
  };

  const send = async () => {
    const content = draft.trim();
    if (!content || !activeId || sending) return;
    setSending(true);
    setErr("");
    setDraft("");
    try {
      const r = await api<{ message: Msg; reopened?: boolean }>(`/support-chat/${activeId}/messages`, { method: "POST", body: JSON.stringify({ content }) });
      setMessages((prev) => (prev.some((m) => m.id === r.message.id) ? prev : [...prev, r.message]));
      if (r.reopened) void loadTickets();
    } catch (e) {
      setDraft(content);
      setErr(e instanceof Error ? e.message : "Could not send");
      void loadTickets();
    } finally {
      setSending(false);
    }
  };

  const reopen = async () => {
    if (!activeId) return;
    setErr("");
    try {
      await api(`/support-chat/${activeId}/reopen-mine`, { method: "POST" });
      await loadTickets();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not reopen");
    }
  };

  const submitRating = async () => {
    if (!activeId || rate < 1) return;
    setErr("");
    try {
      await api(`/support-chat/${activeId}/rate`, { method: "POST", body: JSON.stringify({ rating: rate, note: rateNote }) });
      setRate(0);
      setRateNote("");
      await loadTickets();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save your rating");
    }
  };

  const faqList = FAQ.filter((f) => {
    const s = faqQ.trim().toLowerCase();
    return !s || `${f.q[0]} ${f.q[1]} ${f.k}`.toLowerCase().includes(s);
  });
  const canNew = on("helpDesk");
  const h = variant === "widget" ? "h-[34rem] max-h-[calc(100dvh-7rem)]" : "min-h-[32rem]";

  const tabBtn = (v: View, label: string, badge?: number) => (
    <button
      onClick={() => {
        setView(v);
        setErr("");
      }}
      className={`relative flex-1 border-b-2 px-2 py-2 text-xs font-semibold transition ${view === v || (v === "chat" && view === "chat") ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
    >
      {label}
      {!!badge && <span className="ml-1 rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white">{badge}</span>}
    </button>
  );
  const totalUnread = tickets?.reduce((a, t) => a + t.unreadCount, 0) ?? 0;

  return (
    <div className={`flex flex-col overflow-hidden bg-card ${variant === "widget" ? "w-[22rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-border shadow-2xl" : "rounded-2xl border border-border"} ${h}`}>
      <div className="flex items-center justify-between bg-primary px-4 py-3 text-white">
        <div>
          <p className="text-sm font-bold">💬 {tr("Help desk", "Help desk")}</p>
          <p className="text-[11px] text-white/80">{tr("We usually reply within a few hours", "Hum aam taur par kuch ghanton me jawab dete hain")}</p>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-lg leading-none text-white/80 hover:text-white">✕</button>
        )}
      </div>

      <div className="flex border-b border-border">
        {tabBtn("home", tr("Help", "Help"))}
        {tabBtn("chat", openTicket || active ? tr("Chat", "Chat") : tr("New", "Naya"))}
        {tabBtn("list", tr("My tickets", "Mere tickets"), totalUnread || undefined)}
      </div>

      {/* HOME: FAQ + new ticket */}
      {view === "home" && (
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <input
            value={faqQ}
            onChange={(e) => setFaqQ(e.target.value)}
            placeholder={tr("Search quick answers…", "Jaldi jawab search karo…")}
            className="w-full border bg-background px-3 py-2 text-sm"
            aria-label="Search help"
          />
          <div className="space-y-1.5">
            {faqList.length === 0 && <p className="text-xs text-muted-foreground">{tr("No quick answer found - send us a message below.", "Koi jaldi jawab nahi mila - neeche message bhejo.")}</p>}
            {faqList.map((f, i) => (
              <div key={f.q[0]} className="rounded-lg border border-border">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  aria-expanded={openFaq === i}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-semibold"
                >
                  <span>{tr(f.q[0], f.q[1])}</span>
                  <span className={`transition-transform ${openFaq === i ? "rotate-180" : ""}`}>⌄</span>
                </button>
                {openFaq === i && <p className="animate-page border-t border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground">{tr(f.a[0], f.a[1])}</p>}
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-muted/30 p-3">
            {openTicket ? (
              <>
                <p className="text-xs font-semibold">{tr(`You already have an open ticket (#${openTicket.ticketNo}).`, `Aapka ek ticket (#${openTicket.ticketNo}) pehle se khula hai.`)}</p>
                <button
                  onClick={() => {
                    setActiveId(openTicket.id);
                    setView("chat");
                  }}
                  className="btn btn-primary btn-sm mt-2"
                >
                  {tr("Continue the chat", "Chat jaari rakho")}
                </button>
              </>
            ) : !canNew ? (
              <p className="text-xs text-muted-foreground">{tr("New tickets are paused for now. Please check back later.", "Naye ticket abhi band hain. Thodi der baad aao.")}</p>
            ) : (
              <>
                <p className="text-xs font-bold">{tr("Still need help? Tell us what it is about", "Phir bhi help chahiye? Batao kis baare me")}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.key}
                      onClick={() => setCategory(category === c.key ? "" : c.key)}
                      aria-pressed={category === c.key}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${category === c.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
                    >
                      {c.icon} {tr(c.en, c.hi)}
                    </button>
                  ))}
                </div>
                <textarea
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                  rows={3}
                  maxLength={4000}
                  placeholder={tr("Describe the problem (order id, test name, question number…)", "Problem likho (order id, test ka naam, question number…)")}
                  className="mt-2 w-full border bg-background p-2 text-sm"
                />
                <button onClick={startTicket} disabled={sending || !newText.trim()} className="btn btn-primary btn-sm mt-2 w-full">
                  {sending ? tr("Sending…", "Bhej rahe…") : tr("Send to support", "Support ko bhejo")}
                </button>
              </>
            )}
            {err && view === "home" && <p className="mt-2 text-xs text-danger">{err}</p>}
          </div>
        </div>
      )}

      {/* LIST */}
      {view === "list" && (
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {tickets === null ? (
            <p className="py-6 text-center text-xs text-muted-foreground">…</p>
          ) : tickets.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">{tr("No tickets yet.", "Abhi koi ticket nahi.")}</p>
          ) : (
            tickets.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setActiveId(t.id);
                  setView("chat");
                }}
                className="flex w-full items-start gap-3 rounded-xl border border-border p-3 text-left transition hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold">#{t.ticketNo} · {t.subject || tr("New ticket", "Naya ticket")}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {t.category.toLowerCase()} · {timeAgo(t.updatedAt)}
                    {t.rating ? ` · ${"★".repeat(t.rating)}` : ""}
                  </p>
                </div>
                {t.unreadCount > 0 && <span className="rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white">{t.unreadCount}</span>}
                <span className={`badge ${t.status === "OPEN" ? "badge-info" : "badge-success"}`}>{t.status === "OPEN" ? tr("Open", "Khula") : tr("Resolved", "Solve")}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* CHAT */}
      {view === "chat" && !active && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">{tr("No open ticket. Start a new one from the Help tab.", "Koi khula ticket nahi. Help tab se naya shuru karo.")}</p>
          <button onClick={() => setView("home")} className="btn btn-primary btn-sm">{tr("Open Help", "Help kholo")}</button>
        </div>
      )}
      {view === "chat" && active && (
        <>
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
            <p className="truncate text-xs font-bold">#{active.ticketNo} · {active.subject || tr("New ticket", "Naya ticket")}</p>
            <span className={`badge ${active.status === "OPEN" ? "badge-info" : "badge-success"}`}>{active.status === "OPEN" ? tr("Open", "Khula") : tr("Resolved", "Solve")}</span>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {msgLoading && messages.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">{tr("Loading…", "Load ho raha…")}</p>
            ) : messages.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">{tr("Write your message below.", "Neeche apna message likho.")}</p>
            ) : (
              messages.map((m) => {
                const mine = m.senderId === currentUserId;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs ${mine ? "rounded-br-sm bg-primary text-white" : "rounded-bl-sm bg-muted text-foreground"}`}>
                      {!mine && <p className="text-[10px] font-bold opacity-70">{m.senderName} · {tr("Support", "Support")}</p>}
                      <p className="whitespace-pre-line break-words">{m.content}</p>
                      <p className={`mt-0.5 text-right text-[9px] ${mine ? "text-white/70" : "text-muted-foreground"}`}>
                        {new Date(m.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                );
              })
            )}

            {active.status === "RESOLVED" && (
              <div className="animate-page rounded-xl border border-success/30 bg-success/5 p-3 text-xs">
                <p className="font-bold text-success">✓ {tr("This ticket is resolved.", "Ye ticket solve ho gaya.")}</p>
                {active.canRate ? (
                  <div className="mt-2">
                    <p className="text-muted-foreground">{tr("How was our help?", "Hamari help kaisi lagi?")}</p>
                    <div className="mt-1 flex gap-1" role="radiogroup" aria-label="Rating">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} role="radio" aria-checked={rate === n} onClick={() => setRate(n)} className={`text-2xl leading-none transition active:scale-90 ${n <= rate ? "text-warning" : "text-muted-foreground/40"}`} aria-label={`${n} star`}>
                          ★
                        </button>
                      ))}
                    </div>
                    {rate > 0 && (
                      <>
                        <input value={rateNote} onChange={(e) => setRateNote(e.target.value)} maxLength={500} placeholder={tr("Anything to add? (optional)", "Kuch kehna hai? (optional)")} className="mt-2 w-full border bg-background px-2 py-1.5 text-xs" />
                        <button onClick={submitRating} className="btn btn-primary btn-sm mt-2">{tr("Send rating", "Rating bhejo")}</button>
                      </>
                    )}
                  </div>
                ) : active.rating ? (
                  <p className="mt-1 text-muted-foreground">{tr("Your rating", "Aapki rating")}: <span className="text-warning">{"★".repeat(active.rating)}</span></p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {active.canReopen && !openTicket && <button onClick={reopen} className="btn btn-outline btn-sm">{tr("Problem not solved? Reopen", "Problem nahi suljhi? Dobara kholo")}</button>}
                  {canNew && !openTicket && <button onClick={() => setView("home")} className="btn btn-outline btn-sm">{tr("New ticket", "Naya ticket")}</button>}
                  {openTicket && openTicket.id !== active.id && (
                    <button onClick={() => setActiveId(openTicket.id)} className="btn btn-outline btn-sm">{tr(`Open ticket #${openTicket.ticketNo}`, `Khula ticket #${openTicket.ticketNo}`)}</button>
                  )}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          {err && <p role="alert" className="border-t border-border bg-danger/5 px-3 py-1.5 text-xs text-danger">{err}</p>}
          {(active.status === "OPEN" || (active.canReopen && !openTicket)) && (
            <div className="flex gap-2 border-t border-border p-3">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={active.status === "OPEN" ? tr("Type your message…", "Apna message likhein…") : tr("Write here to reopen this ticket…", "Ticket dobara kholne ke liye yahan likho…")}
                maxLength={4000}
                className="min-w-0 flex-1 border bg-background px-3 py-2 text-sm"
              />
              <button onClick={() => void send()} disabled={sending || !draft.trim()} className="btn btn-primary btn-sm">
                {tr("Send", "Bhejo")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
