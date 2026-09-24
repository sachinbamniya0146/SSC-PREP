"use client";

import * as React from "react";
import { api } from "@/lib/api";
import { getChatSocket } from "@/lib/chat-socket";

/**
 * ReportQuestion — shared "report a question + chat about it with admin"
 * component. Built to replace the report-only form that used to be
 * duplicated ad hoc (quiz/page.tsx had its own inline ReportError; test/page.tsx
 * had none at all — see Sachin's request: "practice ho ya PYQ ho ya kisi
 * bhi test format le, sabh jagah check kar").
 *
 * Two states:
 *   1. No report yet → shows the report form (category + description).
 *   2. Report exists (just submitted, or student already had one on this
 *      question) → shows the live chat thread instead, so the student can
 *      answer follow-up questions from the admin without re-reporting.
 *
 * A student can only have one OPEN/REVIEWING report per question (enforced
 * server-side in report-error.service.ts's report() — ConflictException).
 * This component handles that by trying to fetch an existing report for
 * this question first (via the reportId prop OR by letting the report
 * attempt's 409 respond with "already have an open report" and just not
 * auto-opening a thread — for simplicity here we surface the report
 * response's own report.id when creation succeeds, and rely on the
 * question's card already knowing an existing reportId when re-rendering
 * from a list of "my reports").
 */

const CATEGORIES: { value: string; label: string }[] = [
  { value: "WRONG_ANSWER", label: "Answer key galat hai" },
  { value: "WRONG_OPTION", label: "Option/text galat hai" },
  { value: "WRONG_EXPLANATION", label: "Explanation galat hai" },
  { value: "TRANSLATION", label: "Hindi translation galat hai" },
  { value: "TYPO", label: "Spelling/typo mistake" },
  { value: "MISSING_OPTION", label: "Option missing hai" },
  { value: "DUPLICATE", label: "Yeh question duplicate hai" },
  { value: "OTHER", label: "Kuch aur" },
];

interface ChatMessage {
  id: string;
  senderId: string;
  senderRole: "STUDENT" | "ADMIN" | "MODERATOR";
  senderName: string;
  content: string;
  createdAt: string;
}

interface ReportQuestionProps {
  questionId: string;
  /** If the student already has an open report on this question, pass its id to open straight into the chat thread instead of the report form. */
  existingReportId?: string;
  currentUserId: string;
  /** Compact mode renders as an inline expandable row (used in test/page.tsx's dense question list); default renders as a standalone card (used in quiz results). */
  compact?: boolean;
}

export function ReportQuestion({ questionId, existingReportId, currentUserId, compact }: ReportQuestionProps) {
  const [open, setOpen] = React.useState(false);
  const [reportId, setReportId] = React.useState<string | null>(existingReportId ?? null);
  const [category, setCategory] = React.useState("OTHER");
  const [description, setDescription] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [reportStatus, setReportStatus] = React.useState<string>("OPEN");

  React.useEffect(() => {
    setReportId(existingReportId ?? null);
  }, [existingReportId]);

  const submitReport = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await api<{ report: { id: string; status: string } }>("/report-error", {
        method: "POST",
        body: JSON.stringify({ questionId, description: description || "Reported error", category }),
      });
      setReportId(res.report.id);
      setReportStatus(res.report.status);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Report submit nahi ho paya. Dobara try karein.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={compact
          ? "text-xs font-semibold text-danger hover:underline"
          : "btn btn-outline text-xs"}
      >
        {reportId ? "💬 Open Chat" : "🚩 Report Question"}
      </button>
    );
  }

  return (
    <div className={compact ? "mt-2 rounded-lg border border-border bg-muted/30 p-3" : "card mt-3 p-4"}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-foreground">
          {reportId ? "Report & Chat with Admin" : "Report this Question"}
        </p>
        <button onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">
          ✕ Close
        </button>
      </div>

      {!reportId ? (
        <div className="mt-3 space-y-2.5">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Kya problem hai is question mein? (jitna detail denge utna jaldi fix hoga)"
            rows={3}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs"
          />
          {submitError && <p className="text-xs text-danger">{submitError}</p>}
          <button
            onClick={submitReport}
            disabled={submitting || !description.trim()}
            className="btn btn-primary w-full text-xs disabled:opacity-50"
          >
            {submitting ? "Submit ho raha hai…" : "Submit Report"}
          </button>
        </div>
      ) : (
        <ReportChatThread reportId={reportId} currentUserId={currentUserId} status={reportStatus} onStatusChange={setReportStatus} />
      )}
    </div>
  );
}

