"use client";

// Admin → AI API keys (rewritten Oct 3 2026 — "api key daalna bhut easy ho")
//
//  * Only ONE box: paste an OpenRouter key and press "Add Key N".
//    Name, number, provider and "free models only" are automatic. After it is added
//    the button immediately says "Add Key N+1".
//  * The key is tested live before it is saved (a wrong key is refused with the reason).
//  * Every saved key has a "Test" button, an On/Off switch and Delete.
//  * Only OpenRouter FREE models are used — the list below is read live from OpenRouter.
//  * A key that is merely rate-limited is NOT switched off any more; it rests and is reused.
import * as React from "react";
import { api } from "@/lib/api";

interface ApiKeyRow {
  id: string;
  keyName: string;
  apiKey: string;
  isActive: boolean;
  isPrimary: boolean;
  usageCount: number;
  failureCount: number;
  lastUsedAt: string | null;
  lastErrorMessage: string | null;
  exhaustedAt: string | null;
}
interface TestResult { ok: boolean; status: string; message: string; model?: string }
interface UsageFeature { feature: string; calls: number; success: number; failed: number; lastAt: string | null }
interface UsageKey { id: string; lastUsedAt: string | null; lastFeature: string | null; lastModel: string | null; lastSuccess: boolean | null; features: UsageFeature[] }
interface UsageRow { id: string; keyName: string; feature: string; model: string | null; success: boolean; errorMessage: string | null; latencyMs: number | null; createdAt: string }

// readable names for the feature codes written by the backend
const FEATURE_LABEL: Record<string, string> = {
  PYQ_DATE_MAPPING: "PYQ date mapping",
  AI_EXPLANATION: "AI solution / explanation",
  QUESTION_HINDI_TRANSLATE: "Hindi translation (question edit)",
  CHAPTER_SUGGEST: "Chapter suggestion (PDF import)",
  KEY_TEST: "Key test",
  GENERAL: "Other",
};
const featureName = (f: string) => FEATURE_LABEL[f] ?? f;
const when = (s: string | null) => (s ? new Date(s).toLocaleString() : "kabhi nahi");

interface Alert { id: string; severity: "INFO" | "WARNING" | "CRITICAL"; message: string; messageHindi: string | null }

