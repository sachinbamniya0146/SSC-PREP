"use client";

// Word learn/detail page (NEW — Sep 2026)
//
// Shows a word's full learning content (meaning, memory trick, etymology,
// synonyms/antonyms with their own example sentences, confusing-pair note)
// and hands off to /vocabulary/[slug]/quiz to test it. If the word is
// LOCKED (previous word not yet mastered at 95%+), offers the ₹10
// force-unlock via the same Cashfree flow /premium and /pdfs already use.
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { API_BASE, fetchAuth } from "@/lib/api";
import { startCashfreeCheckout, type BiMsg } from "@/lib/vocab-pay";
import BiMessage from "@/components/BiMessage";

type SynAnt = { word: string; hindi?: string; sentence?: string };
type Example = { en?: string; hi?: string };

type WordDetail = {
  id: string;
  slug: string;
  word: string;
  orderIndex: number;
  partOfSpeech?: string | null;
  pronunciation?: string | null;
  meaningHindi: string;
  meaningEnglish: string;
  memoryTrick?: string | null;
  etymology?: string | null;
  registerNote?: string | null;
  examTrendNote?: string | null;
  confusingPairNote?: string | null;
  examples: Example[];
  synonyms: SynAnt[];
  antonyms: SynAnt[];
  state: "LOCKED" | "UNLOCKED" | "MASTERED";
  bestScorePct: number;
  attemptsCount: number;
  questionCount: number;
  masteryThresholdPct: number;
  requiredCorrectCount: number;
};

