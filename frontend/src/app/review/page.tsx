"use client";

import * as React from "react";

type ReviewCardData = {
  id: string;
  questionId: string;
  dueAt: string;
  intervalDays: number;
  repetitions: number;
  easeFactor: number;
  lapses: number;
  question: {
    id: string;
    questionText: string;
    questionTextHindi?: string | null;
    optionsJson: { key: string; text: string }[];
    correctAnswer: string;
    explanation?: string | null;
    explanationHindi?: string | null;
    videoUrl?: string | null;
    videoTitle?: string | null;
  };
};

type Grade = "again" | "hard" | "good" | "easy";

function VideoPlayer({ url, title }: { url: string; title?: string | null }) {
  let src = url;
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu")) {
      const v = u.searchParams.get("v") || u.pathname.split("/").filter(Boolean).pop();
      src = v ? `https://www.youtube.com/embed/${v}` : url;
    } else if (u.hostname.includes("vimeo")) {
      const id = u.pathname.split("/").filter(Boolean).pop();
      src = id ? `https://player.vimeo.com/video/${id}` : url;
    }
  } catch {
    src = url;
  }
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border">
      <iframe
        src={src}
        title={title || "Video Solution"}
        className="aspect-video w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    </div>
  );
}

export default function ReviewPage() {
  const [cards, setCards] = React.useState<ReviewCardData[]>([]);
  const [stats, setStats] = React.useState<{ dueCount: number; totalCards: number; upcomingCount: number } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [revealed, setRevealed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
  const headers = (): Record<string, string> => {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const load = async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiBase}/review/due?limit=15`, { headers: headers() });
      if (res.ok) {
        const d = await res.json();
        setCards(d.due || []);
        setStats(d.stats || null);
        setRevealed(false);
      } else {
        setMsg({ ok: false, text: "Could not load review queue — login pehle karo." });
      }
    } catch {
      setMsg({ ok: false, text: "Network error loading review queue." });
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grade = async (cardId: string, g: Grade) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiBase}/review/grade`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ cardId, grade: g }),
      });
      if (res.ok) {
        setRevealed(false);
        await load();
      } else {
        const d = await res.json().catch(() => ({}));
        setMsg({ ok: false, text: d.message || "Failed to save review." });
      }
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const card = cards[0];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">
            ← <span className="text-primary">SSC</span>PrepHub
          </a>
          <span className="text-sm text-muted-foreground">Spaced Repetition 🔁</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Review Queue</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Galat/skipped questions yahan aate hain — 1d → 3d → 7d → 14d → 30d intervals pe.
            </p>
          </div>
          <span className="rounded-full bg-muted px-4 py-1.5 text-sm font-semibold text-muted-foreground">
            {stats ? `${stats.dueCount} due · ${stats.upcomingCount} upcoming` : "…"}
          </span>
        </div>

        {msg && !msg.ok && (
          <p className="mt-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">{msg.text}</p>
        )}

        {loading && <p className="mt-10 text-center text-muted-foreground">Loading…</p>}

        {!loading && stats && stats.dueCount === 0 && (
          <div className="card mt-10 p-10 text-center">
            <p className="text-4xl">🎉</p>
            <h2 className="mt-3 text-xl font-bold">Sab clear hai!</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Abhi koi review due nahi hai. Quiz me galat jawab de kar yahan cards collect karo.
            </p>
            <a href="/quiz" className="btn btn-primary mt-6 inline-block">
              Aaj ka Quiz Do →
            </a>
          </div>
        )}

        {!loading && card && (
          <div className="card mt-8 p-6">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium">{card.question.questionText}</p>
              <span className="shrink-0 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                {card.repetitions}x · lapses {card.lapses}
              </span>
            </div>

            {card.question.questionTextHindi && (
              <p className="mt-1 text-sm text-muted-foreground">🇮🇳 {card.question.questionTextHindi}</p>
            )}

            <div className="mt-4 space-y-2">
              {card.question.optionsJson.map((o) => (
                <div
                  key={o.key}
                  className={`rounded-lg px-4 py-2.5 text-sm ${
                    revealed && o.key === card.question.correctAnswer
                      ? "bg-success/15 font-semibold text-success"
                      : revealed && o.key !== card.question.correctAnswer
                        ? "bg-muted/50 text-muted-foreground"
                        : "bg-muted"
                  }`}
                >
                  <span className="mr-2 font-semibold">{o.key}.</span>
                  {o.text}
                  {revealed && o.key === card.question.correctAnswer && (
                    <span className="ml-2 text-xs">✅ Sahi Answer</span>
                  )}
                </div>
              ))}
            </div>

            {revealed && (card.question.explanation || card.question.explanationHindi) && (
              <div className="mt-4 rounded-lg bg-primary/10 p-3 text-sm leading-relaxed">
                {card.question.explanation && (
                  <p className="whitespace-pre-line">{card.question.explanation}</p>
                )}
                {card.question.explanationHindi && (
                  <p className="mt-2 whitespace-pre-line text-muted-foreground">
                    🇮🇳 {card.question.explanationHindi}
                  </p>
                )}
              </div>
            )}

            {revealed && card.question.videoUrl && (
              <VideoPlayer url={card.question.videoUrl} title={card.question.videoTitle} />
            )}

            <div className="mt-6">
              {!revealed ? (
                <>
                  <button
                    onClick={() => setRevealed(true)}
                    className="w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground hover:opacity-90"
                  >
                    👁 Show Answer
                  </button>
                  <p className="mt-3 text-center text-xs text-muted-foreground">
                    Pehle khud socho, phir answer dekho — yahi spaced repetition ka asli faida hai.
                  </p>
                </>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {(
                    [
                      { g: "again", label: "😵 Again", cls: "bg-danger/15 text-danger hover:bg-danger/25" },
                      { g: "hard", label: "😓 Hard", cls: "bg-warning/15 text-warning hover:bg-warning/25" },
                      { g: "good", label: "🙂 Good", cls: "bg-primary/15 text-primary hover:bg-primary/25" },
                      { g: "easy", label: "😎 Easy", cls: "bg-success/15 text-success hover:bg-success/25" },
                    ] as { g: Grade; label: string; cls: string }[]
                  ).map(({ g, label, cls }) => (
                    <button
                      key={g}
                      onClick={() => grade(card.id, g)}
                      disabled={busy}
                      className={`rounded-xl py-3 text-sm font-semibold transition disabled:opacity-40 ${cls}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {!loading && cards.length > 1 && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            +{cards.length - 1} aur cards queue me (is session me)
          </p>
        )}
      </main>
    </div>
  );
}