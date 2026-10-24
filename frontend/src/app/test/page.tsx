"use client";
import { fetchAuth } from "@/lib/api";
import { saveDraft, loadDraft, clearDraft, queueSubmit, flushPendingSubmits } from "@/lib/offline-submit";
import { Logo } from "@/components/Logo";

import * as React from "react";
import { motion } from "framer-motion";
import { API_BASE } from "@/lib/api";
import DiagramVenn from "@/components/DiagramVenn";
import { StemMedia, QFigure } from "@/components/QuestionMedia";
import { ReportQuestion } from "@/components/ReportQuestion";
import WeakTopicPractice from "@/components/WeakTopicPractice";
import SolutionVerify from "@/components/SolutionVerify";
import { SolutionPanel, ReviewQuestionBody, ReviewLangToggle, useReviewLang } from "@/components/SolutionPanel";
import { useT } from "@/lib/i18n";

type UgQ = {
  id: string;
  questionText: string;
  questionTextHindi?: string | null;
  // Session 22 — Venn/figure diagram support. When questionDiagramType is
  // set, the STEM is a diagram (render it above questionText, which is
  // usually short link text like "उस वेन आरेख का चयन करें..."). When an
  // individual option carries diagramType, THAT option is a diagram
  // instead of a text choice — this is the common case (4 diagram
  // choices). Both are null/absent for ordinary text questions — no
  // change in that case, which is still ~99% of the bank.
  questionDiagramType?: string | null;
  questionDiagramLabels?: (string | null)[] | null;
  // Session 24 — non-Venn diagram stem image (mirror image / figure
  // series / embedded figure / paper folding / dice-clock etc).
  questionImageUrl?: string | null;
  options: { key: string; text: string; textHi?: string | null; diagramType?: string | null; diagramLabels?: (string | null)[] | null; imageUrl?: string | null }[];
  chapter: string;
  // CBT section name (from the mock paper blueprint), used for the section tabs
  section?: string | null;
  questionNo?: number | string | null;
  examName?: string | null;
  year?: number | null;
  shift?: string | null;
  marks?: number;
  negativeMarks?: number;
  correctAnswer?: string | null;
  explanation?: string | null;
  explanationHindi?: string | null;
};

type Attempt = {
  correct: boolean;
  correctAnswer?: string;
  selectedOption: string;
  scoreDelta: number;
  // BUGFIX (Sachin report, Sep 2026 — "solution/explanation results screen
  // pe kabhi nahi dikhta"): server-authoritative tests (year-wise, daily
  // test, full mock template) never send explanation/explanationHindi in
  // the pre-attempt question payload (by design — see yearWiseStart() in
  // tests.service.ts, "correctAnswer/explanation deliberately NOT sent").
  // attemptDetail() DOES return them post-submit, but the submit handler
  // below used to only pull correct/correctAnswer/selectedOption/scoreDelta
  // into this map — explanation was fetched from the server and then
  // silently dropped, never reaching the results screen at all. Carrying
  // it here (alongside q.explanation, which non-exam-mode/practice tests
  // already populate) fixes the review list and lets a real per-question
  // solution panel be shown after submit for every test type.
  explanation?: string | null;
  explanationHindi?: string | null;
  explanationSource?: string | null;
};

// Palette state values
type QStatus =
  | "not-visited"
  | "answered"
  | "not-answered"
  | "marked"
  | "answered-marked";

const STATUS_LABEL: Record<QStatus, string> = {
  "not-visited": "Not Visited",
  answered: "Answered",
  "not-answered": "Not Answered",
  marked: "Marked for Review",
  "answered-marked": "Answered + Marked for Review",
};

function apiBase() {
  return API_BASE;
}

