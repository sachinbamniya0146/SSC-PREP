"use client";

// Vocabulary Mastery hub.
//
// One card per word: Mastered / Open / On hold / Locked. Oct 28 2026 rework:
//  * "unlock then lock again" is gone — the server pins every unlock for good, and a pending daily revision or a
//    re-master request is shown as a temporary "On hold" badge with a one-tap fix, never as a padlock;
//  * filters (All / Open / Mastered / Locked) + search so a long list is easy to move around in;
//  * progress ring, today's plan and daily goal in one glance.
import * as React from "react";
import { useFeatures, FeatureOff } from "@/lib/features";
import { API_BASE, fetchAuth } from "@/lib/api";
import BiMessage from "@/components/BiMessage";
import { AppShell, CardSkeletons, ErrorNote, PageHeading } from "@/components/AppShell";
import { useT } from "@/lib/i18n";

type WordState = "LOCKED" | "UNLOCKED" | "MASTERED";

type WordCard = {
  id: string;
  slug: string;
  word: string;
  orderIndex: number;
  meaningHindi: string;
  state: WordState;
  gated?: boolean;
  bestScorePct: number;
  attemptsCount: number;
  needsRevision: boolean;
  needsRemaster?: boolean;
};

type RevisionStatus = {
  due: boolean;
  doneToday: string | null;
  skipFeeInr: number;
  messages: { pending: { en: string; hi: string } | null; remaster: { en: string; hi: string } | null };
  remaster: { slug: string; word: string }[];
};

type PlanWord = { slug: string; word: string; meaningHindi: string; state: string; bestScorePct: number };
type TodaysPlan = {
  wordsPerDay: number;
  masteredToday: number;
  newWordsToday: PlanWord[];
  comingUp: PlanWord[];
  revisionToday: PlanWord[];
  totalMastered: number;
  totalWords: number;
};

type Filter = "all" | "open" | "mastered" | "locked";

function Ring({ pct }: { pct: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <svg viewBox="0 0 84 84" className="h-20 w-20 shrink-0 -rotate-90" aria-hidden>
      <circle cx="42" cy="42" r={r} fill="none" strokeWidth="9" className="stroke-muted" />
      <circle
        cx="42"
        cy="42"
        r={r}
        fill="none"
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        className="stroke-success transition-all duration-700"
      />
    </svg>
  );
}

