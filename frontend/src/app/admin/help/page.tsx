"use client";

// Admin Help / Format Guide — UI for GET /admin/help/formats, /admin/help/
// prompts, /admin/help/diagram-types (backend/src/admin/admin-help.controller.ts,
// backend/src/admin/admin.service.ts getFormatExamples()/getAIPrompts(),
// backend/src/bank/bank-upload.service.ts getDiagramTypesHelp()).
//
// BUG FIX: all three of these routes existed and worked on the backend, but
// nothing in the frontend ever called them. Only GET /admin/help/templates/*
// (the actual file downloads) was wired, buried inside the Bulk Question
// Upload card on /admin. There was no dedicated Help page and no dashboard
// tile pointing at one, so an admin had no way to see the upload-format
// cheatsheet, the ready-to-use AI prompts for generating explanations/
// translations/study-plans, or the Venn/figure-diagram type reference,
// without reading backend source directly. This page surfaces all three,
// plus the same template downloads already used on /admin (kept here too
// so this page is a complete, self-contained "help" destination).

import * as React from "react";
import { useRouter } from "next/navigation";
import { API_BASE, fetchAuth } from "@/lib/api";

type FormatExamples = {
  excel: { headers: string[]; description: string };
  csv: { headers: string[]; description: string };
  json: { format: string; description: string };
  text: { format: string; headers: string[]; description: string };
};

type AIPrompts = Record<string, { prompt: string; description: string }>;

type DiagramTypesHelp = {
  description: string;
  types: Array<{ code: string; label?: string; description?: string } | string>;
  bulkUploadColumns: Record<string, string>;
};

export default function AdminHelpPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = React.useState(false);

  const [formats, setFormats] = React.useState<FormatExamples | null>(null);
  const [prompts, setPrompts] = React.useState<AIPrompts | null>(null);
  const [diagramTypes, setDiagramTypes] = React.useState<DiagramTypesHelp | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [copyMsg, setCopyMsg] = React.useState("");

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

  React.useEffect(() => {
    if (!authChecked) return;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const [fr, pr, dr] = await Promise.all([
          fetchAuth(`${API_BASE}/admin/help/formats`),
          fetchAuth(`${API_BASE}/admin/help/prompts`),
          fetchAuth(`${API_BASE}/admin/help/diagram-types`),
        ]);
        if (fr.ok) setFormats(await fr.json());
        if (pr.ok) setPrompts(await pr.json());
        if (dr.ok) setDiagramTypes(await dr.json());
        if (!fr.ok && !pr.ok && !dr.ok) setError("Help content load nahi hua — dobara try karein.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error");
      } finally {
        setLoading(false);
      }
    })();
  }, [authChecked]);

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg(`${label} copy ho gaya.`);
      setTimeout(() => setCopyMsg(""), 2000);
    } catch {
      // Clipboard API unavailable — text is still visible for manual copy.
    }
  }

  async function downloadTemplate(format: "excel" | "csv" | "json" | "text") {
    const res = await fetchAuth(`${API_BASE}/admin/help/templates/${format}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const ext = format === "excel" ? "xlsx" : format;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `question_bulk_upload_template.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Checking access...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">
            ← <span className="text-primary">SSC</span>PrepHub
          </a>
          <span className="text-sm text-muted-foreground">❓ Admin Help</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold">❓ Admin Help</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload format cheatsheet, ready-to-use AI prompts, aur diagram-type reference — sab ek jagah.
        </p>
        {copyMsg && (
          <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-sm text-emerald-600 dark:text-emerald-400">
            {copyMsg}
          </p>
        )}
        {error && (
          <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p>
        )}
        {loading && <p className="mt-6 text-sm text-muted-foreground">Loading...</p>}

        {/* ---- Template downloads ---- */}
        {!loading && (
          <section className="mt-6 rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold">⬇️ Download Upload Template</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Excel template mein real exam/subject/chapter IDs bhi included hain (Reference IDs sheet).
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["excel", "csv", "json", "text"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => downloadTemplate(f)}
                  className="btn btn-outline px-4 py-2 text-sm"
                >
                  {f.toUpperCase()} template
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ---- Format examples ---- */}
        {formats && (
          <section className="mt-6 rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold">📋 Upload Format Guide</h2>
            <div className="mt-3 space-y-4">
              {(["excel", "csv", "json", "text"] as const).map((key) => {
                const f = formats[key];
                const headers = "headers" in f ? f.headers : undefined;
                const format = "format" in f ? f.format : undefined;
                return (
                  <div key={key} className="rounded-lg border border-border p-3">
                    <div className="font-semibold uppercase">{key}</div>
                    <p className="mt-1 text-sm text-muted-foreground">{f.description}</p>
                    {headers && (
                      <p className="mt-2 break-words font-mono text-xs text-muted-foreground">
                        {headers.join(", ")}
                      </p>
                    )}
                    {format && !headers && (
                      <p className="mt-2 break-words font-mono text-xs text-muted-foreground">{format}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ---- AI prompts ---- */}
        {prompts && (
          <section className="mt-6 rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold">🤖 Ready-to-use AI Prompts</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              In prompts ko ChatGPT/Claude jaise kisi bhi AI tool mein paste karke question explanations,
              Hindi translation, study plans, ya weak-area analysis generate kar sakte hain.
            </p>
            <div className="mt-3 space-y-3">
              {Object.entries(prompts).map(([key, p]) => (
                <div key={key} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{key}</span>
                    <button
                      onClick={() => copyText(p.prompt, key)}
                      className="btn btn-outline px-3 py-1 text-xs"
                    >
                      Copy
                    </button>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
                  <p className="mt-2 rounded bg-muted p-2 font-mono text-xs">{p.prompt}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ---- Diagram types ---- */}
        {diagramTypes && (
          <section className="mt-6 rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold">🔷 Venn / Figure Diagram Types</h2>
            <p className="mt-1 text-sm text-muted-foreground">{diagramTypes.description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {diagramTypes.types.map((t, i) => (
                <span
                  key={i}
                  className="rounded-full bg-muted px-3 py-1 text-xs font-mono"
                  title={typeof t === "string" ? t : t.description || t.label || ""}
                >
                  {typeof t === "string" ? t : t.code}
                </span>
              ))}
            </div>
            <div className="mt-4 space-y-2 text-sm">
              {Object.entries(diagramTypes.bulkUploadColumns).map(([col, desc]) => (
                <div key={col}>
                  <span className="font-mono font-semibold">{col}</span>
                  <span className="text-muted-foreground"> — {desc}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
