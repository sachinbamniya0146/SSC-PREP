"use client";

// Duplicate topics / sub-topics panel (Oct 27 2026) — "ek chapter me same topic ek hi baar".
// Backend: GET /bank/admin/taxonomy/duplicates, POST .../merge, POST .../merge-all-exact, GET/POST .../merge-log[/:id/undo]
import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";

type Row = { id: string; parentId: string; name: string; nameHindi?: string | null; slug: string; questionCount: number };
type Group = {
  kind: "TOPIC" | "SUBTOPIC" | "CHAPTER";
  scopeId: string;
  reason: "same-name" | "same-hindi" | "similar";
  rows: Row[];
  survivorId: string;
  loserIds: string[];
  totalQuestions: number;
};
type Audit = {
  summary: { topicGroups: number; subTopicGroups: number; chapterGroups: number; exactGroups: number; similarGroups: number; rowsToRemove: number };
  topics: Group[];
  subTopics: Group[];
  chapters: Group[];
};
type LogRow = { id: string; kind: string; survivorName: string; loserName: string; questionsMoved: number; createdAt: string; undoneAt: string | null };

const REASON: Record<Group["reason"], string> = { "same-name": "Same naam", "same-hindi": "Same Hindi naam", similar: "Milta-julta (check karo)" };

async function jsonOrThrow(r: Response) {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((Array.isArray(body?.message) ? body.message.join(", ") : body?.message) || `HTTP ${r.status}`);
  return body;
}

export default function DuplicateTopicsPage() {
  const [audit, setAudit] = React.useState<Audit | null>(null);
  const [log, setLog] = React.useState<LogRow[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  // admin can pick a different survivor inside a group
  const [pick, setPick] = React.useState<Record<string, string>>({});

  const load = React.useCallback(async () => {
    setBusy("load");
    try {
      const [a, l] = await Promise.all([
        fetchAuth(`${API_BASE}/bank/admin/taxonomy/duplicates`).then(jsonOrThrow),
        fetchAuth(`${API_BASE}/bank/admin/taxonomy/merge-log?take=20`).then(jsonOrThrow),
      ]);
      setAudit(a);
      setLog(l);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);

  const mergeGroup = async (g: Group) => {
    const survivorId = pick[groupKey(g)] ?? g.survivorId;
    const loserIds = g.rows.map((r) => r.id).filter((id) => id !== survivorId);
    const survivor = g.rows.find((r) => r.id === survivorId);
    if (!window.confirm(`"${survivor?.name}" rakhna hai aur ${loserIds.length} duplicate hatana hai? (Undo log me mil jayega)`)) return;
    setBusy(groupKey(g));
    try {
      await fetchAuth(`${API_BASE}/bank/admin/taxonomy/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: g.kind, survivorId, loserIds }),
      }).then(jsonOrThrow);
      setMsg({ ok: true, text: "Merge ho gaya." });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const mergeAll = async () => {
    if (!audit) return;
    if (!window.confirm(`${audit.summary.exactGroups} same-naam groups merge honge (${audit.summary.rowsToRemove} rows hategi). "Milta-julta" wale nahi chhuye jayenge. Pehle DB backup liya? Aage badhein?`)) return;
    setBusy("all");
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/taxonomy/merge-all-exact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false, confirm: true }),
      }).then(jsonOrThrow);
      setMsg({ ok: true, text: `${r.losersMerged} duplicate rows merge hui.` });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const undo = async (id: string) => {
    if (!window.confirm("Ye merge undo karein?")) return;
    setBusy(id);
    try {
      await fetchAuth(`${API_BASE}/bank/admin/taxonomy/merge-log/${id}/undo`, { method: "POST" }).then(jsonOrThrow);
      setMsg({ ok: true, text: "Undo ho gaya." });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const groupKey = (g: Group) => `${g.kind}:${g.rows.map((r) => r.id).sort().join(",")}`;
  const section = (title: string, groups: Group[], canMerge: boolean) =>
    groups.length === 0 ? null : (
      <section className="mt-6">
        <h2 className="text-lg font-semibold">{title} ({groups.length})</h2>
        <div className="mt-2 space-y-3">
          {groups.map((g) => {
            const survivorId = pick[groupKey(g)] ?? g.survivorId;
            return (
              <div key={groupKey(g)} className="rounded-lg border border-border/60 bg-card p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{REASON[g.reason]} · {g.totalQuestions} questions</span>
                  {canMerge && (
                    <button
                      className="btn btn-primary"
                      disabled={busy !== null}
                      onClick={() => mergeGroup(g)}
                    >
                      {busy === groupKey(g) ? "Merging…" : "Merge"}
                    </button>
                  )}
                </div>
                <ul className="space-y-1">
                  {g.rows.map((r) => (
                    <li key={r.id} className="flex items-center gap-2 text-sm">
                      {canMerge && (
                        <input
                          type="radio"
                          name={groupKey(g)}
                          checked={survivorId === r.id}
                          onChange={() => setPick((p) => ({ ...p, [groupKey(g)]: r.id }))}
                          aria-label={`${r.name} rakhna hai`}
                        />
                      )}
                      <span className={survivorId === r.id ? "font-semibold" : ""}>
                        {r.name}
                        {r.nameHindi ? ` / ${r.nameHindi}` : ""}
                      </span>
                      <span className="text-xs text-muted-foreground">{r.questionCount}q</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
    );

  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="text-2xl font-bold">Duplicate Topics</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Ek chapter me ek topic / sub-topic sirf ek baar. Radio se wo row chunein jo rakhni hai; baaki ke questions, practice sets aur weak-topic data usme move ho jate hain.
      </p>
      {msg && (
        <div className={`mt-3 rounded-md border p-2 text-sm ${msg.ok ? "border-green-500/40" : "border-red-500/40"}`}>{msg.text}</div>
      )}
      {busy === "load" && <p className="mt-4 text-sm">Load ho raha hai…</p>}
      {audit && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span>Same-naam groups: <b>{audit.summary.exactGroups}</b></span>
            <span>Milte-julte: <b>{audit.summary.similarGroups}</b></span>
            <button className="btn btn-primary" disabled={busy !== null || audit.summary.exactGroups === 0} onClick={mergeAll}>
              {busy === "all" ? "Merging…" : "Saare same-naam merge karo"}
            </button>
          </div>
          {audit.summary.topicGroups + audit.summary.subTopicGroups + audit.summary.chapterGroups === 0 && (
            <p className="mt-6 text-sm">Koi duplicate nahi mila. ✅</p>
          )}
          {section("Topics", audit.topics, true)}
          {section("Sub-topics", audit.subTopics, true)}
          {section("Chapters (sirf report — Chapter Management se merge karein)", audit.chapters, false)}
        </>
      )}
      {log.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Merge history</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {log.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/60 px-2 py-1">
                <span>
                  {`${l.kind === "TOPIC" ? "Topic" : "Sub-topic"}: "${l.loserName}" → "${l.survivorName}" · ${l.questionsMoved}q · ${new Date(l.createdAt).toLocaleString()}`}
                </span>
                {l.undoneAt ? (
                  <span className="text-xs text-muted-foreground">undo ho chuka</span>
                ) : (
                  <button className="btn btn-outline" disabled={busy !== null} onClick={() => undo(l.id)}>Undo</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
