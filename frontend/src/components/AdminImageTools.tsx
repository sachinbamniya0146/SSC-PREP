"use client";

// Admin image tools (NEW — Sep 29 2026)
//  1. Storage check: real write/read/delete test against R2/S3 (or local disk)
//     with plain-language hints — run it BEFORE uploading hundreds of image
//     questions, instead of finding out from silent failures.
//  2. Bulk image upload: pick up to 40 pictures, get back a table of
//     file name -> permanent URL to paste into the Excel columns
//     questionImageUrl / optionImageUrls (A|B|C|D separated by "|").
import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";

type Health = {
  ok: boolean;
  mode: "s3" | "local";
  configured: boolean;
  bucket: string | null;
  endpointHost: string | null;
  imageUrlStrategy: string;
  canWrite: boolean;
  canRead: boolean;
  canDelete: boolean;
  error?: string;
  hints: string[];
};
type UploadRow = { name: string; ok: boolean; url?: string; error?: string };

export default function AdminImageTools() {
  const [health, setHealth] = React.useState<Health | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [files, setFiles] = React.useState<File[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [rows, setRows] = React.useState<UploadRow[]>([]);
  const [err, setErr] = React.useState("");
  const [copied, setCopied] = React.useState("");

  const check = async () => {
    setChecking(true);
    setErr("");
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/upload/storage-health`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setHealth(await r.json());
    } catch (e: any) {
      setErr(e.message || "Storage check failed");
    } finally {
      setChecking(false);
    }
  };

  const upload = async () => {
    if (!files.length) return;
    setUploading(true);
    setErr("");
    setRows([]);
    try {
      const all: UploadRow[] = [];
      // 10 files per request keeps each request small and progress visible.
      for (let i = 0; i < files.length; i += 10) {
        const fd = new FormData();
        files.slice(i, i + 10).forEach((f) => fd.append("files", f));
        const r = await fetchAuth(`${API_BASE}/bank/admin/upload/question-images`, { method: "POST", body: fd });
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(d?.message || `Upload failed (HTTP ${r.status})`);
        all.push(...(d.results as UploadRow[]));
        setRows([...all]);
      }
    } catch (e: any) {
      setErr(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* clipboard unavailable — the URL is visible for manual copy */
    }
  };

  const okRows = rows.filter((r) => r.ok && r.url);

  return (
    <div className="mb-4 rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-bold">🖼️ Image questions — storage & bulk image upload</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Pehle storage check karein, phir images upload karke URL Excel ke <code>questionImageUrl</code> / <code>optionImageUrls</code> column me paste karein.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={check} disabled={checking} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:border-primary disabled:opacity-50">
          {checking ? "Checking…" : "✅ Check image storage"}
        </button>
        <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 40))} className="text-xs" />
        <button onClick={upload} disabled={uploading || !files.length} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
          {uploading ? "Uploading…" : `Upload ${files.length || ""} image(s)`}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-danger">{err}</p>}

      {health && (
        <div className={`mt-3 rounded-lg border p-3 text-xs ${health.ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-red-500/40 bg-red-500/5"}`}>
          <p className="font-bold">{health.ok ? "✅ Image storage working" : "❌ Image storage problem"} — mode: {health.mode === "s3" ? `R2/S3 (${health.bucket})` : "local disk"}</p>
          <p className="mt-1">Write: {health.canWrite ? "✅" : "❌"} · Read: {health.canRead ? "✅" : "❌"} · Delete: {health.canDelete ? "✅" : "❌"} · URLs: {health.imageUrlStrategy}</p>
          {health.error && <p className="mt-1 font-semibold text-red-600">{health.error}</p>}
          {health.hints.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-muted-foreground">
              {health.hints.map((h, i) => <li key={i}>{h}</li>)}
            </ul>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">{okRows.length}/{rows.length} uploaded</p>
            {okRows.length > 0 && (
              <button onClick={() => copy(okRows.map((r) => `${r.name}\t${r.url}`).join("\n"), "all")} className="text-xs text-primary underline">
                {copied === "all" ? "Copied ✓" : "Copy all (name ⇥ URL)"}
              </button>
            )}
          </div>
          <div className="mt-1 max-h-56 overflow-auto rounded-lg border border-border text-xs">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-2 border-b border-border/60 px-2 py-1.5 last:border-0">
                <span className="w-40 shrink-0 truncate font-medium">{r.name}</span>
                {r.ok ? (
                  <>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.url}</span>
                    <button onClick={() => copy(r.url!, String(i))} className="shrink-0 text-primary underline">{copied === String(i) ? "✓" : "copy"}</button>
                  </>
                ) : (
                  <span className="min-w-0 flex-1 text-red-600">{r.error}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
