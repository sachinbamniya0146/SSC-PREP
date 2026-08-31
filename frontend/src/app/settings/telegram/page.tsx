"use client";

// Requirement 1/5 — dedicated Telegram settings page.
//
// This is intentionally a NEW page rather than a reuse of the Telegram
// block already sitting inside /profile: that block asks the user to type
// in a raw numeric Telegram "Chat ID" (via @userinfobot) and POSTs it
// straight to /telegram/link. That flow was never how this feature was
// designed — the backend has a proper generate-code flow
// (POST /telegram/link/generate-code -> user sends "/link CODE" to the bot
// -> the bot's webhook verifies + links automatically, see
// telegram.controller.ts's /link CODE handler) which is the ONLY flow that
// proves the person actually controls that Telegram chat. This page uses
// that flow. (The /profile block is left untouched here — flagging it for
// a follow-up cleanup pass, not touching it in this change.)

import * as React from "react";
import { api } from "@/lib/api";

interface TelegramAccount {
  userId: string;
  chatId: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  isActive: boolean;
  subscriptions: { type: string; isActive: boolean }[];
}

type GenerateCodeResponse =
  | { ok: true; code: string; expiresInSeconds: number }
  | { ok: false; error: string };

// Same 5 types telegram.controller.ts's /subscribe validTypes accepts.
const SUBSCRIPTION_TYPES: { key: string; label: string; blurb: string }[] = [
  { key: "daily_practice", label: "📝 Daily Practice", blurb: "One question a day to keep the streak going." },
  { key: "weak_topic_analysis", label: "🎯 Weak-Topic Analysis", blurb: "A daily nudge on the chapters costing you the most marks." },
  { key: "mock_results", label: "📊 Mock Results", blurb: "Get your result + PDF the moment you submit a test." },
  { key: "leaderboard", label: "🏆 Leaderboard", blurb: "Rank updates against other aspirants." },
  { key: "announcements", label: "📢 Announcements", blurb: "Important updates from the SSC Prep Hub team." },
];

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "";

