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
};

let cashfreeSdkPromise: Promise<any> | null = null;
function loadCashfreeSdk(): Promise<any> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if ((window as any).Cashfree) return Promise.resolve((window as any).Cashfree);
  if (cashfreeSdkPromise) return cashfreeSdkPromise;
  cashfreeSdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    script.async = true;
    script.onload = () => resolve((window as any).Cashfree);
    script.onerror = () => reject(new Error("Payment SDK load failed"));
    document.body.appendChild(script);
  });
  return cashfreeSdkPromise;
}

export default function VocabWordDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = String(params?.slug ?? "");
  const [word, setWord] = React.useState<WordDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [lockedMessage, setLockedMessage] = React.useState("");
  const [unlocking, setUnlocking] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    setLockedMessage("");
    try {
      const r = await fetchAuth(`${API_BASE}/vocab/words/${slug}`);
      if (r.status === 403) {
        const d = await r.json().catch(() => ({}));
        setLockedMessage(d?.message || "Ye word abhi locked hai.");
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

  const unlockWithPayment = async () => {
    setUnlocking(true);
    try {
      // Need the word's real id to create the order — locked words 403 on
      // the detail endpoint, so fetch the hub list (which always includes
      // every word + its id, locked or not) to resolve slug -> id.
      const listRes = await fetchAuth(`${API_BASE}/vocab/words`);
      const listData = await listRes.json();
      const target = (listData.words || []).find((w: any) => w.slug === slug);
      if (!target) throw new Error("Word not found");

      const orderRes = await fetchAuth(`${API_BASE}/payments/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vocabWordId: target.id }),
      });
      if (!orderRes.ok) {
        const d = await orderRes.json().catch(() => ({}));
        throw new Error(d?.message || "Order create nahi hua");
      }
      const order = await orderRes.json();
      const Cashfree = await loadCashfreeSdk();
      if (!Cashfree) throw new Error("Payment SDK load nahi hua");
      const cashfree = Cashfree({ mode: order.cashfreeEnv === "PRODUCTION" ? "production" : "sandbox" });
      await cashfree.checkout({ paymentSessionId: order.paymentSessionId, redirectTarget: "_self" });
    } catch (e: any) {
      setError(e.message || "Payment start nahi hua");
      setUnlocking(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-background text-foreground"><main className="mx-auto max-w-2xl px-4 py-10 text-center text-muted-foreground">Loading…</main></div>;
  }

  if (lockedMessage) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto max-w-md px-4 py-16 text-center">
          <div className="text-4xl">🔒</div>
          <h1 className="mt-3 text-lg font-bold">Ye word locked hai</h1>
          <p className="mt-2 text-sm text-muted-foreground">{lockedMessage}</p>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
          <div className="mt-6 flex flex-col gap-2">
            <button
              onClick={unlockWithPayment}
              disabled={unlocking}
              className="btn bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {unlocking ? "Redirecting…" : "₹10 me abhi unlock karein"}
            </button>
            <a href="/vocabulary" className="btn btn-outline py-2.5 text-sm">← Vocabulary list par wapas jaayein</a>
          </div>
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
            🚀 {word.attemptsCount > 0 ? "Quiz dobara dein" : "Quiz shuru karein"} ({word.questionCount} questions, {word.masteryThresholdPct}%+ chahiye)
          </button>
        </div>
      </main>
    </div>
  );
}