function VocabularyHubPageInner() {
  const tr = useT();
  const [words, setWords] = React.useState<WordCard[]>([]);
  const [totalWords, setTotalWords] = React.useState(0);
  const [masteredCount, setMasteredCount] = React.useState(0);
  const [plan, setPlan] = React.useState<TodaysPlan | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [goalDraft, setGoalDraft] = React.useState(1);
  const [savingGoal, setSavingGoal] = React.useState(false);
  const [revision, setRevision] = React.useState<RevisionStatus | null>(null);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [query, setQuery] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [wordsRes, planRes] = await Promise.all([fetchAuth(`${API_BASE}/vocab/words`), fetchAuth(`${API_BASE}/vocab/today`)]);
      if (!wordsRes.ok || !planRes.ok) throw new Error("Load failed");
      const wd = await wordsRes.json();
      const pd = await planRes.json();
      setWords(wd.words || []);
      setTotalWords(wd.totalWords || 0);
      setMasteredCount(wd.masteredCount || 0);
      setPlan(pd);
      setGoalDraft(pd.wordsPerDay || 1);
      fetchAuth(`${API_BASE}/vocab/revision/status`)
        .then((rr) => (rr.ok ? rr.json() : null))
        .then((rj) => rj && setRevision(rj))
        .catch(() => undefined);
    } catch {
      setError(tr("Could not load — please try again.", "Load nahi ho paya — dobara try karein."));
    } finally {
      setLoading(false);
    }
  }, [tr]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const saveGoal = async () => {
    setSavingGoal(true);
    try {
      const r = await fetchAuth(`${API_BASE}/vocab/daily-goal`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordsPerDay: goalDraft }),
      });
      if (r.ok) await load();
    } finally {
      setSavingGoal(false);
    }
  };

  const pct = totalWords ? Math.round((masteredCount / totalWords) * 100) : 0;
  const openCount = words.filter((w) => w.state === "UNLOCKED").length;
  const lockedCount = words.filter((w) => w.state === "LOCKED").length;

  const shown = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return words.filter((w) => {
      if (filter === "open" && w.state !== "UNLOCKED") return false;
      if (filter === "mastered" && w.state !== "MASTERED") return false;
      if (filter === "locked" && w.state !== "LOCKED") return false;
      if (q && w.state !== "LOCKED" && !w.word.toLowerCase().includes(q) && !w.meaningHindi.includes(q)) return false;
      if (q && w.state === "LOCKED") return false; // locked words are hidden on purpose, so they never match a search
      return true;
    });
  }, [words, filter, query]);

  const cardStyle = (w: WordCard) => {
    if (w.state === "MASTERED") return "border-success/40 bg-success/5";
    if (w.state === "LOCKED") return "border-border bg-muted/30 opacity-75";
    if (w.gated) return "border-warning/50 bg-warning/5";
    return "border-primary/40 bg-primary/5";
  };

  const tabs: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: tr("All", "Sabhi"), count: words.length },
    { id: "open", label: tr("Open", "Khule"), count: openCount },
    { id: "mastered", label: tr("Mastered", "Mastered"), count: masteredCount },
    { id: "locked", label: tr("Locked", "Locked"), count: lockedCount },
  ];

  return (
    <AppShell width="wide">
      <PageHeading
        title={tr("Vocabulary Mastery", "Vocabulary Mastery")}
        subtitle={tr(
          "Learn one word, then take its quiz — score 95%+ and the next word opens. Once a word is open, it stays open.",
          "Ek word padho, phir uska quiz do — 95%+ score par agla word khulta hai. Ek baar khula word hamesha khula rehta hai.",
        )}
      />

      {error && <ErrorNote onRetry={() => void load()}>{error}</ErrorNote>}

      {loading ? (
        <CardSkeletons count={3} />
      ) : (
        <>
          {/* Temporary holds — explained, never a padlock */}
          {revision?.due && (
            <div className="mb-4">
              <BiMessage msg={revision.messages.pending} tone="warn" />
              <a href="/vocabulary/revision" className="btn btn-primary mt-2">
                {tr("🔁 Start today's revision", "🔁 Aaj ki revision shuru karein")}
              </a>
            </div>
          )}
          {revision && revision.remaster.length > 0 && !revision.due && (
            <div className="mb-4">
              <BiMessage msg={revision.messages.remaster} tone="warn" />
              <div className="mt-2 flex flex-wrap gap-2">
                {revision.remaster.map((w) => (
                  <a key={w.slug} href={`/vocabulary/${w.slug}/quiz`} className="badge badge-warning px-3 py-1.5 text-xs">
                    {w.word} →
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Progress + goal */}
          <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
            <div className="card flex items-center gap-5 p-5">
              <div className="relative">
                <Ring pct={pct} />
                <span className="absolute inset-0 flex items-center justify-center text-lg font-extrabold">{pct}%</span>
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-extrabold tracking-tight">
                  {masteredCount}
                  <span className="text-base font-semibold text-muted-foreground"> / {totalWords}</span>
                </p>
                <p className="text-sm text-muted-foreground">{tr("words mastered", "words mastered")}</p>
                {plan && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {tr("Today", "Aaj")}: <b className="text-foreground">{plan.masteredToday}</b> / {plan.wordsPerDay} {tr("new words", "naye words")}
                  </p>
                )}
              </div>
            </div>

            <div className="card p-5">
              <h2 className="text-sm font-semibold">🎯 {tr("Daily goal", "Daily goal")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{tr("New words you want to master every day", "Roz kitne naye words master karne hain")}</p>
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={goalDraft}
                  onChange={(e) => setGoalDraft(Number(e.target.value))}
                  className="w-20 border bg-background px-2 py-2 text-sm"
                  aria-label={tr("Words per day", "Roz ke words")}
                />
                <span className="text-sm text-muted-foreground">{tr("words / day", "words / din")}</span>
                <button onClick={saveGoal} disabled={savingGoal} className="btn btn-primary btn-sm ml-auto">
                  {savingGoal ? tr("Saving…", "Save ho raha…") : tr("Save", "Save")}
                </button>
              </div>
            </div>
          </div>

          {/* Today's plan */}
          {plan && (plan.newWordsToday.length > 0 || plan.revisionToday.length > 0) && (
            <div className="card mt-4 border-primary/30 bg-primary/5 p-5">
              <h2 className="text-sm font-semibold">📅 {tr("Today's plan", "Aaj ka plan")}</h2>
              {plan.newWordsToday.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-semibold text-muted-foreground">{tr("New word", "Naya word")}</p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {plan.newWordsToday.map((w) => (
                      <a key={w.slug} href={`/vocabulary/${w.slug}`} className="btn btn-primary btn-sm">
                        {w.word} →
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {plan.revisionToday.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-warning">{tr("🔥 Revise these (some answers were wrong last time)", "🔥 Revise karein (pichli baar kuch galat hue the)")}</p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {plan.revisionToday.map((w) => (
                      <a key={w.slug} href={`/vocabulary/${w.slug}/quiz`} className="badge badge-warning px-3 py-1.5 text-xs">
                        {w.word}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Filters */}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={tr("Filter words", "Words filter")}>
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === t.id}
                  onClick={() => setFilter(t.id)}
                  className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                    filter === t.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {t.label} <span className="ml-0.5 text-xs opacity-70">{t.count}</span>
                </button>
              ))}
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr("Search a word…", "Word dhundhein…")}
              className="ml-auto w-full border bg-background px-3 py-2 text-sm sm:w-56"
              aria-label={tr("Search words", "Words search")}
            />
          </div>

          {/* Word grid */}
          {shown.length === 0 ? (
            <p className="mt-8 text-center text-sm text-muted-foreground">{tr("No words match this view.", "Is view me koi word nahi mila.")}</p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {shown.map((w) => (
                <a
                  key={w.id}
                  href={`/vocabulary/${w.slug}`}
                  className={`card card-hover p-4 ${cardStyle(w)}`}
                  aria-label={w.state === "LOCKED" ? `${tr("Locked word", "Locked word")} #${w.orderIndex}` : w.word}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">#{w.orderIndex}</span>
                    <span className="flex items-center gap-1 text-xs">
                      {w.state === "MASTERED" && <span title={tr("Mastered", "Mastered")}>✅</span>}
                      {w.state === "LOCKED" && <span title={tr("Locked", "Locked")}>🔒</span>}
                      {w.gated && <span title={tr("On hold — finish revision / re-master first. Still unlocked.", "On hold — pehle revision / re-master karein. Word unlocked hi hai.")}>⏸</span>}
                      {w.needsRevision && <span title={tr("Needs revision", "Revision chahiye")}>🔥</span>}
                      {w.needsRemaster && <span title={tr("Score 95%+ again", "95%+ dobara score karein")}>⚠️</span>}
                    </span>
                  </div>
                  <h3 className="mt-1 truncate text-base font-bold">{w.state === "LOCKED" ? "?????" : w.word}</h3>
                  {w.state !== "LOCKED" && <p className="mt-0.5 truncate text-xs text-muted-foreground">{w.meaningHindi}</p>}
                  {w.gated && <p className="mt-1.5 text-[11px] font-semibold text-warning">{tr("On hold · still open", "On hold · khula hua")}</p>}
                  {w.attemptsCount > 0 && <p className="mt-1.5 text-[11px] text-muted-foreground">{tr("Best", "Best")}: {w.bestScorePct}%</p>}
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}

export default function VocabularyHubPage() {
  const { on, loaded } = useFeatures();
  if (loaded && !on("vocabulary")) return <FeatureOff title="Vocabulary is switched off for now" />;
  return <VocabularyHubPageInner />;
}
