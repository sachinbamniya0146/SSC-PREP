"use client";

// Feature controller (Oct 28 2026): switch whole sections on/off without a deploy, and publish an announcement banner.
// Switches marked "enforced" are also refused by the server (not only hidden); the rest hide the screens.

import * as React from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { refreshFeatures } from "@/lib/features";
import { Skeleton } from "@/components/Skeleton";

interface Def { key: string; label: string; hint: string; group: "student" | "business"; default: boolean; server: boolean }
interface Ann { enabled: boolean; text: string; level: "info" | "warn" | "danger"; link: string; linkLabel: string; expiresAt: string }
interface State { flags: Record<string, boolean>; announcement: Ann; defs: Def[] }

const TONE: Record<string, string> = {
  info: "border-info/30 bg-info/10 text-info",
  warn: "border-warning/40 bg-warning/15 text-warning",
  danger: "border-danger/30 bg-danger/10 text-danger",
};
const RISKY = new Set(["signup", "purchases"]);

// ISO <-> <input type="datetime-local"> (local time)
const toLocalInput = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : "");

export default function FeatureControllerPage() {
  const router = useRouter();
  const [data, setData] = React.useState<State | null>(null);
  const [flags, setFlags] = React.useState<Record<string, boolean>>({});
  const [ann, setAnn] = React.useState<Ann | null>(null);
  const [err, setErr] = React.useState("");
  const [msg, setMsg] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const d = await api<State>("/admin/features");
      setData(d);
      setFlags(d.flags);
      setAnn(d.announcement);
      setErr("");
    } catch (e) {
      const m = e instanceof Error ? e.message : "Could not load";
      if (/403|forbidden/i.test(m)) router.replace("/admin");
      setErr(m);
    }
  }, [router]);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (!data || !ann) {
    return (
      <div className="mx-auto max-w-4xl space-y-3 p-6">
        {err ? <p className="text-sm text-danger">{err} <button className="underline" onClick={load}>Retry</button></p> : null}
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const changedFlags = data.defs.filter((d) => flags[d.key] !== data.flags[d.key]);
  const annChanged = JSON.stringify(ann) !== JSON.stringify(data.announcement);
  const dirty = changedFlags.length > 0 || annChanged;

  const save = async () => {
    const turningOff = changedFlags.filter((d) => RISKY.has(d.key) && !flags[d.key]);
    if (turningOff.length && !confirm(`You are switching OFF: ${turningOff.map((d) => d.label).join(", ")}.\nStudents will be blocked immediately. Continue?`)) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const body: Record<string, unknown> = {};
      if (changedFlags.length) body.flags = Object.fromEntries(changedFlags.map((d) => [d.key, flags[d.key]]));
      if (annChanged) body.announcement = ann;
      const d = await api<State>("/admin/features", { method: "PUT", body: JSON.stringify(body) });
      setData(d);
      setFlags(d.flags);
      setAnn(d.announcement);
      setMsg("Saved. Students see it within 2 minutes (or on their next page load).");
      void refreshFeatures(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const groups: { title: string; hint: string; key: Def["group"] }[] = [
    { title: "Business switches", hint: "Money and sign-ups. Use during a gateway problem or a planned break.", key: "business" },
    { title: "Student features", hint: "Sections students see. Turning one off hides it everywhere (menus, dashboard, pages).", key: "student" },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 pb-28">
      <h1 className="text-2xl font-bold">🎛️ Feature controller</h1>
      <p className="mt-1 text-sm text-muted-foreground">Turn sections on or off and show a message to every student - no deploy needed. Every change is written to the audit log.</p>

      {err && <p role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{err}</p>}
      {msg && <p role="status" className="mt-4 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">{msg}</p>}

      {groups.map((g) => (
        <section key={g.key} className="card mt-6 p-5">
          <h2 className="text-base font-bold">{g.title}</h2>
          <p className="text-xs text-muted-foreground">{g.hint}</p>
          <ul className="mt-3 divide-y divide-border">
            {data.defs.filter((d) => d.group === g.key).map((d) => {
              const on = flags[d.key] !== false;
              const changed = on !== data.flags[d.key];
              return (
                <li key={d.key} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {d.label}
                      {d.server && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary" title="The server refuses the action too">enforced</span>}
                      {changed && <span className="ml-2 rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-bold text-warning">unsaved</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{d.hint}</p>
                  </div>
                  <button
                    role="switch"
                    aria-checked={on}
                    aria-label={d.label}
                    onClick={() => setFlags({ ...flags, [d.key]: !on })}
                    className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-success" : "bg-muted-foreground/30"}`}
                  >
                    <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? "left-[1.375rem]" : "left-0.5"}`} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section className="card mt-6 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">📢 Announcement banner</h2>
            <p className="text-xs text-muted-foreground">Shown at the top of every page for logged-in and logged-out visitors (not on a live test). A student can close it; a changed text shows again.</p>
          </div>
          <button
            role="switch"
            aria-checked={ann.enabled}
            aria-label="Show announcement"
            onClick={() => setAnn({ ...ann, enabled: !ann.enabled })}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${ann.enabled ? "bg-success" : "bg-muted-foreground/30"}`}
          >
            <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${ann.enabled ? "left-[1.375rem]" : "left-0.5"}`} />
          </button>
        </div>

        <label className="mt-4 block text-xs font-semibold">Message
          <textarea value={ann.text} onChange={(e) => setAnn({ ...ann, text: e.target.value })} maxLength={300} rows={2} placeholder="e.g. SSC CGL 2026 mock series starts Monday!" className="mt-1 w-full border bg-background p-2 text-sm" />
          <span className="block text-right font-normal text-muted-foreground">{ann.text.length}/300</span>
        </label>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold">Style
            <select value={ann.level} onChange={(e) => setAnn({ ...ann, level: e.target.value as Ann["level"] })} className="mt-1 w-full border bg-background px-2 py-2 text-sm">
              <option value="info">Information (blue)</option>
              <option value="warn">Notice (amber)</option>
              <option value="danger">Important (red)</option>
            </select>
          </label>
          <label className="text-xs font-semibold">Hide automatically at (optional)
            <input type="datetime-local" value={toLocalInput(ann.expiresAt)} onChange={(e) => setAnn({ ...ann, expiresAt: fromLocalInput(e.target.value) })} className="mt-1 w-full border bg-background px-2 py-2 text-sm" />
          </label>
          <label className="text-xs font-semibold">Link (optional, / or https://)
            <input value={ann.link} onChange={(e) => setAnn({ ...ann, link: e.target.value })} maxLength={300} placeholder="/mocks" className="mt-1 w-full border bg-background px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-semibold">Link text
            <input value={ann.linkLabel} onChange={(e) => setAnn({ ...ann, linkLabel: e.target.value })} maxLength={40} placeholder="Open" className="mt-1 w-full border bg-background px-3 py-2 text-sm" />
          </label>
        </div>

        <p className="mt-4 text-xs font-semibold text-muted-foreground">Preview</p>
        <div className={`mt-1 flex items-start gap-3 rounded-lg border px-4 py-2 text-sm ${TONE[ann.level] || TONE.info} ${ann.text.trim() ? "" : "opacity-40"}`}>
          <p className="min-w-0 flex-1 leading-snug">
            <span className="font-semibold text-foreground">{ann.text.trim() || "Your message appears here"}</span>
            {ann.link && <span className="ml-2 font-bold underline">{ann.linkLabel || "Open"} →</span>}
          </p>
          <span className="opacity-70">×</span>
        </div>
      </section>

      {dirty && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:left-64">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
            <p className="text-sm">
              <b>{changedFlags.length + (annChanged ? 1 : 0)}</b> unsaved change{changedFlags.length + (annChanged ? 1 : 0) === 1 ? "" : "s"}
            </p>
            <div className="flex gap-2">
              <button onClick={() => { setFlags(data.flags); setAnn(data.announcement); }} className="btn btn-outline">Discard</button>
              <button onClick={save} disabled={busy} className="btn btn-primary">{busy ? "Saving…" : "Save changes"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
