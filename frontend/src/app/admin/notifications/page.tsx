"use client";

// Admin -> All Students push notification broadcast.
//
// "admin chahe to kuch new notification sbh students ke mobile pr send kr
// ske" — this page is that control panel. It calls
// POST /push/admin/broadcast (backend/src/push), which fans the message
// out to every subscribed STUDENT device via Web Push (see push.service.ts).
// Students only receive these if they tapped "Enable" on the
// PushNotificationMount banner at least once — there is no way around
// that, browsers require explicit permission for push.

import * as React from "react";
import { useRouter } from "next/navigation";
import { API_BASE, fetchAuth } from "@/lib/api";
import { BackButton } from "@/components/BackButton";
import { Logo } from "@/components/Logo";

type SendResult = { students: number; pushed: number; failed: number; pushAvailable: boolean };
type AudienceType = "ALL" | "TARGET_EXAM" | "INACTIVE" | "HAS_WEAK";
type Preview = { students: number; devices: number; pushAvailable: boolean };

const PRESETS = [
  { title: "New Mock Test Live! 🎯", body: "A fresh SSC CGL mock test is now available. Attempt it now!", url: "/mocks" },
  { title: "Daily Streak Reminder 🔥", body: "Don't break your streak — today's practice is waiting.", url: "/dashboard" },
  { title: "Results Declared 📊", body: "Your test results are ready. Check your rank now.", url: "/results" },
];