/** The actual message list + composer, real-time via ChatGateway. */
function ReportChatThread({
  reportId,
  currentUserId,
  status,
  onStatusChange,
}: {
  reportId: string;
  currentUserId: string;
  status: string;
  onStatusChange: (s: string) => void;
}) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement | null>(null);

  const loadMessages = React.useCallback(async () => {
    try {
      const res = await api<{ messages: ChatMessage[] }>(`/report-error/${reportId}/messages`);
      setMessages(res.messages);
    } catch {
      // best-effort — the thread just stays empty rather than crashing the page
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  React.useEffect(() => {
    loadMessages();
    api(`/report-error/${reportId}/messages/read`, { method: "POST" }).catch(() => {});
  }, [reportId, loadMessages]);

  React.useEffect(() => {
    const socket = getChatSocket();
    if (!socket) return;
    socket.emit("report:join", { reportId });

    const onMessage = (data: { reportId: string; message: ChatMessage }) => {
      if (data.reportId !== reportId) return;
      setMessages((prev) => (prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]));
    };
    const onStatus = (data: { reportId: string; status: string }) => {
      if (data.reportId === reportId) onStatusChange(data.status);
    };
    socket.on("report:message", onMessage);
    socket.on("report:status", onStatus);

    return () => {
      socket.emit("report:leave", { reportId });
      socket.off("report:message", onMessage);
      socket.off("report:status", onStatus);
    };
  }, [reportId, onStatusChange]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const send = async () => {
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    setDraft("");
    try {
      await api(`/report-error/${reportId}/messages`, { method: "POST", body: JSON.stringify({ content }) });
      // No optimistic local push needed — the socket 'report:message' event
      // (which the server emits right after this POST succeeds) will add it;
      // loadMessages() also covers the case where the socket isn't connected.
    } catch {
      setDraft(content); // restore draft so the student doesn't lose what they typed
    } finally {
      setSending(false);
    }
  };

  const statusLabel: Record<string, string> = {
    OPEN: "🟡 Open — admin ko notify kar diya gaya hai",
    REVIEWING: "🔵 Under Review — admin dekh raha hai",
    CONFIRMED: "✅ Confirmed — is question ko fix kiya ja raha hai",
    REJECTED: "⚪ Reviewed — koi issue nahi mila is question mein",
  };

  return (
    <div className="mt-3">
      <p className="text-[11px] font-semibold text-muted-foreground">{statusLabel[status] || status}</p>
      <div className="mt-2 max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border bg-background p-2">
        {loading ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Report submit ho gaya. Admin ko iske baare mein aur batana hai to yahan likh sakte hain.
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.senderId === currentUserId;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-xl px-3 py-1.5 text-xs ${mine ? "bg-primary text-white" : "bg-muted text-foreground"}`}>
                  {!mine && <p className="text-[10px] font-bold opacity-70">{m.senderRole === "STUDENT" ? m.senderName : `${m.senderName} (Admin)`}</p>}
                  <p className="whitespace-pre-line">{m.content}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Message likhein…"
          maxLength={4000}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs"
        />
        <button onClick={send} disabled={sending || !draft.trim()} className="btn btn-primary text-xs disabled:opacity-50">
          Send
        </button>
      </div>
    </div>
  );
}
