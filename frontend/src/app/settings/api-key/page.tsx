"use client";

// Personal OpenRouter API key settings page.
//
// Why this exists: AI explanations (and the study plan generator) call
// OpenRouter under the hood. By default every request shares the admin's
// pooled API keys. A student who adds their own free OpenRouter key here
// gets their AI calls served from their own key instead — still restricted
// to OpenRouter's free-tier models only (never a paid model, so this can
// never rack up a bill on the student's account), and it takes load off the
// shared admin pool for everyone else.

import * as React from "react";
import { api } from "@/lib/api";

interface KeyStatus {
  hasOpenrouterApiKey: boolean;
  maskedKey: string | null;
}

export default function ApiKeySettingsPage() {
  const [status, setStatus] = React.useState<KeyStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [input, setInput] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      const data = await api<KeyStatus>("/users/me/openrouter-key");
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load key status.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function saveKey() {
    if (!input.trim()) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await api("/users/me/openrouter-key", { method: "POST", body: JSON.stringify({ apiKey: input.trim() }) });
      setInput("");
      setSuccess("API key saved. Your AI explanations will now use it.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the key.");
    } finally {
      setSaving(false);
    }
  }

  async function removeKey() {
    setRemoving(true);
    setError("");
    setSuccess("");
    try {
      await api("/users/me/openrouter-key", { method: "DELETE" });
      setSuccess("Key removed. AI explanations will fall back to the shared pool.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the key.");
    } finally {
      setRemoving(false);
    }
  }

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
        <h1 className="text-2xl font-bold">🔑 Your OpenRouter API Key</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Optional. Add your own free OpenRouter key so AI explanations use it instead of the shared
          pool — only free-tier models are ever used, so this can&apos;t cost you anything.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Don&apos;t have one?{" "}
          <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="underline text-primary hover:text-primary/80">
            Get a free key at openrouter.ai/keys →
          </a>
        </p>

        {error && <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">{error}</div>}
        {success && <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">{success}</div>}

        {loading ? (
          <p className="mt-8 text-muted-foreground">Loading…</p>
        ) : (
          <div className="card mt-8 p-5">
            {status?.hasOpenrouterApiKey ? (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Key saved</p>
                    <p className="text-xs text-muted-foreground">{status.maskedKey}</p>
                  </div>
                  <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600">
                    ✅ Active
                  </span>
                </div>
                <button onClick={removeKey} disabled={removing} className="btn btn-outline mt-4 text-sm text-destructive disabled:opacity-60">
                  {removing ? "Removing…" : "Remove key"}
                </button>
                <div className="mt-6 border-t border-border pt-4">
                  <p className="mb-2 text-sm text-muted-foreground">Replace with a different key:</p>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <input
                      type="password"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="sk-or-v1-..."
                      className="w-full flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                    />
                    <button onClick={saveKey} disabled={saving || !input.trim()} className="btn bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-60">
                      {saving ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm">You haven&apos;t added a personal key yet — AI explanations currently use the shared pool.</p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <input
                    type="password"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="sk-or-v1-..."
                    className="w-full flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                  />
                  <button onClick={saveKey} disabled={saving || !input.trim()} className="btn bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-60">
                    {saving ? "Saving…" : "Save key"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
