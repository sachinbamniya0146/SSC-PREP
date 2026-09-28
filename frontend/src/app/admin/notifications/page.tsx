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

type BroadcastResult = { sent: number; failed: number; total?: number; disabled?: boolean };

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
  const [result, setResult] = React.useState<BroadcastResult | null>(null);
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

  const send = async () => {
    if (!title.trim() || !body.trim()) {
      setErr("Title aur message dono likhna zaroori hai.");
      return;
    }
    const ok = confirm(`Yeh notification SABHI students ko bhej diya jaayega:\n\n"${title}"\n${body}\n\nContinue?`);
    if (!ok) return;

    setSending(true);
    setErr("");
    setResult(null);
    try {
      const r = await fetchAuth(`${API_BASE}/push/admin/broadcast`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, url }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(d?.message || "Bhejne me kuch gadbad ho gayi.");
        return;
      }
      if (d?.disabled) {
        setErr(
          "Push notifications abhi server pe configure nahi hain — VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars set karke backend restart karo (.env.example dekho).",
        );
        return;
      }
      setResult(d);
      setTitle("");
      setBody("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Bhejne me kuch gadbad ho gayi.");
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
            🔔 Send Notification <span className="text-muted-foreground">to All Students</span>
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="mb-6 text-sm text-muted-foreground">
          Yahan se bheja gaya message sabhi students ke phone/laptop par
          push-notification ki tarah pahunchega — sirf un students ko jinhone
          notifications "Enable" ki hain.
        </p>

        <div className="card space-y-4 p-5">
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
              Bhej diya — {result.sent} devices ko successfully mila
              {result.failed ? `, ${result.failed} fail ho gaye` : ""}.
            </p>
          )}

          <button
            onClick={send}
            disabled={sending}
            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {sending ? "Sending..." : "Send to All Students"}
          </button>
        </div>
      </main>
    </div>
  );
}