export default function TelegramSettingsPage() {
  // undefined = still loading, null = not linked, object = linked
  const [account, setAccount] = React.useState<TelegramAccount | null | undefined>(undefined);
  const [generating, setGenerating] = React.useState(false);
  const [code, setCode] = React.useState<{ value: string; expiresAt: number } | null>(null);
  const [secondsLeft, setSecondsLeft] = React.useState(0);
  const [genError, setGenError] = React.useState("");
  const [busyType, setBusyType] = React.useState<string | null>(null);
  const [toggleError, setToggleError] = React.useState("");

  const loadAccount = React.useCallback(async () => {
    try {
      const data = await api<TelegramAccount | null>("/telegram/account");
      setAccount(data);
      if (data) setCode(null); // a code that just got consumed — stop showing it
    } catch {
      setAccount(null);
    }
  }, []);

  React.useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  // While a code is showing and the account isn't linked yet, poll every 4s
  // so the page flips to "Linked" on its own the moment the user sends
  // /link CODE in Telegram — no manual refresh needed.
  React.useEffect(() => {
    if (!code || account) return;
    const id = setInterval(loadAccount, 4000);
    return () => clearInterval(id);
  }, [code, account, loadAccount]);

  // 1-second countdown for the code's TTL.
  React.useEffect(() => {
    if (!code) return;
    const tick = () => {
      const left = Math.max(0, Math.round((code.expiresAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) setCode(null);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [code]);

  async function generateCode() {
    setGenerating(true);
    setGenError("");
    try {
      const res = await api<GenerateCodeResponse>("/telegram/link/generate-code", { method: "POST" });
      if (!res.ok) {
        setGenError(res.error);
        return;
      }
      setCode({ value: res.code, expiresAt: Date.now() + res.expiresInSeconds * 1000 });
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Could not generate a code. Try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function toggleSubscription(type: string, currentlyOn: boolean) {
    setBusyType(type);
    setToggleError("");
    try {
      const res = await api<{ ok: boolean; error?: string }>(
        `/telegram/${currentlyOn ? "unsubscribe" : "subscribe"}/${type}`,
        { method: "POST" },
      );
      if (!res.ok) {
        setToggleError(res.error || "Could not update that subscription.");
        return;
      }
      await loadAccount();
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : "Could not update that subscription.");
    } finally {
      setBusyType(null);
    }
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <a href="/profile" className="text-lg font-bold">
            ← <span className="text-primary">SSC</span>PrepHub
          </a>
          <a href="/dashboard" className="btn btn-outline text-sm">
            Back to Dashboard
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">🤖 Telegram Notifications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Link your Telegram to get daily practice, weak-topic nudges, mock results, and more —
          delivered straight to your chat.
        </p>

        {account === undefined && (
          <p className="mt-8 text-muted-foreground">Loading your Telegram status…</p>
        )}

        {account === null && (
          <div className="card mt-8 p-5">
            {!code ? (
              <>
                <p className="text-sm">You haven&apos;t linked Telegram yet.</p>
                <button
                  onClick={generateCode}
                  disabled={generating}
                  className="btn mt-4 bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-60"
                >
                  {generating ? "Generating…" : "🔗 Generate Link Code"}
                </button>
                {genError && (
                  <p className="mt-3 text-sm text-destructive">
                    {genError}{" "}
                    {genError.toLowerCase().includes("premium") && (
                      <a href="/premium" className="underline">
                        View plans →
                      </a>
                    )}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Send this code to the bot to finish linking. It expires in{" "}
                  <span className="font-semibold tabular-nums">
                    {mm}:{ss}
                  </span>
                  .
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <span className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-2xl font-black tracking-widest text-primary">
                    {code.value}
                  </span>
                  <button
                    onClick={() =>
                      navigator.clipboard?.writeText(`/link ${code.value}`).catch(() => undefined)
                    }
                    className="btn btn-outline text-sm"
                  >
                    📋 Copy /link command
                  </button>
                </div>
                <ol className="mt-5 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                  <li>
                    Open the bot on Telegram
                    {BOT_USERNAME ? (
                      <>
                        {" — "}
                        <a
                          href={`https://t.me/${BOT_USERNAME}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline text-primary hover:text-primary/80"
                        >
                          @{BOT_USERNAME}
                        </a>
                      </>
                    ) : (
                      " (search for the SSC Prep Hub bot by name)"
                    )}
                    .
                  </li>
                  <li>Send <code className="rounded bg-muted px-1">/start</code> if you haven&apos;t already.</li>
                  <li>
                    Send <code className="rounded bg-muted px-1">/link {code.value}</code>.
                  </li>
                </ol>
                <p className="mt-4 text-xs text-muted-foreground">
                  This page updates automatically once you send the code — no need to refresh.
                </p>
                <button onClick={generateCode} disabled={generating} className="btn btn-outline mt-4 text-sm">
                  Generate a new code
                </button>
              </>
            )}
          </div>
        )}

        {account && (
          <>
            <div className="card mt-8 flex items-center justify-between p-5">
              <div>
                <p className="font-medium">
                  {account.username
                    ? `@${account.username}`
                    : account.firstName
                      ? `${account.firstName} ${account.lastName || ""}`.trim()
                      : "Telegram User"}
                </p>
                <p className="text-xs text-muted-foreground">Chat ID: {account.chatId}</p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  account.isActive ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"
                }`}
              >
                {account.isActive ? "✅ Linked" : "⏸️ Inactive"}
              </span>
            </div>

            <div className="mt-6">
              <h2 className="text-lg font-semibold">Notification preferences</h2>
              {toggleError && <p className="mt-2 text-sm text-destructive">{toggleError}</p>}
              <div className="mt-3 divide-y divide-border rounded-2xl border border-border bg-card">
                {SUBSCRIPTION_TYPES.map((t) => {
                  const sub = account.subscriptions.find((s) => s.type === t.key);
                  const on = !!sub?.isActive;
                  return (
                    <div key={t.key} className="flex items-center justify-between gap-4 px-5 py-4">
                      <div>
                        <p className="font-medium">{t.label}</p>
                        <p className="text-xs text-muted-foreground">{t.blurb}</p>
                      </div>
                      <button
                        onClick={() => toggleSubscription(t.key, on)}
                        disabled={busyType === t.key}
                        className={`btn text-sm disabled:opacity-60 ${
                          on ? "bg-primary text-primary-foreground hover:opacity-90" : "btn-outline"
                        }`}
                      >
                        {busyType === t.key ? "…" : on ? "On" : "Off"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