function getAuthHeaders(): { [k: string]: string } {
  try {
    const token =
      typeof window !== "undefined"
        ? localStorage.getItem("ssc_access_token") || ""
        : "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

// ---- Palette colors ----
// Colors follow SSC convention:
// not visited = gray/white, answered = green, not answered = red, marked = purple, answered+marked = purple-green split
const paletteBg: Record<QStatus, string> = {
  "not-visited": "bg-muted text-muted-foreground border-border",
  answered: "bg-success text-success-foreground border-success",
  "not-answered": "bg-danger text-danger-foreground border-danger",
  marked: "bg-accent text-accent-foreground border-accent",
  "answered-marked":
    "bg-success text-success-foreground border-accent ring-2 ring-accent",
};

const legendItems = [
  { s: "not-visited", label: "Not Visited" },
  { s: "answered", label: "Answered" },
  { s: "not-answered", label: "Not Answered" },
  { s: "marked", label: "Marked for Review" },
  { s: "answered-marked", label: "Answered + Marked for Review" },
];

function formatSec(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Paper API sends Hindi options as a separate `optionsHi` list; merge them into the option objects.
function mergeHiOptions(options: any, hi: any): UgQ["options"] {
  const base: UgQ["options"] = Array.isArray(options) ? options : [];
  if (!Array.isArray(hi)) return base;
  return base.map((o) => {
    if (o.textHi) return o;
    const h = hi.find((x: any) => x && String(x.key).toUpperCase() === String(o.key).toUpperCase());
    return h?.text ? { ...o, textHi: h.text } : o;
  });
}

type StatusCounts = { notVisited: number; notAnswered: number; answered: number; marked: number; answeredMarked: number };

// Question palette (shared by the desktop sidebar and the mobile drawer). Plain component, no hooks.
function PaletteBody({
  items,
  idx,
  statusOf,
  counts,
  onJump,
  cols,
}: {
  items: { x: UgQ; i: number }[];
  idx: number;
  statusOf: (qid: string) => QStatus;
  counts: StatusCounts;
  onJump: (i: number) => void;
  cols: string;
}) {
  const legendCounts: Record<QStatus, number> = {
    "not-visited": counts.notVisited,
    answered: counts.answered,
    "not-answered": counts.notAnswered,
    marked: counts.marked,
    "answered-marked": counts.answeredMarked,
  };
  return (
    <>
      <div className={`mt-3 grid gap-1.5 ${cols}`}>
        {items.map(({ x, i }) => {
          const st = statusOf(x.id);
          return (
            <button
              key={x.id}
              onClick={() => onJump(i)}
              aria-label={`Question ${i + 1}: ${STATUS_LABEL[st]}`}
              aria-current={i === idx ? "true" : undefined}
              className={`relative flex h-9 w-full items-center justify-center rounded-md border text-xs font-bold transition ${paletteBg[st]} ${i === idx ? "ring-2 ring-offset-2 ring-offset-background ring-[hsl(var(--ring))]" : ""}`}
            >
              {i + 1}
              {(st === "marked" || st === "answered-marked") && (
                <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-background bg-accent" />
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-1.5 border-t border-border pt-3">
        {legendItems.map((l) => (
          <div key={l.s} className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className={`h-3.5 w-3.5 shrink-0 rounded border ${paletteBg[l.s as QStatus]}`} />
            <span className="min-w-0 flex-1">{l.label}</span>
            <span className="font-bold text-foreground">{legendCounts[l.s as QStatus]}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// Simple ring component for results
function Ring({
  label,
  value,
  pct,
  color,
}: {
  label: string;
  value: string;
  pct: number;
  color: string;
}) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(100, Math.max(0, pct)) / 100);
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-28 w-28">
        <svg width="112" height="112" viewBox="0 0 112 112" className="-rotate-90">
          <circle cx="56" cy="56" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="10" />
          <circle
            cx="56" cy="56" r={r} fill="none" stroke={color} strokeWidth="10"
            strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-extrabold">{value}</span>
        </div>
      </div>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

export default function TestPage() {
  const tr = useT();
  // ---- Outer screen flow ----
  const screenRef = React.useRef<HTMLDivElement>(null);
  const [phase, setPhase] = React.useState<
    "instructions" | "exam" | "results"
  >("instructions");
  const [agreed, setAgreed] = React.useState(false);
  const [zoom, setZoom] = React.useState(100);
  const [fullscreen, setFullscreen] = React.useState(false);

  // ---- Exam data ----
  const [questions, setQuestions] = React.useState<UgQ[]>([]);
  const [idx, setIdx] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  // BUGFIX (Sachin report, Sep 2026 — "test submit karte hain to instant
  // submit nahi hota, 2-3 baar submit karna padta hai tab result show hota
  // hai"): the Submit button had no re-entrancy guard at all. On a slow
  // connection, a tap that feels unresponsive gets tapped again (or the
  // review-screen Submit + this button both fire) while the first
  // submitTest() call is still awaiting /bank/attempt or /tests/.../submit
  // — firing a second, overlapping submitTest() run. The two runs race:
  // whichever Promise.all/fetch resolves last silently overwrites
  // setResult/setFinalScore from the other, and on the server-authoritative
  // path the second POST /submit can even land as "already submitted" and
  // bounce the student to a blank in-place retry. A simple ref-based guard
  // (checked and set synchronously, before any await) makes every submit
  // tap after the first a no-op until the in-flight one finishes.
  const submittingRef = React.useRef(false);
  // UI mirror of submittingRef (disables the Submit buttons + shows the "submitting" overlay)
  const [submitBusy, setSubmitBusy] = React.useState(false);
  // true once we are navigating to /results/[id] — keeps the overlay up (no flash of the exam screen)
  const navigatingRef = React.useRef(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  // Offline-safe submit: true while the final submit is queued on the device waiting for internet.
  const [offlinePending, setOfflinePending] = React.useState(false);
  const [online, setOnline] = React.useState(true);

  // Current user id — needed only for the report/chat feature (ReportQuestion
  // component below needs to know "am I the sender of this message" so it
  // can align chat bubbles left/right). Fetched once and cached in state;
  // not used for anything auth-critical (that's all handled server-side via
  // the JWT on every request), just UI presentation.
  const [currentUserId, setCurrentUserId] = React.useState<string>("");
  React.useEffect(() => {
    fetchAuth(`${API_BASE}/users/me`)
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => { if (me?.id) setCurrentUserId(me.id); })
      .catch(() => {});
  }, []);

  // student answers + status
  const [answers, setAnswers] = React.useState<{ [qid: string]: string }>({});
  const [attemptId, setAttemptId] = React.useState<string | null>(null);
  // NEW (Sep 21 2026) — id of a Question-Bank-Practice set (topic/sub-topic
  // practice), so submitTest() can mark it complete once scored (see
  // completePracticeSetIfAny() below). Chapter-wise PYQ / default /bank/set
  // never set this — only the bank/practice/start flow's response shape
  // (has `id` + `mode`) matches.
  const practiceSetIdRef = React.useRef<string | null>(null);
  const [status, setStatus] = React.useState<{ [qid: string]: QStatus }>({});
  const [visited, setVisited] = React.useState<{ [qid: string]: boolean }>({});
  const [timeLeft, setTimeLeft] = React.useState(0);
  const [running, setRunning] = React.useState(false);

  // results
  const [result, setResult] = React.useState<{ [qid: string]: Attempt }>({});
  // BUGFIX (Sachin report, Sep 2026 — solutions results screen pe nahi
  // dikhta): `result` only ever gets an entry for ANSWERED questions (see
  // `if (!q.selectedOption) continue` in submitTest below) — a skipped
  // question has no `result[qid]`, so it can never carry an explanation
  // either, even though attemptDetail() returns explanation/correctAnswer
  // for every question regardless of whether it was answered. This
  // separate map is populated for ALL questions (answered + skipped) so
  // the results review list and per-question solution panel work no
  // matter what the student did with that question.
  const [explanations, setExplanations] = React.useState<{
    [qid: string]: { correctAnswer: string; explanation: string | null; explanationHindi: string | null; explanationSource: string | null };
  }>({});
  const [finalScore, setFinalScore] = React.useState(0);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  // v7 §1.1 — results-screen state MUST live at component top level
  // (hooks inside the `phase === "results"` branch changed hook count on
  // submit → React #310 "rendered more hooks" → the submit crash).
  const [reviewTab, setReviewTab] = React.useState<"all" | "wrong" | "skipped" | "correct">("all");
  const [navQ, setNavQ] = React.useState<number | null>(null); // navigator selection
  // Per-question "View Solution" expand/collapse on the results review list.
  const [solOpen, setSolOpen] = React.useState<{ [qid: string]: boolean }>({});
  // review language (English / Hindi / both) — remembered on the device
  const [revLang, setRevLang] = useReviewLang();

  const [paused, setPaused] = React.useState(false);

  // ---- Pre-start metadata (BUGFIX: instructions screen used to show a
  // hardcoded "SSC CGL Tier I" title + fake "5 minutes / 10 Questions"
  // for EVERY entry point — daily test, every mock template, chapter
  // practice — because real numbers only existed after clicking Start.
  // Now we fetch the real template/daily-test info up front so the
  // screen matches what was actually clicked on /mocks. ----
  const [preMeta, setPreMeta] = React.useState<{
    title: string;
    durationMinutes: number;
    totalQuestions: number;
    totalMarks: number;
  } | null>(null);
  // If the Daily Test is locked (no study plan yet, or already taken today),
  // we show that inline instead of a generic instructions form that would
  // just fail with a browser alert() once "Start Test" was clicked.
  const [dailyGate, setDailyGate] = React.useState<string | null>(null);

  // practice-mode aids (v6 §5: Show Answer + AI Hint, hint capped at 3/session)
  const [showAns, setShowAns] = React.useState<{ [qid: string]: boolean }>({});
  // BUGFIX (Sachin report, Sep 2026): "Show Answer" used to render ONLY
  // q.explanation — for any question whose explanation was never
  // pre-generated (a large chunk of the bank imported via old
  // parse_*/upload_*.py scripts) that's null, so only "Correct Answer: X"
  // showed with no explanation at all. Backend already has an on-demand
  // AI-generate-and-cache endpoint (ai-explanation/questions/:id, same one
  // /review already uses) — now called here too when the stored
  // explanation is missing, keyed per question like showAns/hintUsed above.
  const [aiExp, setAiExp] = React.useState<{
    [qid: string]: { loading?: boolean; error?: string | null; data?: { stepByStepSolution: string; stepByStepSolutionHindi?: string; source?: string } };
  }>({});
  const fetchAiExplanation = async (qid: string) => {
    setAiExp((p) => ({ ...p, [qid]: { ...p[qid], loading: true, error: null } }));
    try {
      const res = await fetch(`${apiBase()}/ai-explanation/questions/${qid}`, { headers: getAuthHeaders() });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setAiExp((p) => ({ ...p, [qid]: { loading: false, data: d } }));
      else setAiExp((p) => ({ ...p, [qid]: { loading: false, error: d.message || tr("An explanation is not available yet.", "Explanation abhi available nahi hai.") } }));
    } catch {
      setAiExp((p) => ({ ...p, [qid]: { loading: false, error: tr("Network error — could not load the explanation.", "Network error — explanation load nahi ho payi.") } }));
    }
  };
  const [hintUsed, setHintUsed] = React.useState<{ [qid: string]: boolean }>({});
  const [hintQuota, setHintQuota] = React.useState(3);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  // FIX (exam-integrity bug): "Show Answer" / "AI Hint" were rendering on
  // EVERY test — including server-authoritative timed exams (sectional,
  // year-wise, full mock) — which let a student see the correct answer
  // mid-attempt and defeats the entire point of a mock test. This flag is
  // set to true only when a real server attempt (ssc_active_attempt) is
  // active, and both aids are hidden in that case. Untimed question-bank /
  // chapter practice still gets the aids as before.
  const [isExamMode, setIsExamMode] = React.useState(false);

  // ---- Load real title/duration/marks for the instructions screen before
  // the user ever clicks Start (BUGFIX — see preMeta/dailyGate above) ----
  React.useEffect(() => {
    (async () => {
      try {
        if (typeof window === "undefined") return;
        const sp = new URLSearchParams(window.location.search);
        const isDaily = sp.get("daily") === "1";
        const tplId = sp.get("template");
        const chapId = sp.get("chapter");

        // NEW (Sep 29 2026): /test?plantest=<id> — the 9 AM Study-Plan test.
        const planTestParam = sp.get("plantest");
        if (planTestParam) {
          const r = await fetchAuth(`${apiBase()}/study-plan/test/upcoming`, { headers: getAuthHeaders() });
          const d = await r.json().catch(() => ({}));
          const t = d?.test;
          if (!r.ok || !t || t.id !== planTestParam) {
            setDailyGate(tr("This test is no longer available.", "Ye test ab available nahi hai."));
            return;
          }
          if (!t.canStart) {
            setDailyGate(`${t.message?.en || "Test opens at 9:00 AM."}\n${t.message?.hi || ""}`);
            return;
          }
          setPreMeta({
            title: `Study Plan Test — ${t.examName || "Your Exam"}`,
            durationMinutes: t.pattern?.durationMinutes || 60,
            totalQuestions: t.pattern?.totalQuestions || 100,
            totalMarks: t.pattern?.totalMarks || 200,
          });
          return;
        }

        if (isDaily) {
          const r = await fetchAuth(`${apiBase()}/tests/daily-test/status`, {
            headers: getAuthHeaders(),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) return;
          if (!d?.hasPlan) {
            setDailyGate(d?.message || "Create a study plan on the dashboard to unlock your Daily Test.");
            return;
          }
          if (d?.takenToday) {
            setDailyGate(tr("You have already taken today's Daily Test — try again tomorrow.", "Aapka aaj ka Daily Test ho chuka hai — kal dobara try karo."));
            return;
          }
          const q = d?.dailyTarget || 10;
          setPreMeta({
            title: `Daily Test — ${d?.examName || "Your Study Plan"}`,
            durationMinutes: Math.max(5, Math.round(q * 1.2)),
            totalQuestions: q,
            totalMarks: q * 2,
          });
          return;
        }

        if (tplId) {
          const r = await fetchAuth(`${apiBase()}/tests`, { headers: getAuthHeaders() });
          const list = await r.json().catch(() => []);
          const tpl = Array.isArray(list) ? list.find((t: any) => t.id === tplId) : null;
          if (tpl) {
            setPreMeta({
              title: tpl.title || "Mock Test",
              durationMinutes: tpl.durationMinutes || 60,
              totalQuestions: tpl.totalQuestions || 25,
              totalMarks: tpl.totalMarks || tpl.totalQuestions || 25,
            });
          }
          return;
        }

        // Sectional / Question-Bank-Practice / "retry wrong" sets are stashed in sessionStorage by the page
        // that launched this one — show their real size instead of the generic fallback numbers.
        try {
          const raw = sessionStorage.getItem("ssc_sectional_set");
          if (raw) {
            const sd = JSON.parse(raw);
            const sq: any[] = Array.isArray(sd?.questions) ? sd.questions : [];
            if (sq.length > 0) {
              setPreMeta({
                title: sd?.title || "Practice Test",
                durationMinutes: Math.max(1, Math.round(sq.length * 0.5)),
                totalQuestions: sq.length,
                totalMarks: sq.reduce((a: number, x: any) => a + (x?.marks ?? 1), 0) || sq.length,
              });
              return;
            }
          }
        } catch {
          /* ignore — fall through to the generic numbers */
        }

        if (chapId) {
          setPreMeta({ title: "Chapter-wise Practice", durationMinutes: 15, totalQuestions: 25, totalMarks: 25 });
          return;
        }

        setPreMeta({ title: "Practice Test", durationMinutes: 5, totalQuestions: 10, totalMarks: 10 });
      } catch {
        /* keep generic fallback below if this fails */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- per-question pacing (v6 §6: avg time/question, rushing/balanced/slow) ----
  const [qEnterRef] = React.useState<{ qid: string; at: number }>({ qid: "", at: 0 });
  const [timeSpent, setTimeSpent] = React.useState<{ [qid: string]: number }>({});
  React.useEffect(() => {
    if (phase !== "exam" || !questions[idx]) return;
    qEnterRef.qid = questions[idx].id;
    qEnterRef.at = Date.now();
  }, [idx, phase, questions, qEnterRef]);
  const markQuestionTime = (qid: string) => {
    if (qEnterRef.qid === qid && qEnterRef.at > 0) {
      const spent = Math.round((Date.now() - qEnterRef.at) / 1000);
      setTimeSpent((p) => ({ ...p, [qid]: (p[qid] || 0) + Math.max(spent, 0) }));
      qEnterRef.at = Date.now();
    }
  };

  const startClock = React.useCallback((total: number) => {
    setTimeLeft(total);
    setRunning(true);
  }, []);

  // ---- Load a set when the user clicks Start ----
  const startTest = async () => {
    setStarting(true);
    setLoading(true);
    try {
      // v3 §6.4 — Daily Test (Live mode): /test?daily=1 → server composes the
      // plan-based paper, snapshots it and opens a server-authoritative timed attempt
      const isDaily = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("daily") === "1" : false;
      const planTestId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("plantest") : null;
      let qs: UgQ[] = [];
      let durationSec = 0;
      let attemptId: string | null = null;
      if (planTestId) {
        const pr = await fetchAuth(`${apiBase()}/study-plan/test/${encodeURIComponent(planTestId)}/start`, {
          method: "POST",
          headers: getAuthHeaders(),
        });
        const pd = await pr.json().catch(() => ({}));
        if (!pr.ok) {
          alert(`⚠️ ${pd?.messages ? `${pd.messages.en}\n${pd.messages.hi}` : pd?.message || tr("Could not start the Study Plan Test.", "Study Plan Test start nahi hua.")}`);
          setLoading(false);
          setStarting(false);
          return;
        }
        qs = Array.isArray(pd?.questions) ? pd.questions : [];
        durationSec = pd?.durationSec || 0;
        attemptId = pd?.attemptId ?? null;
        setAttemptId(attemptId);
        if (attemptId) { sessionStorage.setItem("ssc_active_attempt", attemptId); setIsExamMode(true); }
      }
      if (isDaily) {
        const dr = await fetchAuth(`${apiBase()}/tests/daily-test/start`, {
          method: "POST",
          headers: getAuthHeaders(),
        });
        const dd = await dr.json().catch(() => ({}));
        if (!dr.ok) {
          alert(`⚠️ ${dd?.message || "Daily Test unavailable — create a study plan first."}`);
          setLoading(false);
          setStarting(false);
          return;
        }
        qs = Array.isArray(dd?.questions) ? dd.questions : [];
        durationSec = dd?.durationSec || 0;
        attemptId = dd?.attemptId ?? null;
        setAttemptId(attemptId);
        if (attemptId) { sessionStorage.setItem("ssc_active_attempt", attemptId); setIsExamMode(true); }
      }
      // Session 18+ — year-wise custom test: /test?yearwise=1, config stashed
      // by /year-wise page. Server composes the exam+year(+subject/chapter/
      // topic-narrowed or full) paper AND opens a server-authoritative timed
      // attempt in one call — same shape as the isDaily branch above.
      const isYearWise =
        typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("yearwise") === "1" : false;
      if (isYearWise && qs.length === 0) {
        const cfgRaw = typeof window !== "undefined" ? sessionStorage.getItem("ssc_yearwise_config") : null;
        const cfg = cfgRaw ? JSON.parse(cfgRaw) : null;
        if (!cfg) {
          alert("⚠️ Year-wise test setup expired — please choose again.");
          setLoading(false);
          setStarting(false);
          window.location.href = "/year-wise";
          return;
        }
        const yr = await fetchAuth(`${apiBase()}/tests/year-wise/start`, {
          method: "POST",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(cfg),
        });
        const yd = await yr.json().catch(() => ({}));
        if (!yr.ok) {
          alert(`⚠️ ${yd?.message || "Could not compose this year-wise test."}`);
          setLoading(false);
          setStarting(false);
          return;
        }
        sessionStorage.removeItem("ssc_yearwise_config");
        qs = Array.isArray(yd?.questions) ? yd.questions : [];
        durationSec = (yd?.durationMinutes || 60) * 60;
        attemptId = yd?.attemptId ?? null;
        setAttemptId(attemptId);
        if (attemptId) { sessionStorage.setItem("ssc_active_attempt", attemptId); setIsExamMode(true); }
      }
      // v6 §2a — full shift paper: /test?template=<id> composes the template's paper
      // server-side (real exam blueprint, no answer key) + opens a server-authoritative
      // timed attempt.
      const tplId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("template") : null;
      if (tplId) {
        const pr = await fetchAuth(`${apiBase()}/tests/paper/${encodeURIComponent(tplId)}`, {
          headers: getAuthHeaders(),
        });
        if (!pr.ok) {
          const err = await pr.json().catch(() => ({}));
          alert(`⚠️ ${err?.message || "Could not load this mock."}`);
          setLoading(false);
          setStarting(false);
          return;
        }
        const paper = await pr.json();
        qs = Array.isArray(paper?.sections)
          ? paper.sections.flatMap((s: any) =>
              (s.questions || []).map((qq: any) => ({
                id: qq.id,
                section: s.name || null,
                questionNo: qq.questionNo ?? null,
                questionText: qq.questionText,
                questionTextHindi: qq.questionTextHindi,
                questionDiagramType: qq.questionDiagramType,
                questionDiagramLabels: qq.questionDiagramLabels,
                questionImageUrl: qq.questionImageUrl,
                options: mergeHiOptions(qq.options, qq.optionsHi),
                chapter: qq.chapter || "",
                examName: qq.examName,
                year: qq.year,
                shift: qq.shift,
                marks: qq.marks,
                negativeMarks: qq.negativeMarks,
                explanation: qq.explanation,
                explanationHindi: qq.explanationHindi,
              })),
            )
          : [];
        durationSec = (paper?.durationMinutes || 60) * 60;
        // server-authoritative timed attempt
        try {
          const ar = await fetchAuth(`${apiBase()}/tests/attempts/start`, {
            method: "POST",
            headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ testTemplateId: tplId }),
          });
          const ad = await ar.json();
          attemptId = ad.id ?? null;
          setAttemptId(attemptId);
          if (attemptId) { sessionStorage.setItem("ssc_active_attempt", attemptId); setIsExamMode(true); }
          // v4 §31 — resumed attempt (refresh/revisit): hydrate persisted autosaves
          {
            const savedMap: { [qid: string]: string } = {};
            if (Array.isArray(ad.answers)) for (const a of ad.answers) if (a.selectedOption) savedMap[a.questionId] = a.selectedOption;
            // answers mirrored on this device (written even while offline) are newer than the server autosave
            const draft = attemptId ? loadDraft(attemptId) : null;
            if (draft) Object.assign(savedMap, draft.answers);
            if (Object.keys(savedMap).length > 0) {
            setAnswers(savedMap);
            setStatus((p) => {
              const n = { ...p };
              for (const qid of Object.keys(savedMap)) n[qid] = "answered";
              return n;
            });
            }
          }
        } catch {
          attemptId = null;
        }
      }
      // v6 §2c — sectional test: composed set stashed by /sectional page
      if (qs.length === 0) {
        const sectionalRaw = sessionStorage.getItem("ssc_sectional_set");
        if (sectionalRaw) {
          const d = JSON.parse(sectionalRaw);
          qs = Array.isArray(d?.questions) ? d.questions : [];
          // A Question-Bank-Practice set (started from /question-bank-practice)
          // has `id` + `mode` on its root object; a /sectional or /year-wise
          // composed set does not — this is how we tell them apart without a
          // second sessionStorage key.
          if (d?.id && d?.mode) practiceSetIdRef.current = d.id;
          sessionStorage.removeItem("ssc_sectional_set");
        }
      }
      // v5 §36 — chapter-wise PYQ practice: /test?chapter=<id>&exam=<id>
      if (qs.length === 0) {
        const chapId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("chapter") : null;
        if (chapId) {
          const qp = new URLSearchParams({ take: "25" });
          const eid = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("exam") : null;
          if (eid) qp.append("examId", eid);
          const cr = await fetchAuth(`${apiBase()}/bank/chapters/${encodeURIComponent(chapId)}/pyq?${qp}`, {
            headers: getAuthHeaders(),
          });
          const cd = await cr.json();
          qs = Array.isArray(cd?.questions) ? cd.questions : Array.isArray(cd) ? cd : [];
        }
      }
      if (qs.length === 0) {
        // Default: random bilingual set from the approved bank
        const r = await fetchAuth(`${apiBase()}/bank/set?count=10`, {
          headers: getAuthHeaders(),
        });
        const d = await r.json();
        qs = Array.isArray(d?.questions) ? d.questions : [];
      }
      setQuestions(qs);
      if (qs.length === 0) {
        alert("⚠️ No approved questions available yet. Try later.");
        setLoading(false);
        setStarting(false);
        return;
      }
      setIdx(0);
      setAnswers({});
      setStatus({});
      setVisited({ [qs[0].id]: true });
      // server-authoritative style: compute end from now + duration
      const durationSecFinal = durationSec > 0 ? durationSec : Math.max(60, qs.length * 30); // ~30s/question, min 1 min
      startClock(durationSecFinal);
      setPhase("exam");
    } catch (e) {
      console.error(e);
      alert("⚠️ Could not load questions. Is the backend running on :4000?");
    } finally {
      setLoading(false);
      setStarting(false);
    }
  };

  // ---- Countdown (server-style: derived from initial, client displays) ----
  React.useEffect(() => {
    if (!running || phase !== "exam" || paused) return;
    if (timeLeft <= 0) {
      setRunning(false);
      submitTest(); // auto-submit at 0
      return;
    }
    const t = window.setTimeout(() => setTimeLeft((p) => p - 1), 1000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, timeLeft, phase, paused]);

  const markVisited = (i: number, qid: string) => {
    setVisited((p) => ({ ...p, [qid]: true }));
    if (questions[idx]) markQuestionTime(questions[idx].id);
    setIdx(i);
    setStatus((p) => ({
      ...p,
      [qid]: p[qid] ?? "not-answered",
    }));
  };

  const chooseOption = (qid: string, key: string) => {
    setAnswers((p) => ({ ...p, [qid]: key }));
    setVisited((p) => ({ ...p, [qid]: true }));
    const wasMarked = status[qid] === "marked" || status[qid] === "answered-marked";
    setStatus((p) => ({
      ...p,
      [qid]: wasMarked ? "answered-marked" : "answered",
    }));
  };

  // ---- Offline-safe: mirror answers on the device immediately (no debounce, no network) ----
  React.useEffect(() => {
    if (!attemptId || phase !== "exam") return;
    saveDraft(attemptId, answers, timeSpent);
  }, [answers, timeSpent, attemptId, phase]);

  // ---- Offline-safe: track connectivity; replay a queued submit as soon as the network is back ----
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const retryQueuedSubmit = React.useCallback(async () => {
    const id = typeof window !== "undefined" ? sessionStorage.getItem("ssc_active_attempt") : null;
    const done = await flushPendingSubmits();
    if (id && done.includes(id)) {
      sessionStorage.removeItem("ssc_active_attempt");
      window.location.href = `/results/${id}`;
    }
  }, []);

  React.useEffect(() => {
    if (!offlinePending) return;
    if (online) retryQueuedSubmit();
    const t = window.setInterval(retryQueuedSubmit, 8000);
    return () => window.clearInterval(t);
  }, [offlinePending, online, retryQueuedSubmit]);

  // ---- v4 §31 — AUTOSAVE: debounced persist of answers mid-attempt. What's
  // saved here is exactly what an auto-submit-at-expiry scores (lossless). ----
  const autosaveTimer = React.useRef<any>(null);
  React.useEffect(() => {
    if (!attemptId || phase !== "exam" || Object.keys(answers).length === 0) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      try {
        const payload = Object.entries(answers).map(([questionId, selectedOption]) => ({
          questionId,
          selectedOption,
        }));
        await fetchAuth(`${apiBase()}/tests/attempts/${attemptId}/answers`, {
          method: "PUT",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ answers: payload }),
        });
      } catch {
        /* autosave is best-effort — the submit payload is authoritative */
      }
    }, 2500);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [answers, attemptId, phase]);

  // ---- keyboard shortcuts (real CBT feel) ----
  // A-D / Alt+1-4 choose · Space or → save & next · ← / Shift+Space previous · M mark & next · C clear · P palette · ? help
  React.useEffect(() => {
    if (phase !== "exam" || paused || reviewOpen || offlinePending) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      const q = questions[idx];
      if (e.altKey && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        if (q) chooseOption(q.id, String.fromCharCode(64 + Number(e.key)));
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === " " && !e.shiftKey) {
        e.preventDefault();
        saveAndNext();
        return;
      }
      if ((e.key === " " && e.shiftKey) || e.key === "ArrowLeft") {
        e.preventDefault();
        if (idx > 0) markVisited(idx - 1, questions[idx - 1].id);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (idx < questions.length - 1) markVisited(idx + 1, questions[idx + 1].id);
        return;
      }
      const k = e.key.toLowerCase();
      if (q && ["a", "b", "c", "d"].includes(k) && q.options.some((o) => (o.key || "").toUpperCase() === k.toUpperCase())) {
        chooseOption(q.id, k.toUpperCase());
        return;
      }
      if (k === "m") { markAndNext(); return; }
      if (k === "c") { clearAnswer(); return; }
      if (k === "p") { setPaletteOpen((p) => !p); return; }
      if (e.key === "?") { setHelpOpen((p) => !p); return; }
      if (e.key === "Escape") { setPaletteOpen(false); setHelpOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paused, reviewOpen, offlinePending, idx, questions, answers, status]);

  // Status of one question for the palette (derived — never stale vs answers/visited).
  const statusOf = (qid: string): QStatus => status[qid] ?? (visited[qid] ? "not-answered" : "not-visited");

  const goNext = () => {
    if (idx < questions.length - 1) markVisited(idx + 1, questions[idx + 1].id);
    else setReviewOpen(true);
  };

  // Toggle the review flag on the current question (keeps the answer).
  const markForReview = () => {
    const q = questions[idx];
    if (!q) return;
    setStatus((p) => {
      const isMarked = p[q.id] === "marked" || p[q.id] === "answered-marked";
      const has = !!answers[q.id];
      return { ...p, [q.id]: isMarked ? (has ? "answered" : "not-answered") : has ? "answered-marked" : "marked" };
    });
  };

  // "Mark for Review & Next" (SSC CBT button): flag it for review and move on.
  const markAndNext = () => {
    const q = questions[idx];
    if (!q) return;
    setVisited((p) => ({ ...p, [q.id]: true }));
    setStatus((p) => ({ ...p, [q.id]: answers[q.id] ? "answered-marked" : "marked" }));
    goNext();
  };

  const clearAnswer = () => {
    const q = questions[idx];
    if (!q) return;
    setAnswers((p) => {
      const n = { ...p };
      delete n[q.id];
      return n;
    });
    setStatus((p) =>
      p[q.id] === "answered" || p[q.id] === "answered-marked"
        ? { ...p, [q.id]: p[q.id] === "answered-marked" ? "marked" : "not-answered" }
        : p,
    );
  };

  // "Save & Next": BUGFIX — a question with NO answer used to turn green ("answered") here. It now only counts as
  // answered when an option is actually selected; otherwise it stays "not answered" (or "marked" if flagged).
  const saveAndNext = () => {
    const q = questions[idx];
    if (q) {
      setVisited((p) => ({ ...p, [q.id]: true }));
      setStatus((p) => {
        const cur = p[q.id];
        if (answers[q.id]) return { ...p, [q.id]: cur === "answered-marked" || cur === "marked" ? "answered-marked" : "answered" };
        if (cur === "marked") return p;
        return { ...p, [q.id]: "not-answered" };
      });
    }
    goNext();
  };

  // Practice results → "retry the questions I got wrong" (optionally + skipped), as a fresh practice set.
  const retryWrong = (includeSkipped: boolean) => {
    const pick = questions.filter((q) => (includeSkipped ? !result[q.id]?.correct : !!result[q.id] && !result[q.id].correct));
    if (pick.length === 0) return;
    try {
      sessionStorage.setItem(
        "ssc_sectional_set",
        JSON.stringify({ title: includeSkipped ? "Retry — wrong + skipped" : "Retry — wrong answers", questions: pick.map((q) => ({ ...q, section: null })) }),
      );
      window.location.href = "/test";
    } catch {
      /* storage blocked — ignore */
    }
  };

  // ---- Submit ----
  const submitTest = async () => {
    // Re-entrancy guard — see submittingRef doc-comment above. Checked and
    // set synchronously (no await before this line) so two rapid taps can
    // never both pass the check.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitBusy(true);
    try {
    const qs = questions;
    setRunning(false);
    setReviewOpen(false);
    if (qs[idx]) markQuestionTime(qs[idx].id); // finalize last question's time before scoring

    const activeAttempt =
      typeof window !== "undefined" ? sessionStorage.getItem("ssc_active_attempt") : null;

    // ---- Server-authoritative path: mocks, Daily Test, year-wise (any flow
    // that opened a real timed TestAttempt via /tests/attempts/start,
    // /tests/daily-test/start, or /tests/year-wise/start). BUGFIX (see full
    // explanation above submitTest): submit to the real attempt, then pull
    // the server-scored per-question detail — never call /bank/attempt here.
    if (activeAttempt) {
      const clientSubmittedAt = Date.now(); // the moment the student actually finished (server uses it for offline replays)
      let stayInExam = false; // true => submit did not reach the server: keep the student on the exam screen, NOT results
      try {
        const answersPayload = qs.map((q) => ({
          questionId: q.id,
          selectedOption: answers[q.id] ?? null,
          timeSpentSeconds: timeSpent[q.id] || 0,
        }));
        // BUGFIX (Sachin report, Sep 2026 — "test submit nahi ho raha /
        // results screen har question pe 'Answer not available' dikhata
        // he"): this call's response was never checked. A failed submit
        // (network hiccup, or the server erroring on an oversized/invalid
        // attempt) used to fall straight through as if it had succeeded —
        // the code below would clear ssc_active_attempt, then fetch
        // attemptDetail() for an attempt that was STILL 'IN_PROGRESS' and
        // had little/no persisted AttemptAnswer data, rendering a results
        // screen where every question looked skipped with no correct
        // answer to show. Now: check .ok, and on failure, leave the
        // attempt token in place and let the student retry Submit instead
        // of silently showing a broken/empty results screen.
        let sr: Response;
        try {
          sr = await fetchAuth(`${apiBase()}/tests/attempts/${activeAttempt}/submit`, {
            method: "POST",
            headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ answers: answersPayload, clientSubmittedAt }),
          });
        } catch {
          // Internet is down: the test is NOT lost. Queue the final submit on the device; it is sent automatically
          // when the network returns (even after closing the app) and the real result is shown then.
          queueSubmit({ attemptId: activeAttempt, answers: answersPayload, clientSubmittedAt });
          stayInExam = true;
          setOfflinePending(true);
          setStarting(false);
          setLoading(false);
          return;
        }
        if (!sr.ok) {
          const errBody = await sr.json().catch(() => ({}));
          // "Attempt already submitted" means an earlier tap actually DID
          // go through server-side (e.g. the response was just slow/lost
          // in transit) — that's not a real failure, so fall through to
          // fetch the already-scored detail below instead of blocking the
          // student from ever seeing their result.
          const alreadySubmitted = /already submitted/i.test(errBody?.message || "");
          if (!alreadySubmitted) {
            alert(
              `⚠️ ${errBody?.message || "Could not submit your test — please check your connection."} Your answers are safe (auto-saved) — tap Submit again to retry.`,
            );
            // server error (5xx) / gateway down: same safety net as offline — queue it and keep retrying
            if (sr.status >= 500 || sr.status === 0) {
              queueSubmit({ attemptId: activeAttempt, answers: answersPayload, clientSubmittedAt });
              stayInExam = true;
              setOfflinePending(true);
              setStarting(false);
              setLoading(false);
              return;
            }
            stayInExam = true;
            setRunning(true); // resume the clock — nothing was lost, let them retry
            setStarting(false);
            setLoading(false);
            return; // stop here — never clear ssc_active_attempt or show results on a failed submit
          }
        }
        sessionStorage.removeItem("ssc_active_attempt");
        clearDraft(activeAttempt);

        // The server has scored the attempt. /results/[attemptId] is the single full-analytics screen
        // (rank, percentile, topper compare, subject/chapter charts, time analysis, wrong-only retry),
        // so go there directly instead of rendering a second, thinner copy here.
        navigatingRef.current = true;
        stayInExam = true; // skip the in-place results phase in `finally`
        window.location.href = `/results/${activeAttempt}`;
        return;
      } catch {
        // BUGFIX: this used to silently swallow ANY exception in the block
        // above (including a genuine network failure on the submit POST
        // itself) and still fall through to `finally { setPhase("results") }`
        // — showing a blank/broken results screen while leaving the student
        // uncertain whether their test was even recorded. If we got far
        // enough to clear ssc_active_attempt, the submit call itself did
        // go through (only the detail fetch/parse afterward is what can
        // throw here) — the safest recovery is the dedicated
        // /results/[attemptId] page, which fetches its own data.
        if (typeof window !== "undefined" && sessionStorage.getItem("ssc_active_attempt") === null) {
          window.location.href = `/results/${activeAttempt}`;
          return;
        }
      } finally {
        if (!stayInExam) setPhase("results");
      }
      return;
    }

    // ---- Non-authoritative practice path: sectional set (stashed by
    // /sectional), chapter-wise PYQ, or the default random /bank/set — none
    // of these open a server TestAttempt up front, so /bank/attempt is the
    // legitimate per-question scoring + recording mechanism here.
    let score = 0;
    const res: { [qid: string]: Attempt } = {};
    // FIX (slow-submit bug): this used to `await` /bank/attempt ONE
    // QUESTION AT A TIME inside a for-loop — for a 100-question full mock
    // that's 100 sequential network round trips before the results screen
    // could render (5-10+ seconds of visible hang). Firing all requests
    // together with Promise.all cuts this to the time of the single
    // slowest request, typically <1s.
    const answeredQs = qs.filter((q) => !!answers[q.id]);
    await Promise.all(
      answeredQs.map(async (q) => {
        const ans = answers[q.id];
        try {
          const r = await fetchAuth(`${apiBase()}/bank/attempt`, {
            method: "POST",
            headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({
              questionId: q.id,
              selectedOption: ans,
              templateId: "tpl-mock-live",
              // BUGFIX: the aggregate POST /tests/attempts below already
              // records this whole practice session as one real TestAttempt
              // once submission finishes — record: false stops this
              // per-question call from ALSO creating its own single-question
              // TestAttempt, which used to duplicate/pollute every
              // un-templated analytics query (myAttempts, getWeakChapters,
              // getStrengthChapters, getSubjectWiseAnalytics,
              // getAccuracyTrend) for every sectional/chapter-wise/random-set
              // practice test taken. question-bank/page.tsx's standalone
              // instant-feedback browser is unaffected — it never sends this
              // flag, so it keeps recording each answer as its own attempt
              // (its intended, only recording mechanism).
              record: false,
            }),
          });
          const d = await r.json();
          // normalize both sides before comparing/storing — some legacy
          // rows have correctAnswer with stray whitespace/case, which used
          // to silently fail the o.key === correctAnswer match later and
          // show a dead "(see solution)" placeholder instead of the answer.
          const normalizedCorrect = String(d.correctAnswer ?? "").trim().toUpperCase();
          // BUGFIX (Sachin report, Sep 2026 — "practice questions aa rahe
          // hain, solution/badi wali explanation nahi aati"): bank.service.ts's
          // attempt() has always returned explanation/explanationHindi in
          // its response (d.explanation / d.explanationHindi below), but this
          // was the one path in this file that never read it off the
          // response — every OTHER path (authoritative attemptDetail(),
          // chapter-wise-PYQ's ungated q.explanation) carried it through.
          // Question-Bank-Practice / Sectional / random-set /bank/set all
          // route through here, and Question-Bank-Practice's questions start
          // with q.explanation deliberately blank (no answer-key leak before
          // answering — see getOrCreateSet()/formatSet() in
          // question-bank-practice.service.ts), so the results screen's
          // fallback chain (`ex?.explanation ?? q.explanation`) had nothing
          // left to fall back to and "View Solution" showed nothing for
          // every practice-mode question, however detailed the uploaded
          // Excel's explanation column was.
          const a: Attempt = {
            correct: !!d.correct,
            correctAnswer: normalizedCorrect,
            selectedOption: ans,
            scoreDelta: Number(d.scoreDelta || 0),
            explanation: d.explanation ?? null,
            explanationHindi: d.explanationHindi ?? null,
          };
          res[q.id] = a;
          score += a.scoreDelta; // server-side: correct→+marks, wrong→−negativeMarks
        } catch {
          // if scoring endpoint fails mid-test, keep going for other Qs
        }
      }),
    );
    setResult(res);
    setFinalScore(score);
    setPhase("results");

    // NEW (Sep 21 2026) — mark the Question-Bank-Practice set complete so its
    // free-set counter and progress actually advance (previously this never
    // happened, so the SAME set was handed back on every Start and Progress
    // stayed at 0 forever). Best-effort: results are already shown either way.
    if (practiceSetIdRef.current) {
      const answersForComplete: Record<string, string> = {};
      for (const q of qs) answersForComplete[q.id] = answers[q.id] || "SKIPPED";
      fetchAuth(`${apiBase()}/bank/practice/set/${practiceSetIdRef.current}/complete`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ answers: answersForComplete }),
      }).catch(() => {
        // best-effort — the student's score/results are already shown from
        // the /bank/attempt scoring above regardless of this call's outcome
      });
    }

    // P1 — best-effort save to results history (never blocks results view)
    try {
      let correct = 0;
      let wrong = 0;
      let skipped = 0;
      const answersPayload = [];
      for (const q of qs) {
        const a = res[q.id];
        if (!a) { skipped++; continue; }
        if (a.correct) correct++;
        else wrong++;
        answersPayload.push({
          questionId: q.id,
          selectedOption: a.selectedOption,
          isCorrect: a.correct,
          timeSpentSeconds: timeSpent[q.id] || 0,
        });
      }
      const total = qs.length;
      const acc = total ? Math.round(((correct + 0) / total) * 100) : 0;
      await fetchAuth(`${apiBase()}/tests/attempts`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          testTemplateId: "tpl-mock-live",
          score,
          totalCorrect: correct,
          totalWrong: wrong,
          totalSkipped: skipped,
          accuracyPercent: acc,
          answers: answersPayload,
          // practice sets are scored by /bank/practice/set/:id/complete (weak topics are updated there)
          practiceSetId: practiceSetIdRef.current || undefined,
        }),
      });
    } catch {
      // history save is best-effort — ignore failures
    }
    } finally {
      // Always release the guard, however this run exited (early return on
      // a failed authoritative submit, an exception, or normal completion)
      // — otherwise a genuine failure would permanently lock out Submit.
      submittingRef.current = false;
      if (!navigatingRef.current) setSubmitBusy(false);
    }
  };

  const togglePause = () => {
    // Practice tests allow pause; full mocks would gate this per config.
    setPaused((p) => !p);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      screenRef.current?.requestFullscreen?.();
      setFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setFullscreen(false);
    }
  };

  // ---- Results computation ----
  const total = questions.length;
  const attempted = Object.keys(answers).length;
  const correct = Object.values(result).filter((a) => a.correct).length;
  const wrong = attempted - correct;
  const skipped = total - attempted;
  const accPct = attempted ? Math.round((correct / attempted) * 100) : 0;
  const notAnswered = total - attempted;

  // pacing (v6 §6): avg sec/question on ATTEMPTED questions + rushing/balanced/slow
  const spentList = questions
    .map((q) => timeSpent[q.id] || 0)
    .filter((t) => t > 0);
  const avgSec = spentList.length
    ? Math.round(spentList.reduce((a, b) => a + b, 0) / spentList.length)
    : 0;
  const paceLabel = avgSec === 0 ? "—" : avgSec < 40 ? "Rushing ⚡" : avgSec <= 90 ? "Balanced ✅" : "Slow 🐢";

  // topic breakdown weakest-first (chapter tags from v6 §2/§3 — real DB data)
  const topicMap: { [ch: string]: { total: number; correct: number } } = {};
  questions.forEach((q) => {
    const t = q.chapter || "General";
    topicMap[t] = topicMap[t] || { total: 0, correct: 0 };
    topicMap[t].total += 1;
    if (result[q.id]?.correct) topicMap[t].correct += 1;
  });
  const topicRows = Object.entries(topicMap)
    .map(([name, v]) => ({
      name,
      total: v.total,
      correct: v.correct,
      pct: v.total ? Math.round((v.correct / v.total) * 100) : 0,
    }))
    .filter((r) => r.total > 0)
    .sort((a, b) => a.pct - b.pct); // weakest first

  // what-to-do-next (v6 §6)
  const nextAction =
    attempted === 0
      ? tr("You did not answer anything — attempt at least 5 questions first.", "Is test me koi answer nahi kiya — pehle 5 questions attempt karke aao.")
      : accPct < 60
        ? tr("Accuracy is below 60% — review your weak topics and try again.", "Accuracy 60% se kam hai — weak topics review karke wapas try karo.")
        : skipped > 0
          ? "Bach gaye " + skipped + " skipped questions — ab unhe attempt karna seekho, speed par kaam karo."
          : tr("Good accuracy! Now take a new test to build speed.", "Achhi accuracy! Ab naya test try karke speed badhao.");

  const timelineColor =
    timeLeft > 120 ? "text-success" : timeLeft > 60 ? "text-warning" : "text-danger";

  // ============ INSTRUCTIONS SCREEN ============
  if (phase === "instructions") {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto max-w-4xl px-4 py-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Logo size={32} />
            </div>
            <a href="/dashboard" className="btn btn-outline">Back to Dashboard</a>
          </div>

          <h1 className="mt-10 text-3xl font-extrabold">{preMeta?.title || "Practice Test"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Bilingual · Full Mock Experience</p>

          {dailyGate ? (
            // BUGFIX: previously this state didn't exist — the page rendered the
            // full generic instructions form (wrong title/numbers) and only told
            // the student the Daily Test was locked via a browser alert() AFTER
            // they clicked Start. Now we check status up front and show this
            // instead of the (misleading) instructions form.
            <div className="card mt-8 border-warning/40 bg-warning/5 p-6">
              <p className="font-semibold text-warning">{tr("⚠️ This test is locked", "⚠️ Test abhi locked hai")}</p>
              <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{dailyGate}</p>
              <a
                href="/study-plan"
                className="mt-4 inline-block rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                Create Study Plan →
              </a>
            </div>
          ) : (
            <>
              {/* Instructions table — real values from preMeta when known, no hardcode (v6 §1) */}
              <div className="card mt-8 divide-y divide-border overflow-hidden">
                {(() => {
                  const durMin = preMeta?.durationMinutes || Math.max(1, Math.round((total || 10) * 0.5));
                  const totalQ = preMeta?.totalQuestions || total || 10;
                  const maxMarks = preMeta?.totalMarks || questions.reduce((s, q) => s + (q.marks ?? 1), 0) || totalQ;
                  const negM = questions[0]?.negativeMarks ?? 0.25;
                  const posM = questions[0]?.marks ?? 1;
                  return [
                    ["Duration", `${durMin} minutes`],
                    ["Total Questions", `${totalQ} Questions`],
                    ["Max Marks", `${maxMarks} Marks`],
                    ["Negative Marking", `−${negM} per wrong answer`],
                    ["Marking", `+${posM} per correct answer`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between px-5 py-3">
                      <span className="text-sm text-muted-foreground">{k}</span>
                      <span className="text-sm font-semibold">{v}</span>
                    </div>
                  ));
                })()}
              </div>

              {/* Bilingual language rule note */}
              <div className="card mt-6 border-info/30 bg-info/5 p-5 text-sm">
                <p className="font-semibold text-info">📘 Bilingual Questions</p>
                <p className="mt-2 text-muted-foreground">
                  Har question English <b>aur</b> हिंदी dono mein ek saath dikhta hai
                  — kisi language toggle ki zaroorat nahi. Options bhi bilingual hain.
                  Matching the real SSC bilingual paper experience.
                </p>
              </div>

              <div className="card mt-6 p-5">
                <label className="text-sm font-semibold">Exam Format</label>
                <div className="mt-3 flex gap-3">
                  <button
                    className="flex-1 rounded-xl border border-primary bg-primary/10 px-4 py-3 text-sm font-semibold text-primary"
                  >
                    Bilingual (EN + हिंदी)
                  </button>
                </div>
                <label className="mt-5 flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-border accent-[hsl(var(--primary))]"
                  />
                  <span className="text-muted-foreground">
                    I have read and understood the instructions. I agree not to use any
                    unfair means during this test. All questions will be auto-submitted
                    when the timer reaches zero.
                  </span>
                </label>
                <button
                  disabled={!agreed || starting}
                  onClick={startTest}
                  className="mt-6 w-full rounded-xl bg-primary px-6 py-3.5 text-base font-bold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {starting
                    ? "Loading questions…"
                    : agreed
                      ? "Start Test →"
                      : "Agree to start"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ============ RESULTS SCREEN ============
  if (phase === "results") {
    const perceivedMax = questions.reduce((s, q) => s + (q.marks ?? 1), 0);
    // cut-off: data-driven (historical/admin-set). For practice, derive from avg of attempted scores.
    const cutoff = Math.max(1, Math.round(perceivedMax * 0.4));
    const cutoffPercent = Math.min(100, (cutoff / perceivedMax) * 100);
    const qualifies = finalScore >= cutoff;
    // colour-coded correct/wrong/skipped bar (v6 §6)
    const cwPct = total ? (correct / total) * 100 : 0;
    const wwPct = total ? (wrong / total) * 100 : 0;
    const swPct = total ? (skipped / total) * 100 : 0;
    // per-question review tabs (v6 §6: All / Wrong / Skipped / Correct)
    const reviewQs = questions
      .map((q, i) => ({ q, i }))
      .filter(({ q }) =>
        reviewTab === "all" ? true
          : reviewTab === "correct" ? !!result[q.id]?.correct
          : reviewTab === "wrong" ? (result[q.id] && !result[q.id].correct)
          : !result[q.id]
      );
      return (
      <div className="min-h-screen bg-background px-4 py-10 text-foreground">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-extrabold">Test Result 🎉</h1>
            <div className="flex items-center gap-2">
              <span className={`badge ${qualifies ? "badge-success" : "badge-danger"}`}>
                {qualifies ? "✓ Above Cut-off" : "✗ Below Cut-off"}
              </span>
              <a href="/dashboard" className="btn btn-outline">Back to Dashboard</a>
            </div>
          </div>

          {/* Summary rings */}
          <div className="card mt-8 grid grid-cols-2 gap-6 p-6 sm:grid-cols-4">
            <Ring label="Score" value={`${finalScore}/${perceivedMax}`} pct={(finalScore / perceivedMax) * 100} color="hsl(var(--primary))" />
            <Ring label="Accuracy" value={`${accPct}%`} pct={accPct} color="hsl(var(--success))" />
            <Ring label="Attempted" value={`${attempted}/${total}`} pct={(attempted / total) * 100} color="hsl(var(--info))" />
            <Ring label="Not Answered" value={`${notAnswered}`} pct={notAnswered > 0 ? (notAnswered / total) * 100 : 0} color="hsl(var(--warning))" />
          </div>

          {/* Cut-off + section-wise performance cards */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="card p-5">
              <p className="text-xs font-bold text-muted-foreground">CUT-OFF</p>
              <div className="mt-2 flex items-end gap-2">
                <span className="text-4xl font-extrabold">{cutoff}</span>
                <span className="text-sm text-muted-foreground">/ {perceivedMax} marks</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Your score <span className="font-semibold text-foreground">{finalScore}</span>{" "}
                {qualifies ? "clears" : "misses"} the qualifying cut-off for this mock.
              </p>
              <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-warning" style={{ width: `${cutoffPercent}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                <span>0</span>
                <span className="font-mono">{finalScore} (you)</span>
                <span>{perceivedMax}</span>
              </div>
            </div>
            <div className="card overflow-hidden">
              <div className="border-b border-border px-5 py-3">
                <p className="text-xs font-bold text-muted-foreground">CORRECT / WRONG / SKIPPED</p>
              </div>
              <div className="px-5 py-4">
                <div className="flex h-3 w-full overflow-hidden rounded-full">
                  {correct > 0 && <div className="h-full bg-success" style={{ width: `${cwPct}%` }} title={`${correct} correct`} />}
                  {wrong > 0 && <div className="h-full bg-danger" style={{ width: `${wwPct}%` }} title={`${wrong} wrong`} />}
                  {skipped > 0 && <div className="h-full bg-muted-foreground/30" style={{ width: `${swPct}%` }} title={`${skipped} skipped`} />}
                </div>
                <div className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs">
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-success" /> {correct} Correct</span>
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-danger" /> {wrong} Wrong</span>
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground/30" /> {skipped} Skipped</span>
                </div>
              </div>
            </div>
          </div>

          {/* Topic breakdown weakest-first (real DB chapter tags) */}
          <div className="card mt-6 overflow-hidden">
            <div className="border-b border-border p-5">
              <p className="text-xs font-bold text-muted-foreground">WHAT IT LOOKED AT — TOPIC BREAKDOWN (weakest first)</p>
            </div>
            {topicRows.length === 0 ? (
              <div className="px-5 py-4 text-sm text-muted-foreground">{tr("No attempts — topics could not be analysed.", "Koi attempt nahi — topics analyze nahi ho sake.")}</div>
            ) : (
              topicRows.map((t) => (
                <div key={t.name} className="flex items-center gap-3 border-b border-border px-5 py-3 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{t.name}</p>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${t.pct >= 70 ? "bg-success" : t.pct >= 40 ? "bg-warning" : "bg-danger"}`}
                        style={{ width: `${Math.max(t.pct, 3)}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-24 shrink-0 text-right">
                    <p className="text-sm font-extrabold">{t.pct}%</p>
                    <p className="text-[11px] text-muted-foreground">{t.correct}/{t.total} correct</p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Pacing analysis (v6 §6) */}
          <div className="card mt-6 p-6">
            <h3 className="font-semibold">⏱ Pacing Analysis</h3>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-muted/50 p-3 text-center">
                <p className="text-2xl font-extrabold">{avgSec || "—"}<span className="text-xs font-normal text-muted-foreground"> sec</span></p>
                <p className="text-[11px] text-muted-foreground">avg per question</p>
              </div>
              <div className="rounded-xl bg-muted/50 p-3 text-center">
                <p className="text-2xl font-extrabold">{paceLabel}</p>
                <p className="text-[11px] text-muted-foreground">pace on attempted</p>
              </div>
              <div className="rounded-xl bg-muted/50 p-3 text-center">
                <p className="text-2xl font-extrabold">{spentList.length}<span className="text-xs font-normal text-muted-foreground">/ {total}</span></p>
                <p className="text-[11px] text-muted-foreground">timed questions</p>
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-info/20 bg-info/5 p-4 text-sm">
              <p className="font-semibold text-info">💡 Instant Diagnosis</p>
              <p className="mt-1 text-muted-foreground">{nextAction}</p>
            </div>
          </div>

          {/* What to do next — weak topics of THIS submission + custom practice (pick topics, choose counts) */}
          <WeakTopicPractice
            className="mt-6"
            attemptId={attemptId || undefined}
            questionIds={questions.filter((q) => !result[q.id]?.correct).map((q) => q.id)}
          />

          {/* What to do next (v6 §6) */}
          <div className="card mt-6 flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <h3 className="font-semibold">📌 What to do next</h3>
              <p className="mt-1 text-xs text-muted-foreground">Take another test, or review your mistakes below.</p>
            </div>
            <div className="flex gap-2">
              {wrong > 0 && (
                <button onClick={() => retryWrong(false)} className="btn btn-primary">↻ Retry wrong ({wrong})</button>
              )}
              {wrong + skipped > 0 && skipped > 0 && (
                <button onClick={() => retryWrong(true)} className="btn btn-outline">↻ Wrong + skipped ({wrong + skipped})</button>
              )}
              <a href="/test" className="btn btn-outline">New Test →</a>
              <a href="/question-bank" className="btn btn-outline">Question Bank</a>
            </div>
          </div>

          {/* Answers review — v6 §6: tabs + topic/year + time spent + navigator */}
          <div className="card mt-6 overflow-hidden">
            <div className="border-b border-border p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-3"><h3 className="font-semibold">Answer Review</h3><ReviewLangToggle lang={revLang} onChange={setRevLang} /></div>
                {/* filter tabs */}
                <div className="flex gap-1 rounded-lg bg-muted p-1 text-xs font-semibold">
                  {([["all", `All (${total})`], ["wrong", `Wrong (${wrong})`], ["skipped", `Skipped (${skipped})`], ["correct", `Correct (${correct})`]] as const).map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => { setReviewTab(k); setNavQ(null); }}
                      className={`rounded-md px-2.5 py-1 transition ${reviewTab === k ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Legend: <span className="text-success">correct</span> ·{" "}
                <span className="text-danger">wrong</span> ·{" "}
                <span className="text-muted-foreground">skipped</span>
              </p>
            </div>

            {/* question navigator — color-coded jump grid (v6 §6) */}
            <div className="border-b border-border px-5 py-3">
              <p className="text-xs font-bold text-muted-foreground">JUMP TO QUESTION</p>
              <div className="mt-2 grid grid-cols-10 gap-1.5">
                {questions.map((qq, i) => {
                  const st = result[qq.id]?.correct ? "bg-success text-white" : result[qq.id] ? "bg-danger text-white" : "bg-muted text-muted-foreground";
                  return (
                    <button
                      key={qq.id}
                      onClick={() => { setNavQ(i); setReviewTab("all"); }}
                      className={`flex h-8 w-8 items-center justify-center rounded-md text-xs font-bold ${st} ${navQ === i ? "ring-2 ring-[hsl(var(--ring))]" : ""}`}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="divide-y divide-border">
              {(navQ !== null ? questions.map((q, i) => ({ q, i })).filter(({ i }) => i === navQ) : reviewQs).map(({ q, i }) => {
                const a = result[q.id];
                const pickOpt = (o?: { text: string; textHi?: string | null }) => (o ? (revLang === "hi" && o.textHi ? o.textHi : revLang === "both" && o.textHi ? `${o.text} / ${o.textHi}` : o.text) : undefined);
                const ansText = answers[q.id] ? pickOpt(q.options.find((o) => o.key === answers[q.id])) : "—";
                const spent = timeSpent[q.id] || 0;
                // BUGFIX (Sachin report, Sep 2026 — solutions results screen
                // pe kabhi nahi dikhta / "Answer not available — please
                // report this question" on every row): for server-
                // authoritative tests (year-wise/daily/mock) q.explanation
                // was always undefined by design (see Attempt type comment
                // above) so this fallback chain always hit its last resort.
                // `explanations[q.id]` (populated post-submit from
                // attemptDetail(), covers answered AND skipped questions)
                // is now checked first; q.explanation stays as the fallback
                // for the practice path (/sectional, chapter-wise, /bank/set)
                // which never goes through the explanations map.
                const ex = explanations[q.id];
                const correctKey = (ex?.correctAnswer || a?.correctAnswer || "").trim().toUpperCase();
                const correctOpt = q.options.find((o) => (o.key || "").trim().toUpperCase() === correctKey);
                const correctLabel = pickOpt(correctOpt) || (correctKey ? `Option ${correctKey}` : null);
                // `a` (= result[q.id], filled from /bank/attempt above) is now
                // checked too — the practice/sectional/chapter-wise-PYQ path's
                // only source for explanation (see BUGFIX above the /bank/attempt
                // call). `explanations` (authoritative path) still wins when both
                // exist since it's the server's post-submit source of truth.
                const expl = ex?.explanation ?? a?.explanation ?? q.explanation ?? null;
                const explHi = ex?.explanationHindi ?? a?.explanationHindi ?? q.explanationHindi ?? null;
                const isOpen = solOpen[q.id];
                return (
                  <div key={q.id} className="px-5 py-4">
                    <div className="flex items-start gap-3">
                      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${a?.correct ? "bg-success/15 text-success" : a ? "bg-danger/15 text-danger" : "bg-muted text-muted-foreground"}`}>
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          {q.chapter && <span className="rounded bg-muted px-1.5 py-0.5 font-semibold text-muted-foreground">{q.chapter}</span>}
                          {q.examName && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-semibold text-amber-600">{q.examName}{q.year ? ` ${q.year}` : ""}{q.shift ? ` · ${q.shift}` : ""}</span>}
                          {spent > 0 && <span className="text-muted-foreground">⏱ {spent}s</span>}
                        </div>
                        <p className="mt-1 text-sm font-medium line-clamp-2">{revLang === "hi" && q.questionTextHindi ? q.questionTextHindi : q.questionText}</p>
                        {revLang === "both" && q.questionTextHindi && (
                          <p className="mt-0.5 font-hindi text-sm text-muted-foreground line-clamp-2">{q.questionTextHindi}</p>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">
                          Your answer: <span className="font-semibold">{ansText}</span>
                          {!a?.correct && (
                            <span> · Correct: <span className="font-semibold text-success">{correctLabel || "—"}</span></span>
                          )}
                        </p>
                      </div>
                      {a?.correct ? (
                        <span className="shrink-0 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-bold text-success">+{(q.marks ?? 1).toFixed(2).replace(/\.?0+$/, "")}</span>
                      ) : a ? (
                        <span className="shrink-0 rounded-full bg-danger/15 px-2.5 py-0.5 text-xs font-bold text-danger">−{(q.negativeMarks ?? 0.25).toFixed(2).replace(/\.?0+$/, "")}</span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">Skip</span>
                      )}
                    </div>

                    {/* Tap to view detailed explanation — works for every
                        test type since this only renders post-submit
                        (phase === "results"), so there's no exam-integrity
                        concern the way there was for the mid-attempt
                        "Show Answer" button. */}
                    <div className="mt-2 ml-9 flex flex-wrap items-center gap-3">
                      <button
                        onClick={() => {
                          const willOpen = !isOpen;
                          setSolOpen((p) => ({ ...p, [q.id]: willOpen }));
                          
                        }}
                        className="text-xs font-semibold text-primary hover:underline"
                      >
                        {isOpen ? "▲ Hide question & solution" : "▼ View full question & solution"}
                      </button>
                      {/* Report + chat — works for every test type since this
                          only renders post-submit (phase === "results"), same
                          reasoning as the Show Solution button above. Lets a
                          student flag tr("answer / explanation is wrong", "answer/explanation galat hai") right
                          where they're looking at it, and then talk to admin
                          about it without leaving this page. */}
                      {currentUserId && <ReportQuestion questionId={q.id} currentUserId={currentUserId} compact />}
                    </div>
                    {isOpen && (
                      <div className="ml-0 mt-3 space-y-3 sm:ml-9">
                        <ReviewQuestionBody
                          questionText={q.questionText}
                          questionTextHindi={q.questionTextHindi}
                          diagramType={q.questionDiagramType}
                          diagramLabels={q.questionDiagramLabels}
                          imageUrl={q.questionImageUrl}
                          options={q.options}
                          selected={answers[q.id] || null}
                          correct={correctKey}
                          lang={revLang}
                        />
                        <SolutionPanel
                          questionId={q.id}
                          correctKey={correctKey || null}
                          correctLabel={correctOpt?.text || null}
                          explanation={expl}
                          explanationHindi={explHi}
                          source={ex?.explanationSource ?? a?.explanationSource ?? null}
                          lang={revLang}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              {reviewQs.length === 0 && navQ === null && (
                <div className="px-5 py-6 text-center text-sm text-muted-foreground">{tr("No questions in this tab.", "Is tab me koi question nahi.")}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============ EXAM SCREEN ============
  const q = questions[idx];
  const tally = (list: UgQ[]): StatusCounts => {
    const c: StatusCounts = { notVisited: 0, notAnswered: 0, answered: 0, marked: 0, answeredMarked: 0 };
    for (const x of list) {
      const st = statusOf(x.id);
      if (st === "not-visited") c.notVisited++;
      else if (st === "not-answered") c.notAnswered++;
      else if (st === "answered") c.answered++;
      else if (st === "marked") c.marked++;
      else c.answeredMarked++;
    }
    return c;
  };
  const allCounts = tally(questions);
  const sectionNames = Array.from(new Set(questions.map((x) => x.section || ""))).filter(Boolean);
  const hasSections = sectionNames.length > 1;
  const curSection = q?.section || "";
  const paletteItems = questions.map((x, i) => ({ x, i })).filter(({ x }) => !hasSections || (x.section || "") === curSection);
  const paletteCounts = hasSections ? tally(paletteItems.map((p) => p.x)) : allCounts;
  const jumpToSection = (name: string) => {
    const first = questions.findIndex((x) => x.section === name);
    if (first >= 0) markVisited(first, questions[first].id);
  };
  const unansweredFirst = () => {
    const i = questions.findIndex((x) => {
      const st = statusOf(x.id);
      return st === "not-visited" || st === "not-answered" || st === "marked";
    });
    if (i >= 0) {
      markVisited(i, questions[i].id);
      setReviewOpen(false);
    }
  };
  const lowTime = timeLeft > 0 && timeLeft <= 300;
  const unansweredTotal = allCounts.notVisited + allCounts.notAnswered + allCounts.marked;

  return (
    <div ref={screenRef} className="min-h-screen bg-muted/40 text-foreground">
      {/* OFFLINE BANNER — answers are mirrored on the device; the test keeps running and submits when the net is back */}
      {!online && !offlinePending && (
        <div className="sticky top-0 z-40 bg-amber-500 px-3 py-1.5 text-center text-xs font-semibold text-white">
          You are offline. Keep going — your answers are saved on this device and the test will submit automatically when your internet returns.
        </div>
      )}
      {/* OFFLINE SUBMIT QUEUED */}
      {offlinePending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-6 backdrop-blur">
          <div className="max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-xl">
            <div className="text-4xl">{online ? "⏳" : "📡"}</div>
            <h2 className="mt-3 text-lg font-bold">{online ? "Submitting your test…" : "Your test is finished and saved"}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {online
                ? "Connection is back. Sending your answers now."
                : "No internet right now. Your answers are safely stored on this device and will be submitted automatically the moment you are back online — you will see your real result then. You can keep this page open."}
            </p>
            <button
              onClick={retryQueuedSubmit}
              className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              Retry now
            </button>
          </div>
        </div>
      )}
      {/* TOP BAR */}
      <div className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-lg">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-3" style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}>
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Mobile palette toggle (drawer) */}
            <button onClick={() => setPaletteOpen(true)} className="rounded-lg border border-border px-2.5 py-1 text-xs lg:hidden" aria-label="Open question palette">
              ☰ Palette
            </button>
            {/* Zoom */}
            <div className="hidden items-center gap-1 rounded-lg border border-border p-1 text-xs sm:flex">
              <button onClick={() => setZoom((z) => Math.max(90, z - 5))} aria-label="Zoom out" className="rounded px-1.5 hover:bg-muted">−</button>
              <span className="w-8 text-center font-semibold">{zoom}%</span>
              <button onClick={() => setZoom((z) => Math.min(130, z + 5))} aria-label="Zoom in" className="rounded px-1.5 hover:bg-muted">+</button>
            </div>
            <button onClick={toggleFullscreen} className="hidden rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-muted sm:inline-flex">
              {fullscreen ? "Exit Fullscreen" : "⛶ Fullscreen"}
            </button>
          </div>

          <div className="hidden text-center md:block">
            <p className="text-sm font-bold leading-tight">{preMeta?.title || "Practice Mock"}</p>
            <div className="mt-0.5 flex items-center justify-center gap-2">
              <span className="rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-bold text-success">
                +{questions[0]?.marks ?? 1} / −{questions[0]?.negativeMarks ?? 0.25}
              </span>
              <p className="text-[11px] text-muted-foreground">{isExamMode ? "Candidate · Mock Exam" : "Candidate · Practice"}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setHelpOpen(true)} className="hidden rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted lg:inline-flex" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
              ⌨
            </button>
            {/* Pause is practice-only: in a server-authoritative exam the server clock keeps running, so a client pause would be misleading. */}
            {!isExamMode && (
              <button onClick={togglePause} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted sm:px-3">
                {paused ? "▶ Resume" : "⏸ Pause"}
              </button>
            )}
            <div
              role="timer"
              aria-label="Time left"
              className={`rounded-lg border px-3 py-1 font-mono text-sm font-bold tabular-nums sm:px-4 sm:py-1.5 sm:text-base ${timelineColor} ${paused ? "opacity-50" : ""} ${timeLeft > 0 && timeLeft <= 60 ? "animate-pulse" : ""}`}
            >
              {formatSec(timeLeft)}
            </div>
          </div>
        </div>
        {hasSections && (
          <div className="mx-auto max-w-7xl overflow-x-auto px-3 pb-2 sm:px-4" role="tablist" aria-label="Sections">
            <div className="flex w-max gap-2">
              {sectionNames.map((name) => {
                const list = questions.filter((x) => x.section === name);
                const c = tally(list);
                const active = name === curSection;
                return (
                  <button
                    key={name}
                    role="tab"
                    aria-selected={active}
                    onClick={() => jumpToSection(name)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                      active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <span className="max-w-[10rem] truncate">{name}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${active ? "bg-primary-foreground/20" : "bg-muted"}`}>
                      {c.answered + c.answeredMarked}/{list.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {lowTime && (
          <div className="bg-warning/15 px-3 py-1 text-center text-[11px] font-semibold text-warning" role="status">
            {timeLeft <= 60 ? tr("Less than 1 minute left!", "1 minute se kam bacha hai!") : tr("Last 5 minutes — review your marked questions.", "Last 5 minutes — marked questions check karo.")}
          </div>
        )}
      </div>

      <div className="mx-auto flex max-w-7xl gap-6 px-2 py-3 pb-28 sm:px-4 sm:py-6 lg:pb-6" style={{ zoom: zoom / 100 }}>
        {/* MAIN QUESTION AREA */}
        <main className="min-w-0 flex-1">
          {!q ? (
            <div className="card p-10 text-center text-sm text-muted-foreground">No questions loaded.</div>
          ) : (
            <motion.div key={q.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }} className="card p-3 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  {(q as any).questionNo ? <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-extrabold" title="Question number — report karte waqt yahi number batayein">Q#{(q as any).questionNo}</span> : null}
                  <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">{q.chapter || "General"}</span>
                  <span className="text-xs text-muted-foreground">Question {idx + 1} of {questions.length}</span>
                  {q.examName && (
                    <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-bold text-amber-600">
                      {q.examName}{q.year ? ` ${q.year}` : ""}{q.shift ? ` · Shift ${q.shift}` : ""}
                    </span>
                  )}
                  <span className="rounded-md bg-success/15 px-2 py-0.5 text-xs font-bold text-success">+{q.marks ?? 1} / −{q.negativeMarks ?? 0.25}</span>
                </div>
                <span className="badge badge-info">EN + हिंदी</span>
              </div>
              <h2 className="mt-4 break-words text-base font-semibold leading-relaxed">
                {q.questionText}
              </h2>
              {q.questionTextHindi && (
                <p className="mt-2 border-l-2 border-primary/40 pl-3 text-[15px] font-hindi leading-relaxed text-muted-foreground">
                  {q.questionTextHindi}
                </p>
              )}
              {/* Session 22 — question-stem diagram (rare: most diagram
                  questions put the figure in the OPTIONS instead, below). */}
              <StemMedia diagramType={q.questionDiagramType} diagramLabels={q.questionDiagramLabels} imageUrl={q.questionImageUrl} />
              <div className="mt-5 space-y-2.5">
                {q.options.map((o) => {
                  const active = answers[q.id] === o.key;
                  return (
                    <button
                      key={o.key}
                      onClick={() => chooseOption(q.id, o.key)}
                      className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm transition ${
                        active ? "border-primary bg-primary text-primary-foreground shadow-md" : "border-border bg-card hover:bg-muted"
                      }`}
                      role="radio"
                      aria-checked={active}
                    >
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${active ? "border-primary-foreground bg-primary-foreground text-primary" : "border-border"}`}>
                        {o.key}
                      </span>
                      <span className="min-w-0 flex-1">
                        {/* Session 22 — diagram option (the common case:
                            each of A/B/C/D is a different Venn diagram). */}
                        {o.diagramType ? (
                          <span className={`flex justify-center rounded-lg p-1 ${active ? "" : "text-foreground"}`}>
                            <DiagramVenn type={o.diagramType} labels={o.diagramLabels} size={130} />
                          </span>
                        ) : o.imageUrl ? (
                          <span className="flex justify-center rounded-lg p-1">
                            <QFigure src={o.imageUrl} alt={`Option ${o.key}`} className="max-h-40" />
                          </span>
                        ) : (
                          <>
                            <span>{o.text}</span>
                            {o.textHi && (
                              <span className={`mt-1 block border-l-2 pl-3 font-hindi ${active ? "border-primary-foreground/50 text-primary-foreground/90" : "border-border text-muted-foreground"}`}>
                                {o.textHi}
                              </span>
                            )}
                          </>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Action row */}
              <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-5">
                <button onClick={markAndNext} className="btn bg-primary/10 text-primary hover:bg-primary/20" title="Mark for review & go to next (M)">
                  ⚑ Mark for Review &amp; Next
                </button>
                <button onClick={markForReview} className="btn btn-outline" aria-pressed={statusOf(q.id) === "marked" || statusOf(q.id) === "answered-marked"}>
                  {statusOf(q.id) === "marked" || statusOf(q.id) === "answered-marked" ? "⚑ Unmark" : "⚑ Mark"}
                </button>
                <button onClick={clearAnswer} className="btn btn-outline" title="Clear response (C)">Clear Response</button>
                {/* Report button available mid-test too (not just on the
                    results screen) — a student shouldn't have to finish and
                    submit the whole test just to flag a question that's
                    obviously wrong right now. Safe to show even in exam
                    mode: reporting doesn't reveal the correct answer or
                    otherwise affect exam integrity. */}
                {currentUserId && <ReportQuestion questionId={q.id} currentUserId={currentUserId} compact />}
                {/* Show Answer / AI Hint are practice-only aids. Hidden in
                    isExamMode (sectional / year-wise / full mock — any
                    server-authoritative timed attempt) so a real exam can't
                    be cheated mid-attempt. */}
                {!isExamMode && q.correctAnswer && (
                  <button
                    onClick={() => {
                      const willShow = !showAns[q.id];
                      setShowAns((p) => ({ ...p, [q.id]: willShow }));
                      if (willShow && !q.explanation && !aiExp[q.id]) fetchAiExplanation(q.id);
                    }}
                    className={`btn ${showAns[q.id] ? "btn-success" : "btn-outline"}`}
                  >
                    {showAns[q.id] ? "✓ Answer Shown" : "Show Answer"}
                  </button>
                )}
                {!isExamMode && (
                  <button
                    onClick={() => {
                      if (hintUsed[q.id] || hintQuota <= 0) return;
                      setHintUsed((p) => ({ ...p, [q.id]: true }));
                      setHintQuota((n) => n - 1);
                    }}
                    disabled={hintUsed[q.id] || hintQuota <= 0}
                    className="btn btn-outline disabled:opacity-40"
                    title="Free AI Hint (3 per session)"
                  >
                    {hintUsed[q.id] ? "Hint shown ✓" : hintQuota <= 0 ? "Hint used all (3/3)" : `💡 AI Hint (${hintQuota} left)`}
                  </button>
                )}
                <div className="flex-1" />
                <button onClick={saveAndNext} className="btn btn-primary">
                  Save &amp; Next →
                </button>
              </div>

              {/* Show Answer / Hint panel — real DB data, no fabrication */}
              {!isExamMode && (showAns[q.id] || hintUsed[q.id]) && (
                <div className="mt-4 rounded-xl border border-success/30 bg-success/5 p-4">
                  <p className="text-xs font-bold text-success">Correct Answer: {q.correctAnswer}</p>
                  {hintUsed[q.id] && (
                    <p className="mt-1 text-xs italic text-muted-foreground">
                      Hint: {q.explanation ? q.explanation.slice(0, 120) + (q.explanation.length > 120 ? "…" : "") : "Explanation available in solution."}
                    </p>
                  )}
                  {showAns[q.id] && q.explanation && (
                    <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      <p>{q.explanation}</p>
                      {/* BUGFIX (Sachin report, Sep 2026 — "solution poora nahi
                          dikhta"): explanationHindi was fetched and passed into
                          this component's data shape (see line ~406 above) but
                          NEVER rendered anywhere on this page — only the
                          English q.explanation showed here, no matter how
                          complete the Hindi explanation was in the database.
                          Bilingual solution display (English + Hindi) is now
                          shown together whenever both exist, matching what
                          results/[attemptId]/page.tsx already does correctly. */}
                      {q.explanationHindi && (
                        <p className="mt-2 border-t border-success/20 pt-2">🇮🇳 {q.explanationHindi}</p>
                      )}
                    </div>
                  )}
                  {showAns[q.id] && !q.explanation && (
                    <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      <span className="mr-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">🤖 AI-generated</span>
                      {aiExp[q.id]?.loading && <p className="mt-1">{tr("Preparing the explanation…", "Explanation ban rahi hai…")}</p>}
                      {aiExp[q.id]?.error && (
                        <p className="mt-1">
                          {aiExp[q.id]?.error}{" "}
                          <button onClick={() => fetchAiExplanation(q.id)} className="font-semibold text-primary underline">Retry</button>
                        </p>
                      )}
                      {aiExp[q.id]?.data && (
                        <div className="mt-1">
                          <p className="whitespace-pre-line">{aiExp[q.id]!.data!.stepByStepSolution}</p>
                          {aiExp[q.id]!.data!.stepByStepSolutionHindi && (
                            <p className="mt-2 whitespace-pre-line border-t border-primary/20 pt-2">
                              🇮🇳 {aiExp[q.id]!.data!.stepByStepSolutionHindi}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="mt-3 hidden justify-between text-xs text-muted-foreground lg:flex">
                <button onClick={() => idx > 0 && markVisited(idx - 1, questions[idx - 1].id)} className="hover:text-foreground">← Previous</button>
                <button onClick={() => idx < questions.length - 1 && markVisited(idx + 1, questions[idx + 1].id)} className="hover:text-foreground">Next →</button>
              </div>
            </motion.div>
          )}
        </main>

        {/* QUESTION PALETTE SIDEBAR */}
        <aside className="hidden w-72 shrink-0 lg:block">
          <div className="card sticky top-28 p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold">Question Palette</h3>
              {hasSections && (
                <span className="max-w-[10rem] truncate rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">{curSection}</span>
              )}
            </div>
            <div className="max-h-[52vh] overflow-y-auto pr-0.5">
              <PaletteBody items={paletteItems} idx={idx} statusOf={statusOf} counts={paletteCounts} onJump={(i) => markVisited(i, questions[i].id)} cols="grid-cols-5" />
            </div>
            <p className="pt-2 text-[10px] italic text-muted-foreground">Answered + Marked for Review still counts as answered for scoring.</p>
            <button onClick={() => setReviewOpen(true)} disabled={submitBusy} className="btn btn-primary mt-4 w-full disabled:opacity-50">
              Submit Test
            </button>
            <p className="mt-2 text-center text-[10px] text-muted-foreground">⚠️ Auto-submits at 00:00</p>
          </div>
        </aside>
      </div>

      {/* MOBILE BOTTOM NAV (phones): big thumb-friendly Prev / Palette / Next */}
      {questions.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur lg:hidden" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
          <div className="mx-auto flex max-w-xl items-center gap-2 px-3 pt-2">
            <button onClick={() => idx > 0 && markVisited(idx - 1, questions[idx - 1].id)} disabled={idx === 0} className="flex-1 rounded-xl border border-border px-3 py-3 text-sm font-semibold disabled:opacity-40">← Prev</button>
            <button onClick={() => setPaletteOpen(true)} className="rounded-xl border border-border px-3 py-3 text-sm font-bold" aria-label="Open question palette">☰ {idx + 1}/{questions.length}</button>
            <button onClick={() => (idx < questions.length - 1 ? markVisited(idx + 1, questions[idx + 1].id) : setReviewOpen(true))} className="flex-1 rounded-xl bg-primary px-3 py-3 text-sm font-bold text-primary-foreground">{idx < questions.length - 1 ? "Next →" : "Submit"}</button>
          </div>
        </div>
      )}

      {/* MOBILE QUESTION PALETTE DRAWER */}
      {paletteOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Question palette">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPaletteOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-border bg-background p-4 pb-6">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted" />
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">Question Palette</h3>
              <button onClick={() => setPaletteOpen(false)} className="rounded-lg border border-border px-2.5 py-1 text-xs">✕ Close</button>
            </div>
            {hasSections && (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {sectionNames.map((name) => (
                  <button
                    key={name}
                    onClick={() => jumpToSection(name)}
                    className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold ${name === curSection ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
            <PaletteBody items={paletteItems} idx={idx} statusOf={statusOf} counts={paletteCounts} onJump={(i) => { markVisited(i, questions[i].id); setPaletteOpen(false); }} cols="grid-cols-6" />
            <button onClick={() => { setReviewOpen(true); setPaletteOpen(false); }} disabled={submitBusy} className="btn btn-primary mt-4 w-full disabled:opacity-50">
              Submit Test
            </button>
          </div>
        </div>
      )}

      {/* PAUSED (practice only) */}
      {paused && !isExamMode && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/95 p-6 backdrop-blur">
          <div className="card max-w-sm p-6 text-center">
            <div className="text-4xl">⏸</div>
            <h2 className="mt-3 text-lg font-bold">{tr("Test paused", "Test pause hai")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{tr("The timer is stopped. Questions are hidden until you resume.", "Timer ruka hua hai. Resume karne tak questions chhupe hain.")}</p>
            <button onClick={togglePause} className="btn btn-primary mt-4 w-full">▶ Resume</button>
          </div>
        </div>
      )}

      {/* KEYBOARD SHORTCUTS */}
      {helpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setHelpOpen(false)} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
          <div className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold">⌨ {tr("Keyboard shortcuts", "Keyboard shortcuts")}</h2>
              <button onClick={() => setHelpOpen(false)} className="rounded-lg border border-border px-2.5 py-1 text-xs">✕</button>
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              {[
                ["A – D  /  Alt+1–4", "Select option"],
                ["Space  /  →", "Save & Next"],
                ["←  /  Shift+Space", "Previous question"],
                ["M", "Mark for review & Next"],
                ["C", "Clear response"],
                ["P", "Question palette"],
                ["?", "This help"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3">
                  <dt><kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">{k}</kbd></dt>
                  <dd className="text-muted-foreground">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}

      {/* REVIEW BEFORE SUBMIT MODAL (section-wise summary, like the real CBT) */}
      {reviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Review before submit">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold">Review test before submit</h2>
                <p className="mt-1 text-xs text-muted-foreground">Once submitted you cannot change your answers.</p>
              </div>
              <div className={`rounded-lg border px-3 py-1 font-mono text-sm font-bold tabular-nums ${timelineColor}`}>{formatSec(timeLeft)}</div>
            </div>
            <div className="mt-4 overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="bg-muted/60 text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Section</th>
                    <th className="px-3 py-2 text-right font-semibold">Qs</th>
                    <th className="px-3 py-2 text-right font-semibold">Answered</th>
                    <th className="px-3 py-2 text-right font-semibold">Not Answered</th>
                    <th className="px-3 py-2 text-right font-semibold">Marked</th>
                    <th className="px-3 py-2 text-right font-semibold">Not Visited</th>
                  </tr>
                </thead>
                <tbody>
                  {(hasSections ? sectionNames : [""]).map((name) => {
                    const list = hasSections ? questions.filter((x) => x.section === name) : questions;
                    const c = tally(list);
                    return (
                      <tr key={name || "all"} className="border-t border-border">
                        <td className="max-w-[10rem] truncate px-3 py-2 font-medium">{name || "Full Paper"}</td>
                        <td className="px-3 py-2 text-right">{list.length}</td>
                        <td className="px-3 py-2 text-right font-semibold text-success">{c.answered + c.answeredMarked}</td>
                        <td className="px-3 py-2 text-right font-semibold text-danger">{c.notAnswered + c.marked}</td>
                        <td className="px-3 py-2 text-right">{c.marked + c.answeredMarked}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{c.notVisited}</td>
                      </tr>
                    );
                  })}
                  {hasSections && (
                    <tr className="border-t border-border bg-muted/30 text-xs font-semibold">
                      <td className="px-3 py-2">Total</td>
                      <td className="px-3 py-2 text-right">{questions.length}</td>
                      <td className="px-3 py-2 text-right text-success">{allCounts.answered + allCounts.answeredMarked}</td>
                      <td className="px-3 py-2 text-right text-danger">{allCounts.notAnswered + allCounts.marked}</td>
                      <td className="px-3 py-2 text-right">{allCounts.marked + allCounts.answeredMarked}</td>
                      <td className="px-3 py-2 text-right">{allCounts.notVisited}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {unansweredTotal > 0 && (
              <p className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                {tr(`${unansweredTotal} question(s) are still unanswered.`, `${unansweredTotal} question abhi unanswered hain.`)}
              </p>
            )}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button onClick={() => setReviewOpen(false)} className="btn btn-outline flex-1">Back to test</button>
              {unansweredTotal > 0 && (
                <button onClick={unansweredFirst} className="btn btn-outline flex-1">Go to first unanswered</button>
              )}
              <button onClick={submitTest} disabled={submitBusy} className="btn btn-primary flex-1 disabled:opacity-50">
                {submitBusy ? "Submitting…" : "Submit Test"}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* SUBMITTING */}
      {submitBusy && !offlinePending && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/90 p-6 backdrop-blur" role="status" aria-live="polite">
          <div className="card max-w-xs p-6 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
            <p className="mt-3 text-sm font-semibold">{tr("Submitting your test…", "Test submit ho raha hai…")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{tr("Please don't close this page.", "Page band mat karna.")}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function countOf(status: { [k: string]: QStatus }, key: QStatus): number {
  return Object.values(status).filter((s) => s === key).length;
}