export default function VocabWordDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = String(params?.slug ?? "");
  const [word, setWord] = React.useState<WordDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [lockedMessage, setLockedMessage] = React.useState("");
  const [nextActionableWordSlug, setNextActionableWordSlug] = React.useState("");
  const [nextActionableWord, setNextActionableWord] = React.useState("");
  const [subscribing, setSubscribing] = React.useState(false);
  // NEW (Sep 29 2026): bilingual server messages + which lock reason we hit.
  const [lockMsg, setLockMsg] = React.useState<BiMsg | null>(null);
  const [lockCode, setLockCode] = React.useState("");
  const [lockedWordId, setLockedWordId] = React.useState("");
  const [skipFee, setSkipFee] = React.useState(0);
  const [pricing, setPricing] = React.useState<{ wordUnlock: { priceInr: number; message: BiMsg }; unlockAll: { priceInr: number; message: BiMsg } } | null>(null);
  const [confirm, setConfirm] = React.useState<"" | "word" | "all">("");


  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    setLockedMessage("");
    try {
      const r = await fetchAuth(`${API_BASE}/vocab/words/${slug}`);
      if (r.status === 403) {
        const d = await r.json().catch(() => ({}));
        setLockedMessage(d?.message || "Ye word abhi locked hai.");
        setLockMsg(d?.messages || null);
        setLockCode(d?.code || "");
        setLockedWordId(d?.wordId || "");
        setSkipFee(d?.skipFeeInr || 0);
        fetchAuth(`${API_BASE}/vocab/pricing`).then((pr) => (pr.ok ? pr.json() : null)).then((pj) => pj && setPricing(pj)).catch(() => undefined);
        setNextActionableWordSlug(d?.nextActionableWordSlug || "");
        setNextActionableWord(d?.nextActionableWord || "");
        return;
      }
      if (!r.ok) throw new Error("Load failed");
      setWord(await r.json());
    } catch {
      setError("Load nahi ho paya.");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  React.useEffect(() => {
    load();
  }, [load]);

  const pay = async (product: Parameters<typeof startCashfreeCheckout>[0]) => {
    setSubscribing(true);
    setError("");
    try {
      await startCashfreeCheckout(product);
    } catch (e: any) {
      setError(e.message || "Payment start nahi hua");
      setSubscribing(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-background text-foreground"><main className="mx-auto max-w-2xl px-4 py-10 text-center text-muted-foreground">Loading…</main></div>;
  }

  if (lockedMessage) {
    const revisionPending = lockCode === "REVISION_PENDING";
    return (
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto max-w-md px-4 py-16 text-center">
          <div className="text-4xl">{revisionPending ? "🔁" : "🔒"}</div>
          <h1 className="mt-3 text-lg font-bold">{revisionPending ? "Pehle aaj ki revision / Revise first" : "Ye word locked hai / This word is locked"}</h1>
          {lockMsg ? <BiMessage msg={lockMsg} tone="warn" className="mt-3 text-left" /> : <p className="mt-2 text-sm text-muted-foreground">{lockedMessage}</p>}
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}

          {revisionPending ? (
            <div className="mt-6 flex flex-col gap-2">
              <a href="/vocabulary/revision" className="btn bg-primary py-2.5 text-sm font-semibold text-primary-foreground">▶ Start revision (free)</a>
              <a href="/vocabulary/revision" className="text-xs text-muted-foreground underline">Skip for ₹{skipFee || 1} — details on the revision page</a>
            </div>
          ) : (
            <>
              {nextActionableWord && (
                <a
                  href={`/vocabulary/${nextActionableWordSlug}`}
                  className="mt-4 inline-block rounded-lg border border-primary/40 bg-primary/5 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/10"
                >
                  👉 "{nextActionableWord}" seekhein aur 95%+ score karein (free) →
                </a>
              )}
              <div className="mt-6 flex flex-col gap-2">
                {confirm === "" && (
                  <>
                    <button onClick={() => setConfirm("word")} className="btn btn-outline py-2.5 text-sm">
                      Unlock this word — ₹{pricing?.wordUnlock.priceInr ?? 2}
                    </button>
                    <button onClick={() => setConfirm("all")} className="btn btn-outline py-2.5 text-sm">
                      Unlock ALL words — ₹{pricing?.unlockAll.priceInr ?? 100}
                    </button>
                  </>
                )}
                {confirm === "word" && (
                  <div className="space-y-2 text-left">
                    <BiMessage msg={pricing?.wordUnlock.message} tone="warn" />
                    <button onClick={() => pay({ vocabWordId: lockedWordId })} disabled={subscribing || !lockedWordId} className="btn w-full bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                      {subscribing ? "Redirecting…" : `Pay ₹${pricing?.wordUnlock.priceInr ?? 2} & unlock this word`}
                    </button>
                    <button onClick={() => setConfirm("")} className="btn btn-outline w-full py-2 text-sm">Wapas / Back</button>
                  </div>
                )}
                {confirm === "all" && (
                  <div className="space-y-2 text-left">
                    <BiMessage msg={pricing?.unlockAll.message} tone="danger" />
                    <button onClick={() => pay({ vocabUnlockAll: true })} disabled={subscribing} className="btn w-full border border-red-500/40 bg-red-500/10 py-2.5 text-sm font-semibold text-red-600 disabled:opacity-50">
                      {subscribing ? "Redirecting…" : `Pay ₹${pricing?.unlockAll.priceInr ?? 100} & unlock all words`}
                    </button>
                    <button onClick={() => setConfirm("")} className="btn btn-outline w-full py-2 text-sm">Nahi, padhunga / No, I will study</button>
                  </div>
                )}
              </div>
            </>
          )}
          <a href="/vocabulary" className="btn btn-outline mt-4 block py-2.5 text-sm">← Vocabulary list par wapas jaayein</a>
        </main>
      </div>
    );
  }

  if (error || !word) {
    return <div className="min-h-screen bg-background text-foreground"><main className="mx-auto max-w-2xl px-4 py-10 text-center text-danger">{error || "Word not found"}</main></div>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <a href="/vocabulary" className="text-sm font-semibold">← Vocabulary</a>
          {word.state === "MASTERED" && <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">✅ Mastered ({word.bestScorePct}%)</span>}
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-3xl font-bold">{word.word}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {word.partOfSpeech && <span>{word.partOfSpeech} · </span>}
          {word.pronunciation && <span>/{word.pronunciation}/</span>}
        </p>

        <div className="mt-4 rounded-xl border border-border bg-card p-5">
          <p className="font-semibold text-primary">{word.meaningHindi}</p>
          <p className="mt-2 text-sm text-muted-foreground">{word.meaningEnglish}</p>
        </div>

        {word.memoryTrick && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
            <h2 className="text-sm font-bold">💡 Yaad rakhne ki trick</h2>
            <p className="mt-1.5 text-sm">{word.memoryTrick}</p>
          </div>
        )}

        {word.etymology && (
          <div className="mt-4 rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-bold">🌱 Etymology</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{word.etymology}</p>
          </div>
        )}

        {word.examples.length > 0 && (
          <div className="mt-4 rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-bold">✍️ Examples</h2>
            <div className="mt-2 space-y-2">
              {word.examples.map((ex, i) => (
                <div key={i} className="text-sm">
                  <p>{ex.en}</p>
                  {ex.hi && <p className="text-xs text-muted-foreground">{ex.hi}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {word.synonyms.length > 0 && (
          <div className="mt-4 rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-bold">🟢 Synonyms ({word.synonyms.length})</h2>
            <div className="mt-2 space-y-2">
              {word.synonyms.map((s, i) => (
                <div key={i} className="border-b border-border/50 pb-2 text-sm last:border-0">
                  <p className="font-semibold">{s.word} {s.hindi && <span className="font-normal text-muted-foreground">— {s.hindi}</span>}</p>
                  {s.sentence && <p className="text-xs text-muted-foreground">{s.sentence}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {word.antonyms.length > 0 && (
          <div className="mt-4 rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-bold">🔴 Antonyms ({word.antonyms.length})</h2>
            <div className="mt-2 space-y-2">
              {word.antonyms.map((s, i) => (
                <div key={i} className="border-b border-border/50 pb-2 text-sm last:border-0">
                  <p className="font-semibold">{s.word} {s.hindi && <span className="font-normal text-muted-foreground">— {s.hindi}</span>}</p>
                  {s.sentence && <p className="text-xs text-muted-foreground">{s.sentence}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {(word.registerNote || word.examTrendNote || word.confusingPairNote) && (
          <div className="mt-4 rounded-xl border border-border bg-muted/20 p-5 text-xs text-muted-foreground">
            {word.registerNote && <p><b>Usage:</b> {word.registerNote}</p>}
            {word.examTrendNote && <p className="mt-1"><b>Exam Trend:</b> {word.examTrendNote}</p>}
            {word.confusingPairNote && <p className="mt-1"><b>Confusing pair:</b> {word.confusingPairNote}</p>}
          </div>
        )}

        <div className="sticky bottom-4 mt-6">
          <button
            onClick={() => router.push(`/vocabulary/${word.slug}/quiz`)}
            className="btn w-full bg-primary py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            🚀 {word.attemptsCount > 0 ? "Quiz dobara dein" : "Quiz shuru karein"} ({word.questionCount} questions me se {word.requiredCorrectCount} sahi chahiye — {word.masteryThresholdPct}%+)
          </button>
        </div>
      </main>
    </div>
  );
}
