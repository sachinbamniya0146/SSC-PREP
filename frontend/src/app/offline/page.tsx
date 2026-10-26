"use client";

import * as React from "react";
import { AppHeader } from "@/components/AppHeader";
import { API_BASE, fetchAuth } from "@/lib/api";
import { cachePackImages, dropPackImages, useOnline } from "@/lib/offline";
import OfflineStatus from "@/components/OfflineStatus";
import { flushPendingSubmits, getPendingSubmits } from "@/lib/offline-submit";
import {
  type OfflinePack,
  type OfflineResult,
  type PackQuestion,
  PACK_TTL_DAYS,
  currentUserId,
  deletePack,
  isPackExpired,
  packImages,
  getPack,
  listPacks,
  listResults,
  savePack,
  saveResult,
  storageEstimate,
} from "@/lib/offline-packs";
import { ReviewLangToggle, ReviewQuestionBody, SolutionPanel, useReviewLang } from "@/components/SolutionPanel";

type Named = { id: string; name: string; count?: number };
const META_KEY = "ssc_offline_meta";
const COUNTS = [10, 15, 25];

const fmtDate = (t: number) => new Date(t).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

export default function OfflinePage() {
  const online = useOnline();
  const [user, setUser] = React.useState<{ fullName?: string } | null>(null);
  const [exams, setExams] = React.useState<Named[]>([]);
  const [subjects, setSubjects] = React.useState<Named[]>([]);
  const [examId, setExamId] = React.useState("");
  const [subjectId, setSubjectId] = React.useState("");
  const [count, setCount] = React.useState(25);
  const [packs, setPacks] = React.useState<OfflinePack[]>([]);
  const [results, setResults] = React.useState<OfflineResult[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [active, setActive] = React.useState<OfflinePack | null>(null);
  const [pending, setPending] = React.useState(0);
  const [storage, setStorage] = React.useState<{ usedMb: number; quotaMb: number } | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      let list = await listPacks();
      if (navigator.onLine) {
        const dead = list.filter((p) => isPackExpired(p));
        for (const p of dead) {
          await deletePack(p.id).catch(() => undefined);
          if (p.imageUrls?.length) void dropPackImages(p.imageUrls);
        }
        if (dead.length) list = list.filter((p) => !dead.includes(p));
      }
      setPacks(list);
      setResults(await listResults());
    } catch {
      /* IndexedDB blocked (private mode) */
    }
    setPending(getPendingSubmits().length);
    setStorage(await storageEstimate());
  }, []);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem("ssc_user");
      if (raw) setUser(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    void refresh();
  }, [refresh]);

  // exam / subject lists: live when online, last saved copy when offline
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchAuth(`${API_BASE}/bank/meta`);
        if (!r.ok) throw new Error("meta");
        const d = await r.json();
        const ex: Named[] = (d?.exams ?? []).filter((e: Named) => (e.count ?? 0) > 0);
        const su: Named[] = (d?.subjects ?? []).filter((s: Named) => (s.count ?? 0) > 0);
        if (cancelled) return;
        setExams(ex);
        setSubjects(su);
        try {
          localStorage.setItem(META_KEY, JSON.stringify({ ex, su }));
        } catch {
          /* ignore */
        }
      } catch {
        try {
          const saved = JSON.parse(localStorage.getItem(META_KEY) || "null");
          if (saved && !cancelled) {
            setExams(saved.ex ?? []);
            setSubjects(saved.su ?? []);
          }
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [online]);

  const download = async () => {
    if (!online) return setMsg({ tone: "err", text: "Download ke liye internet chahiye." });
    if (!examId || !subjectId) return setMsg({ tone: "err", text: "Pehle exam aur subject chunein." });
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetchAuth(`${API_BASE}/bank/set?examId=${encodeURIComponent(examId)}&subjectId=${encodeURIComponent(subjectId)}&count=${count}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.message || "Download fail hua.");
      const questions: PackQuestion[] = Array.isArray(d?.questions) ? d.questions : [];
      if (!questions.length) throw new Error("Is exam + subject me abhi questions available nahi hain.");
      const exam = exams.find((e) => e.id === examId);
      const subject = subjects.find((s) => s.id === subjectId);
      const imageUrls = packImages(questions);
      // pictures first: a pack is only "ready" when its diagrams can show with no internet
      let imagesMissing = 0;
      if (imageUrls.length) {
        setMsg({ tone: "ok", text: `Pictures save ho rahi hain (0/${imageUrls.length})…` });
        const res = await cachePackImages(imageUrls, (d, t) => setMsg({ tone: "ok", text: `Pictures save ho rahi hain (${d}/${t})…` }));
        imagesMissing = res ? res.failed : imageUrls.length; // no worker (unsupported browser) = nothing could be saved
      }
      const now = Date.now();
      const pack: OfflinePack = {
        id: `${examId}:${subjectId}:${now}`,
        title: `${exam?.name ?? "Exam"} · ${subject?.name ?? "Subject"}`,
        examId,
        examName: exam?.name ?? "",
        subjectId,
        subjectName: subject?.name ?? "",
        createdAt: now,
        questions,
        userId: currentUserId() ?? undefined,
        expiresAt: now + PACK_TTL_DAYS * 86400000,
        imageUrls,
        imagesMissing,
      };
      await savePack(pack);
      setMsg({
        tone: imagesMissing ? "err" : "ok",
        text: imagesMissing
          ? `${questions.length} questions save ho gaye, par ${imagesMissing} picture save nahi hui (offline me wo nahi dikhegi).`
          : `${questions.length} questions offline save ho gaye.`,
      });
      await refresh();
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : "Download fail hua." });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const gone = packs.find((p) => p.id === id);
    await deletePack(id);
    if (gone?.imageUrls?.length) {
      // keep pictures that another saved pack still uses
      const still = new Set(packs.filter((p) => p.id !== id).flatMap((p) => p.imageUrls ?? []));
      void dropPackImages(gone.imageUrls.filter((u) => !still.has(u)));
    }
    await refresh();
  };

  const syncNow = async () => {
    setBusy(true);
    await flushPendingSubmits();
    setPending(getPendingSubmits().length);
    setBusy(false);
  };

  if (active) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader name={user?.fullName} />
        <Runner
          pack={active}
          online={online}
          onExit={() => {
            setActive(null);
            void refresh();
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader name={user?.fullName} />
      <main className="container-page max-w-4xl py-8 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Offline practice</h1>
            <p className="mt-1 text-sm text-muted-foreground">Questions download karein, phir bina internet practice karein, answer aur solution ke saath.</p>
          </div>
          <span className={`badge ${online ? "badge-success" : "badge-warning"}`}>{online ? "● Online" : "● Offline"}</span>
        </div>

        <OfflineStatus packs={packs} onChanged={refresh} />

        {pending > 0 && (
          <div className="card mt-6 flex flex-wrap items-center justify-between gap-3 border-warning/40 bg-warning/5 p-4">
            <p className="text-sm">
              <b>{pending}</b> test ka result device par saved hai, internet aate hi submit hoga.
            </p>
            <button className="btn btn-primary btn-sm" onClick={syncNow} disabled={!online || busy}>
              Abhi sync karein
            </button>
          </div>
        )}

        <section className="card mt-6 p-5 sm:p-6">
          <h2 className="font-bold">Naya pack download karein</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium">Exam</span>
              <select value={examId} onChange={(e) => setExamId(e.target.value)} className="w-full border bg-background px-3 py-2.5 text-sm">
                <option value="">Chunein…</option>
                {exams.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Subject</span>
              <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="w-full border bg-background px-3 py-2.5 text-sm">
                <option value="">Chunein…</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Questions</span>
              <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full border bg-background px-3 py-2.5 text-sm">
                {COUNTS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button onClick={download} disabled={busy || !online} className="btn btn-primary">
              {busy ? "Download ho raha hai…" : "Download for offline"}
            </button>
            {msg && <span className={`text-sm ${msg.tone === "ok" ? "text-success" : "text-danger"}`}>{msg.text}</span>}
          </div>
          {!online && <p className="mt-3 text-xs text-muted-foreground">Naye pack ke liye internet chahiye. Neeche ke saved packs abhi bhi chalenge.</p>}
        </section>

        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Saved packs ({packs.length})</h2>
          {packs.length === 0 ? (
            <div className="card border-dashed p-8 text-center text-sm text-muted-foreground">Abhi koi pack saved nahi hai. Upar se download karein.</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {packs.map((p) => (
                <div key={p.id} className="card p-5">
                  <h3 className="font-semibold">{p.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {p.questions.length} questions · saved {fmtDate(p.createdAt)}
                    {p.expiresAt ? ` · ${isPackExpired(p) ? "expired" : "valid till " + new Date(p.expiresAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}` : ""}
                  </p>
                  <div className="mt-4 flex gap-2">
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={isPackExpired(p)}
                      title={isPackExpired(p) ? "Pack expire ho gaya: online aakar dobara download karein" : undefined}
                      onClick={async () => setActive((await getPack(p.id)) ?? p)}
                    >
                      {isPackExpired(p) ? "Expired" : "Practice karein"}
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={() => remove(p.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {storage && (
            <p className="mt-3 text-xs text-muted-foreground">Device storage use: {storage.usedMb} MB / {storage.quotaMb} MB</p>
          )}
        </section>

        {results.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Offline practice history</h2>
            <div className="card divide-y divide-border">
              {results.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(r.at)}</p>
                  </div>
                  <p className="text-xs">
                    <b className="text-base">{r.score}</b>/{r.maxScore} · <span className="text-success">{r.correct} sahi</span> · <span className="text-danger">{r.wrong} galat</span> · {r.skipped} skip
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

// ------------------------------------------------------------------ practice runner

function Runner({ pack, online, onExit }: { pack: OfflinePack; online: boolean; onExit: () => void }) {
  const [lang, setLang] = useReviewLang();
  const [idx, setIdx] = React.useState(0);
  const [picked, setPicked] = React.useState<Record<string, string>>({});
  const [done, setDone] = React.useState(false);
  const qs = pack.questions;
  const q = qs[idx];

  const keyOf = (v?: string | null) => (v || "").trim().toUpperCase();
  const stats = React.useMemo(() => {
    let correct = 0, wrong = 0, score = 0, max = 0;
    for (const x of qs) {
      const m = x.marks ?? 1;
      const n = x.negativeMarks ?? 0.25;
      max += m;
      const p = picked[x.id];
      if (!p) continue;
      if (keyOf(p) === keyOf(x.correctAnswer)) { correct++; score += m; } else { wrong++; score -= n; }
    }
    return { correct, wrong, skipped: qs.length - correct - wrong, score: Math.round(score * 100) / 100, max: Math.round(max * 100) / 100 };
  }, [picked, qs]);

  const finish = async () => {
    setDone(true);
    try {
      await saveResult({ packId: pack.id, title: pack.title, at: Date.now(), total: qs.length, correct: stats.correct, wrong: stats.wrong, skipped: stats.skipped, score: stats.score, maxScore: stats.max });
    } catch {
      /* ignore */
    }
  };

  if (done) {
    return (
      <main className="container-page max-w-2xl py-10">
        <div className="card p-8 text-center">
          <h1 className="text-2xl font-extrabold">Practice complete</h1>
          <p className="mt-1 text-sm text-muted-foreground">{pack.title}</p>
          <p className="mt-6 text-5xl font-extrabold text-primary">{stats.score}<span className="text-xl text-muted-foreground"> / {stats.max}</span></p>
          <p className="mt-3 text-sm">
            <span className="text-success">{stats.correct} sahi</span> · <span className="text-danger">{stats.wrong} galat</span> · {stats.skipped} skip
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button className="btn btn-primary" onClick={() => { setPicked({}); setIdx(0); setDone(false); }}>Dobara karein</button>
            <button className="btn btn-outline" onClick={onExit}>Packs par wapas</button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Ye offline practice sirf is device par saved hai.</p>
        </div>
      </main>
    );
  }

  const answered = picked[q.id];
  const correctKey = keyOf(q.correctAnswer);
  const correctLabel = q.options.find((o) => keyOf(o.key) === correctKey)?.text ?? null;

  return (
    <main className="container-page max-w-3xl py-6 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button className="btn btn-ghost btn-sm" onClick={onExit}>← Exit</button>
        <ReviewLangToggle lang={lang} onChange={setLang} />
        <span className="text-xs font-semibold text-muted-foreground">Q {idx + 1} / {qs.length}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${((idx + (answered ? 1 : 0)) / qs.length) * 100}%` }} />
      </div>

      <div className="card mt-4 p-4 sm:p-6">
        {!answered ? (
          <>
            <ReviewQuestionBody
              questionText={q.questionText}
              questionTextHindi={q.questionTextHindi}
              diagramType={q.questionDiagramType}
              diagramLabels={q.questionDiagramLabels}
              imageUrl={q.questionImageUrl}
              options={[]}
              lang={lang}
            />
            <div className="mt-4 space-y-2">
              {q.options.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setPicked((p) => ({ ...p, [q.id]: o.key }))}
                  className="flex w-full items-start gap-3 rounded-xl border border-border bg-card p-3 text-left text-sm transition hover:border-primary hover:bg-primary/5"
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-input text-xs font-bold">{o.key}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block">{lang === "hi" && o.textHi ? o.textHi : o.text}</span>
                    {lang === "both" && o.textHi && <span className="mt-1 block border-l-2 border-primary/40 pl-2.5 font-hindi text-muted-foreground">{o.textHi}</span>}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button className="btn btn-outline btn-sm" onClick={() => (idx + 1 < qs.length ? setIdx(idx + 1) : void finish())}>
                Skip
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className={`rounded-lg px-3 py-2 text-sm font-semibold ${keyOf(answered) === correctKey ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
              {keyOf(answered) === correctKey ? "✓ Sahi jawab!" : `✗ Galat. Sahi answer: ${correctKey}`}
            </div>
            <ReviewQuestionBody
              questionText={q.questionText}
              questionTextHindi={q.questionTextHindi}
              diagramType={q.questionDiagramType}
              diagramLabels={q.questionDiagramLabels}
              imageUrl={q.questionImageUrl}
              options={q.options}
              selected={answered}
              correct={correctKey}
              lang={lang}
            />
            {q.explanation || q.explanationHindi || online ? (
              <SolutionPanel
                questionId={q.id}
                correctKey={correctKey}
                correctLabel={correctLabel}
                explanation={q.explanation}
                explanationHindi={q.explanationHindi}
                lang={lang}
              />
            ) : (
              <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">Is question ka solution pack me nahi hai. Internet aane par Results/Review me dekh sakte hain.</p>
            )}
            <div className="flex justify-end">
              <button className="btn btn-primary" onClick={() => (idx + 1 < qs.length ? setIdx(idx + 1) : void finish())}>
                {idx + 1 < qs.length ? "Next →" : "Finish"}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
