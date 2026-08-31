"use client";

// Admin API-key pool management.
//
// Requests to OpenRouter rotate across every ACTIVE key added here
// (primary first, then least-recently-used) instead of only ever using one
// key. When a key looks exhausted/invalid it's auto-deactivated and, once
// the pool drops to the last key (or zero), an alert is raised here BEFORE
// AI features actually break for students — see admin-api-keys.service.ts.

import * as React from "react";
import { api } from "@/lib/api";

interface ApiKeyRow {
  id: string;
  provider: string;
  keyName: string;
  apiKey: string; // masked by the backend
  isActive: boolean;
  isPrimary: boolean;
  freeModelOnly: boolean;
  usageCount: number;
  failureCount: number;
  lastUsedAt: string | null;
  lastErrorMessage: string | null;
  exhaustedAt: string | null;
  createdAt: string;
}

interface Alert {
  id: string;
  type: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
  messageHindi: string | null;
  isResolved: boolean;
  createdAt: string;
}

interface PoolHealth {
  provider: string;
  total: number;
  active: number;
}

const PROVIDERS = ["openrouter", "openai", "gemini"];

export default function AdminApiKeysPage() {
  const [provider, setProvider] = React.useState("openrouter");
  const [keys, setKeys] = React.useState<ApiKeyRow[]>([]);
  const [alerts, setAlerts] = React.useState<Alert[]>([]);
  const [health, setHealth] = React.useState<PoolHealth[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [info, setInfo] = React.useState("");

  // Bulk-paste form
  const [rawKeys, setRawKeys] = React.useState("");
  const [freeModelOnly, setFreeModelOnly] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [k, a, h] = await Promise.all([
        api<ApiKeyRow[]>(`/admin/api-keys?provider=${provider}`),
        api<Alert[]>("/admin/api-keys/alerts"),
        api<PoolHealth[]>("/admin/api-keys/health"),
      ]);
      setKeys(k);
      setAlerts(a);
      setHealth(h);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load API keys.");
    } finally {
      setLoading(false);
    }
  }, [provider]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function submitBulk() {
    if (!rawKeys.trim()) return;
    setSubmitting(true);
    setError("");
    setInfo("");
    try {
      const result = await api<{ requested: number; added: number; skippedDuplicate: number }>(
        "/admin/api-keys/bulk",
        { method: "POST", body: JSON.stringify({ provider, freeModelOnly, rawKeys }) },
      );
      setInfo(`Added ${result.added} new key(s) (${result.skippedDuplicate} duplicate(s) skipped).`);
      setRawKeys("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add keys.");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(key: ApiKeyRow) {
    try {
      await api(`/admin/api-keys/${key.id}`, { method: "PUT", body: JSON.stringify({ isActive: !key.isActive }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update key.");
    }
  }

  async function makePrimary(key: ApiKeyRow) {
    try {
      await api(`/admin/api-keys/${key.id}`, { method: "PUT", body: JSON.stringify({ isPrimary: true }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update key.");
    }
  }

  async function removeKey(key: ApiKeyRow) {
    if (!confirm(`Delete key "${key.keyName}"? This can't be undone.`)) return;
    try {
      await api(`/admin/api-keys/${key.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete key.");
    }
  }

  async function resolveAlert(id: string) {
    try {
      await api(`/admin/api-keys/alerts/${id}/resolve`, { method: "POST" });
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch {
      // non-critical — leave it in the list, admin can retry
    }
  }

  const activeCount = keys.filter((k) => k.isActive).length;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <a href="/admin" className="text-lg font-bold">
            ← <span className="text-primary">SSC</span>PrepHub Admin
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold">🔑 AI API Key Pool</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Requests rotate across every active key below (primary first, then least-recently-used).
          A key that fails with an invalid/quota-exceeded error is auto-deactivated and skipped —
          you&apos;ll see an alert here before the whole pool runs dry.
        </p>

        {error && <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">{error}</div>}
        {info && <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">{info}</div>}

        {/* Alerts */}
        {alerts.length > 0 && (
          <div className="mt-6 space-y-2">
            {alerts.map((a) => (
              <div
                key={a.id}
                className={`flex items-start justify-between gap-3 rounded-lg border p-3 text-sm ${
                  a.severity === "CRITICAL"
                    ? "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                }`}
              >
                <div>
                  <p className="font-medium">{a.severity === "CRITICAL" ? "🚨" : "⚠️"} {a.message}</p>
                  {a.messageHindi && <p className="mt-1 text-xs opacity-80">{a.messageHindi}</p>}
                </div>
                <button onClick={() => resolveAlert(a.id)} className="btn btn-outline shrink-0 text-xs">
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Pool health summary */}
        {health.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-3">
            {health.map((h) => (
              <div key={h.provider} className="card px-4 py-3 text-sm">
                <span className="font-medium capitalize">{h.provider}</span>:{" "}
                <span className={h.active === 0 ? "text-red-500" : h.active === 1 ? "text-amber-500" : "text-emerald-500"}>
                  {h.active} active
                </span>{" "}
                / {h.total} total
              </div>
            ))}
          </div>
        )}

        {/* Provider tabs */}
        <div className="mt-6 flex gap-2">
          {PROVIDERS.map((p) => (
            <button
              key={p}
              onClick={() => setProvider(p)}
              className={`btn text-sm capitalize ${provider === p ? "bg-primary text-primary-foreground" : "btn-outline"}`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Bulk add */}
        <div className="card mt-4 p-5">
          <h2 className="text-lg font-semibold">Bulk-add {provider} keys</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Paste one key per line (or comma-separated). Duplicates already in the pool are skipped automatically.
          </p>
          <textarea
            value={rawKeys}
            onChange={(e) => setRawKeys(e.target.value)}
            placeholder={"sk-or-v1-aaa...\nsk-or-v1-bbb...\nsk-or-v1-ccc..."}
            rows={5}
            className="mt-3 w-full rounded-lg border border-border bg-background px-4 py-2.5 font-mono text-xs outline-none focus:border-primary"
          />
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={freeModelOnly} onChange={(e) => setFreeModelOnly(e.target.checked)} />
            Free models only (recommended — never touches a paid model on these keys)
          </label>
          <button
            onClick={submitBulk}
            disabled={submitting || !rawKeys.trim()}
            className="btn mt-4 bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? "Adding…" : "Add keys"}
          </button>
        </div>

        {/* Key list */}
        <div className="mt-6">
          <h2 className="text-lg font-semibold">
            {provider} keys ({activeCount} active / {keys.length} total)
          </h2>
          {loading ? (
            <p className="mt-3 text-muted-foreground">Loading…</p>
          ) : keys.length === 0 ? (
            <p className="mt-3 text-muted-foreground">No keys added yet for this provider.</p>
          ) : (
            <div className="mt-3 divide-y divide-border rounded-2xl border border-border bg-card">
              {keys.map((k) => (
                <div key={k.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <p className="font-medium">
                      {k.keyName} {k.isPrimary && <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">Primary</span>}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">{k.apiKey}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      ✅ {k.usageCount} used · ❌ {k.failureCount} failed
                      {k.lastErrorMessage && <span className="text-red-500"> · last error: {k.lastErrorMessage}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        k.isActive ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"
                      }`}
                    >
                      {k.isActive ? "Active" : k.exhaustedAt ? "Exhausted" : "Disabled"}
                    </span>
                    {!k.isPrimary && (
                      <button onClick={() => makePrimary(k)} className="btn btn-outline text-xs">
                        Make primary
                      </button>
                    )}
                    <button onClick={() => toggleActive(k)} className="btn btn-outline text-xs">
                      {k.isActive ? "Disable" : "Re-activate"}
                    </button>
                    <button onClick={() => removeKey(k)} className="btn btn-outline text-xs text-destructive">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