export default function AdminNotificationsPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [url, setUrl] = React.useState("/dashboard");
  const [sending, setSending] = React.useState(false);
  const [result, setResult] = React.useState<SendResult | null>(null);
  const [aType, setAType] = React.useState<AudienceType>("ALL");
  const [examId, setExamId] = React.useState("");
  const [days, setDays] = React.useState(3);
  const [exams, setExams] = React.useState<{ id: string; name: string }[]>([]);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [pushState, setPushState] = React.useState<{ enabled: boolean; devices: number; students: number } | null>(null);
  const [err, setErr] = React.useState("");

  const headers = React.useCallback(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") : "";
    return { Authorization: `Bearer ${t || ""}` };
  }, []);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem("ssc_user");
      const user = raw ? JSON.parse(raw) : null;
      const isAdmin = user?.role === "ADMIN" || user?.role === "MODERATOR";
      if (!isAdmin) {
        router.replace("/dashboard");
        return;
      }
    } catch {
      router.replace("/dashboard");
      return;
    }
    setAuthChecked(true);
  }, [router]);

  const audience = React.useMemo(
    () => ({ type: aType, ...(aType === "TARGET_EXAM" ? { examId } : {}), ...(aType === "INACTIVE" ? { days } : {}) }),
    [aType, examId, days],
  );

  React.useEffect(() => {
    if (!authChecked) return;
    (async () => {
      try {
        const r = await fetchAuth(`${API_BASE}/bank/meta`, { headers: headers() });
        const d = await r.json().catch(() => ({}));
        setExams(Array.isArray(d?.exams) ? d.exams.map((e: { id: string; name: string }) => ({ id: e.id, name: e.name })) : []);
      } catch { /* the exam list simply stays empty */ }
    })();
  }, [authChecked, headers]);

  React.useEffect(() => {
    if (!authChecked) return;
    (async () => {
      try {
        const r = await fetchAuth(`${API_BASE}/push/admin/status`, { headers: headers() });
        if (r.ok) setPushState(await r.json());
      } catch { /* the banner just stays hidden */ }
    })();
  }, [authChecked, headers]);

  // live "this reaches N students" count for the chosen group
  React.useEffect(() => {
    if (!authChecked) return;
    if (aType === "TARGET_EXAM" && !examId) { setPreview(null); return; }
    let live = true;
    (async () => {
      try {
        const r = await fetchAuth(`${API_BASE}/notifications/admin/audience`, {
          method: "POST",
          headers: { ...headers(), "Content-Type": "application/json" },
          body: JSON.stringify(audience),
        });
        const d = await r.json().catch(() => null);
        if (live) setPreview(r.ok && d ? d : null);
      } catch { if (live) setPreview(null); }
    })();
    return () => { live = false; };
  }, [authChecked, audience, aType, examId, headers]);

  const send = async () => {
    if (!title.trim() || !body.trim()) {
      setErr("Both a title and a message are required.");
      return;
    }
    if (aType === "TARGET_EXAM" && !examId) {
      setErr("Choose the exam first.");
      return;
    }
    const who = preview ? `${preview.students} students` : "the chosen students";
    const ok = confirm(`This message will be sent to ${who}:\n\n"${title}"\n${body}\n\nContinue?`);
    if (!ok) return;

    setSending(true);
    setErr("");
    setResult(null);
    try {
      const r = await fetchAuth(`${API_BASE}/notifications/admin/send`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, url, audience }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(d?.message || "Something went wrong while sending.");
        return;
      }
      setResult(d);
      setTitle("");
      setBody("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong while sending.");
    } finally {
      setSending(false);
    }
  };

  if (!authChecked) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <BackButton />
          <Logo size={32} withWordmark={false} />
          <span className="text-lg font-bold tracking-tight">
            🔔 Call students <span className="text-muted-foreground">— notifications</span>
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="mb-6 text-sm text-muted-foreground">
          A message sent from here lands in the Notifications inbox of every student in the group you choose, and also on their phone
          if they turned phone alerts on. Smart reminders (unfinished test, streak, weak topics, come-back) go out by themselves.
        </p>

        {pushState && (
          <div className={`card mb-4 p-4 text-sm ${pushState.enabled ? "border-success/40 bg-success/5" : "border-warning/40 bg-warning/5"}`} role="status">
            {pushState.enabled ? (
              <p><b>Phone alerts: ON.</b> {pushState.students} students ({pushState.devices} phones) can get alerts in the notification bar right now.</p>
            ) : (
              <p>
                <b>Phone alerts: OFF</b> — the server has no VAPID keys, so messages reach only the in-app inbox. To switch them on: create the keys once
                (command in UPDATE_S50 file), put <code>VAPID_PUBLIC_KEY</code> and <code>VAPID_PRIVATE_KEY</code> in the server <code>.env</code>, then deploy again.
              </p>
            )}
          </div>
        )}

        <div className="card space-y-4 p-5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">Who should get it?</label>
            <div className="flex flex-wrap gap-2">
              <select value={aType} onChange={(e) => setAType(e.target.value as AudienceType)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary">
                <option value="ALL">All students</option>
                <option value="TARGET_EXAM">Students preparing for one exam</option>
                <option value="INACTIVE">Students who stopped practising</option>
                <option value="HAS_WEAK">Students with weak topics</option>
              </select>
              {aType === "TARGET_EXAM" && (
                <select value={examId} onChange={(e) => setExamId(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary">
                  <option value="">Choose exam…</option>
                  {exams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              )}
              {aType === "INACTIVE" && (
                <label className="flex items-center gap-2 text-sm">
                  no practice for
                  <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))} className="w-20 rounded-lg border border-border bg-background px-2 py-2 text-sm" />
                  days
                </label>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground" role="status">
              {preview ? `Reaches ${preview.students} students (${preview.devices} phones with alerts on).` : aType === "TARGET_EXAM" && !examId ? "Choose an exam to see the count." : "Counting…"}
              {preview && !preview.pushAvailable ? " Phone alerts are not configured on the server (VAPID keys), so the message will only show in the inbox." : ""}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={65}
              placeholder="e.g. New Mock Test Live! 🎯"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              maxLength={180}
              placeholder="Short, punchy message students will see."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">
              Open this page on tap (optional)
            </label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="/dashboard"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {PRESETS.map((p) => (
              <button
                key={p.title}
                onClick={() => {
                  setTitle(p.title);
                  setBody(p.body);
                  setUrl(p.url);
                }}
                className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted"
              >
                {p.title}
              </button>
            ))}
          </div>

          {err && <p className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{err}</p>}
          {result && (
            <p className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
              Bhej diya — {result.students} students ke inbox me, {result.pushed} phones par alert
              {result.failed ? `, ${result.failed} phones failed` : ""}.
              {!result.pushAvailable ? " (Phone alerts server par configured nahi hain, isliye sirf inbox me gaya.)" : ""}
            </p>
          )}

          <button
            onClick={send}
            disabled={sending}
            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
      </main>
    </div>
  );
}