export default function AdminApiKeysPage() {
  const [keys, setKeys] = React.useState<ApiKeyRow[]>([]);
  const [alerts, setAlerts] = React.useState<Alert[]>([]);
  const [models, setModels] = React.useState<string[]>([]);
  const [nextNo, setNextNo] = React.useState(1);
  const [value, setValue] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [testing, setTesting] = React.useState<string>("");
  const [results, setResults] = React.useState<Record<string, TestResult>>({});
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [usage, setUsage] = React.useState<Record<string, UsageKey>>({});
  const [recent, setRecent] = React.useState<UsageRow[]>([]);
  const [recentTotal, setRecentTotal] = React.useState(0);
  const [logFeature, setLogFeature] = React.useState("");
  const [logKey, setLogKey] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      const [k, a, n, m, u] = await Promise.all([
        api<ApiKeyRow[]>("/admin/api-keys?provider=openrouter"),
        api<Alert[]>("/admin/api-keys/alerts").catch(() => []),
        api<{ next: number }>("/admin/ai/keys/next-number").catch(() => ({ next: 1 })),
        api<{ models: string[] }>("/admin/ai/models").catch(() => ({ models: [] })),
        api<{ keys: UsageKey[] }>("/admin/api-keys/usage?days=30").catch(() => ({ keys: [] as UsageKey[] })),
      ]);
      setUsage(Object.fromEntries(u.keys.map((x) => [x.id, x])));
      setKeys(Array.isArray(k) ? k : []);
      setAlerts(Array.isArray(a) ? a : []);
      setNextNo(n.next);
      setModels(m.models);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const loadRecent = React.useCallback(async () => {
    const p = new URLSearchParams({ take: "40" });
    if (logFeature) p.set("feature", logFeature);
    if (logKey) p.set("keyId", logKey);
    try {
      const d = await api<{ total: number; rows: UsageRow[] }>(`/admin/api-keys/usage/recent?${p.toString()}`);
      setRecent(d.rows);
      setRecentTotal(d.total);
    } catch {
      setRecent([]);
    }
  }, [logFeature, logKey]);
  React.useEffect(() => { void loadRecent(); }, [loadRecent, keys.length]);

  const add = async () => {
    if (!value.trim()) return;
    setAdding(true);
    setMsg(null);
    try {
      const d = await api<{ key: { keyName: string }; test: TestResult; next: number }>("/admin/ai/keys/quick", {
        method: "POST",
        body: JSON.stringify({ apiKey: value.trim() }),
      });
      setValue("");
      setNextNo(d.next);
      setMsg({ ok: d.test.ok, text: `${d.key.keyName} add ho gayi — ${d.test.message}` });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setAdding(false);
    }
  };

  const test = async (id: string) => {
    setTesting(id);
    try {
      const r = await api<TestResult>(`/admin/ai/keys/${id}/test`, { method: "POST" });
      setResults((x) => ({ ...x, [id]: r }));
      await load();
    } catch (e) {
      setResults((x) => ({ ...x, [id]: { ok: false, status: "error", message: (e as Error).message } }));
    } finally {
      setTesting("");
    }
  };

  const toggle = async (k: ApiKeyRow) => {
    try {
      await api(`/admin/api-keys/${k.id}`, { method: "PUT", body: JSON.stringify({ isActive: !k.isActive }) });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  const remove = async (k: ApiKeyRow) => {
    if (!confirm(`${k.keyName} delete karein?`)) return;
    try {
      await api(`/admin/api-keys/${k.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  const active = keys.filter((k) => k.isActive).length;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <a href="/admin" className="text-sm font-semibold">← Admin</a>
          <span className="text-sm font-bold">🔑 AI API Keys</span>
          <span className="text-xs text-muted-foreground">{active}/{keys.length} on</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-3 py-5">
        {alerts.filter((a) => a.severity !== "INFO").slice(0, 2).map((a) => (
          <div key={a.id} className={`rounded-lg border p-3 text-sm ${a.severity === "CRITICAL" ? "border-red-500/40 bg-red-500/10 text-red-700" : "border-amber-500/40 bg-amber-500/10 text-amber-700"}`}>⚠️ {a.messageHindi || a.message}</div>
        ))}

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-bold">OpenRouter key {nextNo} daalein</h2>
          <p className="mt-1 text-xs text-muted-foreground">Sirf key paste karein (<code>sk-or-…</code>). Baaki sab automatic hai. Sirf <b>free models</b> use honge.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-3 font-mono text-sm"
              placeholder="sk-or-v1-…"
              value={value}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
            />
            <button onClick={add} disabled={adding || !value.trim()} className="rounded-lg bg-primary px-5 py-3 text-sm font-bold text-primary-foreground disabled:opacity-40">
              {adding ? "Check ho rahi…" : `➕ Add Key ${nextNo}`}
            </button>
          </div>
          {msg && <p className={`mt-3 rounded-lg border p-2 text-sm ${msg.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700" : "border-red-500/40 bg-red-500/10 text-red-700"}`}>{msg.text}</p>}
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-bold">Aapki keys</h2>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && keys.length === 0 && <p className="text-sm text-muted-foreground">Abhi koi key nahi hai. Upar pehli key daalein.</p>}
          <ul className="space-y-3">
            {keys.map((k) => {
              const r = results[k.id];
              return (
                <li key={k.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold">{k.keyName} {k.isPrimary && <span className="ml-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">PRIMARY</span>}</p>
                      <p className="font-mono text-xs text-muted-foreground">{k.apiKey}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${k.isActive ? "bg-emerald-500/15 text-emerald-700" : "bg-muted text-muted-foreground"}`}>{k.isActive ? "ON" : "OFF"}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">✅ {k.usageCount} successful · ❌ {k.failureCount} failed{k.lastUsedAt ? ` · last ${new Date(k.lastUsedAt).toLocaleString()}` : ""}</p>
                  {usage[k.id]?.lastFeature && (
                    <p className="mt-1 text-[11px]">🕒 Last use: <b>{featureName(usage[k.id].lastFeature!)}</b>{usage[k.id].lastModel ? ` · ${usage[k.id].lastModel}` : ""} · {when(usage[k.id].lastUsedAt)} {usage[k.id].lastSuccess === false ? "· ❌ fail" : "· ✅"}</p>
                  )}
                  {(usage[k.id]?.features.length ?? 0) > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {usage[k.id].features.map((f) => (
                        <button key={f.feature} onClick={() => { setLogFeature(f.feature); setLogKey(k.id); }} className="rounded-full border border-border px-2 py-0.5 text-[10px] hover:bg-muted" title={`last: ${when(f.lastAt)}`}>
                          {featureName(f.feature)}: {f.calls} (✅{f.success} ❌{f.failed})
                        </button>
                      ))}
                      <span className="text-[10px] text-muted-foreground">pichhle 30 din</span>
                    </div>
                  )}
                  {k.lastErrorMessage && !r && <p className="mt-1 text-[11px] text-amber-700">Last error: {k.lastErrorMessage}</p>}
                  {r && <p className={`mt-1 text-xs font-semibold ${r.ok ? "text-emerald-700" : "text-red-700"}`}>{r.message}{r.model ? ` (${r.model})` : ""}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button onClick={() => test(k.id)} disabled={testing === k.id} className="rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-semibold text-primary disabled:opacity-50">{testing === k.id ? "Test ho raha…" : "🧪 Test key"}</button>
                    <button onClick={() => toggle(k)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">{k.isActive ? "Band karein" : "Chalu karein"}</button>
                    <button onClick={() => remove(k)} className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-600">Delete</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-1 text-sm font-bold">Key usage log — kis feature me kab use hui</h2>
          <p className="mb-2 text-xs text-muted-foreground">Har AI call yahan likhi jaati hai (key, feature, free model, success/fail). 90 din ka record rehta hai.</p>
          <div className="mb-2 flex flex-wrap gap-2">
            <select className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs" value={logKey} onChange={(e) => setLogKey(e.target.value)}>
              <option value="">Sab keys</option>{keys.map((k) => <option key={k.id} value={k.id}>{k.keyName}</option>)}
            </select>
            <select className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs" value={logFeature} onChange={(e) => setLogFeature(e.target.value)}>
              <option value="">Sab features</option>{Object.entries(FEATURE_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <button onClick={() => void loadRecent()} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">Refresh</button>
            <span className="self-center text-[11px] text-muted-foreground">{recentTotal} entries</span>
          </div>
          <ul className="max-h-96 space-y-1 overflow-y-auto text-xs">
            {recent.map((r) => (
              <li key={r.id} className={`rounded px-2 py-1 ${r.success ? "bg-emerald-500/5" : "bg-red-500/5"}`}>
                {r.success ? "✅" : "❌"} <b>{featureName(r.feature)}</b> · {r.keyName} · <span className="font-mono">{r.model ?? "—"}</span> · {when(r.createdAt)}{r.latencyMs != null ? ` · ${(r.latencyMs / 1000).toFixed(1)}s` : ""}
                {r.errorMessage && <span className="block text-[11px] text-amber-700">{r.errorMessage}</span>}
              </li>
            ))}
            {recent.length === 0 && <li className="text-muted-foreground">Abhi koi usage record nahi.</li>}
          </ul>
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-bold">Abhi use ho rahe free models</h2>
          <p className="mb-2 text-xs text-muted-foreground">Ye list OpenRouter se live aati hai (har ghante naya). Pehla model pehle try hota hai; busy ho to agla.</p>
          <ul className="space-y-1 text-xs">
            {models.map((m, i) => <li key={m} className="rounded bg-muted/50 px-2 py-1 font-mono">{i + 1}. {m}</li>)}
            {models.length === 0 && <li className="text-muted-foreground">List load nahi hui.</li>}
          </ul>
        </section>
      </main>
    </div>
  );
}
