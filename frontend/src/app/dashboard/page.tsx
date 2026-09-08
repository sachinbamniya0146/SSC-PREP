"use client";

import * as React from "react";
import { ThemeContext } from "@/components/theme-provider";
import { API_BASE, fetchAuth } from "@/lib/api";

export default function DashboardPage() {
  const { theme, toggleTheme } = React.useContext(ThemeContext);
  const [user, setUser] = React.useState<{
    fullName: string;
    email: string;
    role?: string;
  } | null>(null);
  const [gami, setGami] = React.useState<{ currentStreak: number; longestStreak: number; xp: number; coins: number; hintQuota: number; rank: number } | null>(null);
  // CHANGED ("sabhi SSC exams ko bhi pattern year ke saath dikhana he, na
  // sirf CGL"): bank.service.ts's meta() already attaches a live
  // `pattern: { name, totalQuestions, totalMarks, durationMinutes }` to
  // EVERY exam that has an active ExamPattern row — not just CGL. The old
  // code here specifically filtered for `slug === "cgl"` and threw every
  // other exam's pattern away, so CHSL/MTS/CPO/etc. never showed a pattern
  // year even when the backend had one. `patternYear` below is now derived
  // per-exam (see examsWithQuestions) instead of one single CGL-only field.
  const [examsWithQuestions, setExamsWithQuestions] = React.useState<
    Array<{ id: string; name: string; count: number; patternYear: string | null; totalQuestions: number | null; durationMinutes: number | null }>
  >([]);
  const [subscription, setSubscription] = React.useState<{ active: boolean; plan?: { name: string; priceInr: number }; endsAt?: string } | null>(null);

  // NEW: shared helper — pulls a "(2024)"-style year out of an ExamPattern
  // name if present, otherwise falls back to the full pattern name as-is
  // (some patterns may not be named with a year, e.g. "Tier 1 Pattern").
  // Used for every exam now, not just CGL.
  const patternYearFrom = (patternName?: string | null): string | null => {
    if (!patternName) return null;
    const m = patternName.match(/\((\d{4})\)/);
    return m ? `${m[1]} Pattern` : patternName;
  };

  React.useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/bank/meta`);
        const d = await r.json();
        // Load exams with questions.
        // BUGFIX: threshold was e.count > 100, so while the question bank is
        // still being filled in (most exams have fewer than 100 approved
        // questions so far), EVERY exam got filtered out and "Choose Your
        // Exam" showed nothing at all — not even the fallback link, because
        // that fallback only exists in this file, not yet on the live site.
        // Lowering the bar to >= 10 means an exam shows up as soon as it has
        // a genuinely usable practice set, instead of waiting for 100+.
        if (Array.isArray(d?.exams)) {
          const exams = d.exams.filter((e: any) => e.count >= 10).sort((a: any, b: any) => b.count - a.count);
          setExamsWithQuestions(
            exams.map((e: any) => ({
              id: e.id,
              name: e.name,
              count: e.count,
              patternYear: patternYearFrom(e.pattern?.name),
              totalQuestions: e.pattern?.totalQuestions ?? null,
              durationMinutes: e.pattern?.durationMinutes ?? null,
            })),
          );
        }
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const raw = localStorage.getItem("ssc_user");
    if (raw) {
      try {
        setUser(JSON.parse(raw));
      } catch {
        /* ignore */
      }
    }
    // v1 Phase 6 — live streak/XP from the gamification service
    //
    // BUGFIX (2026-09 audit — "dashboard stops showing streak/XP/plan after
    // a while"): both calls below used a raw `fetch()` with a manually
    // attached Authorization header instead of the shared `fetchAuth()`
    // helper. fetchAuth() auto-refreshes an expired access token on a 401
    // and retries once; raw fetch() does not. The dashboard is the page
    // students land on most often and tend to leave open the longest, so
    // it's exactly where an expired access token is most likely to be hit
    // — and previously that meant XP/streak and subscription status would
    // silently stop updating (fail closed to "—") instead of transparently
    // refreshing like the rest of the app does.
    const token = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
    if (token) {
      fetchAuth(`${API_BASE}/gamification/me`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setGami(d))
        .catch(() => undefined);
      // Subscription status — was previously fetched nowhere on the
      // dashboard, so there was no visible "you're on the free plan" /
      // "Premium active until X" indicator anywhere the student would
      // actually see it day-to-day.
      fetchAuth(`${API_BASE}/payments/subscription`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setSubscription(d))
        .catch(() => undefined);
    }
  }, []);

  // BUG FIX: an ADMIN/MODERATOR account saw the exact same dashboard as a
  // plain student — no link anywhere to /admin, /verification, or /review,
  // even though `user.role` was already being returned by the login API
  // and stored in localStorage ("ssc_user"). It just wasn't being read
  // here. Without this, an admin had no visible way into their own tools
  // unless they already knew the raw URLs by heart.
  const isAdmin = user?.role === "ADMIN" || user?.role === "MODERATOR";

  const firstName = user?.fullName?.split(" ")[0] || "Student";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <span className="text-lg font-bold tracking-tight">
            SSC<span className="text-primary">PrepHub</span>
          </span>
          <div className="flex items-center gap-3 text-sm">
            <button
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="rounded-lg border border-border p-2 text-sm hover:bg-muted"
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
            <span className="hidden font-medium sm:block">{user?.fullName || "Student"}</span>
            <a
              href="/login"
              className="rounded-lg border border-border px-4 py-2 font-semibold hover:bg-muted"
              onClick={() => {
                localStorage.clear();
              }}
            >
              Logout
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10">
        {/* Hero: greeting + streak as the page's one deliberate visual
            moment, instead of a plain h1 sitting above an undifferentiated
            grid of identical cards. Numbers get to be genuinely large —
            this is the one place on the page that earns it. */}
        <div className="flex flex-col gap-8 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{greeting}</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">{firstName}</h1>
            <p className="mt-2 text-sm text-muted-foreground">Today's goal: 10 questions</p>
          </div>
          <div className="flex gap-8">
            <div>
              <div className="text-4xl font-bold tabular-nums leading-none">
                {gami ? gami.currentStreak : "—"}
              </div>
              <div className="mt-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Day streak
              </div>
            </div>
            <div>
              <div className="text-4xl font-bold tabular-nums leading-none text-primary">
                {gami ? gami.xp : "—"}
              </div>
              <div className="mt-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                XP
              </div>
            </div>
            <div>
              <div className="text-4xl font-bold tabular-nums leading-none">
                {gami ? `#${gami.rank}` : "—"}
              </div>
              <div className="mt-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Rank
              </div>
            </div>
          </div>
        </div>

        {isAdmin && (
          <div className="mt-8 rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-5">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <h2 className="font-semibold text-amber-700 dark:text-amber-400">Admin Tools</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Logged in as {user?.role} — these panels are hidden from regular students.
            </p>
            {/* CORRECTION: an earlier version of this section linked to
                "/review", assuming it was an admin moderation queue. It is
                not — /review is the STUDENT-facing spaced-repetition
                practice queue (backend/src/review/review.service.ts,
                ReviewCard/dueAt/intervalDays/easeFactor — SM-2 style
                revision of a student's own wrong answers). Only linking to
                pages that are genuinely admin-only and already built. */}
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <a href="/admin" className="group rounded-lg border border-border/60 bg-card px-4 py-3 transition hover:border-amber-500/40">
                <div className="text-sm font-semibold group-hover:text-amber-600 dark:group-hover:text-amber-400">Admin Panel</div>
                <div className="mt-0.5 text-xs text-muted-foreground">Users, plans, bulk question upload</div>
              </a>
              {/* SESSION 13 FIX: backend/src/pdf-ingestion/pdf-ingestion.controller.ts
                  had 15 working endpoints (upload, batch progress, chunk retry,
                  approve/reject, translation queue) with NO frontend page at all —
                  an admin could not upload a single PDF through the UI. Now wired
                  to /admin/pdf-studio. */}
              <a href="/admin/pdf-studio" className="group rounded-lg border border-border/60 bg-card px-4 py-3 transition hover:border-amber-500/40">
                <div className="text-sm font-semibold group-hover:text-amber-600 dark:group-hover:text-amber-400">PDF Ingestion Studio</div>
                <div className="mt-0.5 text-xs text-muted-foreground">Upload PDFs, track batches, review AI-drafted questions</div>
              </a>
              <a href="/verification" className="group rounded-lg border border-border/60 bg-card px-4 py-3 transition hover:border-amber-500/40">
                <div className="text-sm font-semibold group-hover:text-amber-600 dark:group-hover:text-amber-400">Question Verification</div>
                <div className="mt-0.5 text-xs text-muted-foreground">Approve/reject questions, ingestion batches, solver recompute</div>
              </a>
              {/* SESSION 13 FIX: backend/src/report-error already had the full
                  student-report review workflow (list/resolve/unsuspend) working —
                  students could report a wrong question via /quiz, but no admin
                  page existed to see or act on those reports. Now wired to
                  /admin/error-reports. */}
              <a href="/admin/error-reports" className="group rounded-lg border border-border/60 bg-card px-4 py-3 transition hover:border-amber-500/40">
                <div className="text-sm font-semibold group-hover:text-amber-600 dark:group-hover:text-amber-400">Error Reports</div>
                <div className="mt-0.5 text-xs text-muted-foreground">Review student-reported errors, unsuspend flagged questions</div>
              </a>
              {/* SESSION 13 FIX: GET /bank/admin/coverage (backend/src/bank/bank.service.ts
                  contentCoverageReport()) already ran the full exam×subject ×
                  translation-coverage SQL — nobody could see the result without
                  querying the DB by hand. Now wired to /admin/coverage. */}
              <a href="/admin/coverage" className="group rounded-lg border border-border/60 bg-card px-4 py-3 transition hover:border-amber-500/40">
                <div className="text-sm font-semibold group-hover:text-amber-600 dark:group-hover:text-amber-400">Content Coverage</div>
                <div className="mt-0.5 text-xs text-muted-foreground">Exam × subject counts and Hindi translation coverage</div>
              </a>
              {/* SESSION 14 FIX (pending item #1 from Session 13's handoff):
                  bank-upload.service.ts's validateReferences() requires a
                  pre-existing chapterId on every uploaded question row and
                  never creates one on the fly — but nothing in the UI could
                  create a chapter, which blocked Bulk Question Upload
                  entirely on any subject with zero chapters. Backend
                  (bank.controller.ts GET/POST /bank/admin/chapters) already
                  existed; now wired to /admin/chapters. */}
              <a href="/admin/chapters" className="group rounded-lg border border-border/60 bg-card px-4 py-3 transition hover:border-amber-500/40">
                <div className="text-sm font-semibold group-hover:text-amber-600 dark:group-hover:text-amber-400">Chapter Management</div>
                <div className="mt-0.5 text-xs text-muted-foreground">Create chapters so Bulk Upload has a valid chapterId to target</div>
              </a>
              {/* NEW ("chapter mein bhi topic hona tha jaise English mein
                  Noun, Pronoun — vesa har subject mein"): Topic model
                  already existed but had no create UI anywhere, mirroring
                  the exact gap Chapter Management above once had. Now
                  wired to /admin/topics. */}
              <a href="/admin/topics" className="group rounded-lg border border-border/60 bg-card px-4 py-3 transition hover:border-amber-500/40">
                <div className="text-sm font-semibold group-hover:text-amber-600 dark:group-hover:text-amber-400">Topic Management</div>
                <div className="mt-0.5 text-xs text-muted-foreground">Chapter ke andar topics banayein for topic-level analysis</div>
              </a>
              {/* NEW ("admin pura ek ek question ko dekh paye"): every
                  Excel/CSV/JSON/Word bulk-upload question that goes
                  PENDING (missing Hindi translation) had no review queue
                  anywhere — the existing approve/reject endpoints are
                  strictly PDF-ingestion-batch-scoped and never see these.
                  Now wired to /admin/questions/review. */}
              <a href="/admin/questions/review" className="group rounded-lg border border-border/60 bg-card px-4 py-3 transition hover:border-amber-500/40">
                <div className="text-sm font-semibold group-hover:text-amber-600 dark:group-hover:text-amber-400">Question Review</div>
                <div className="mt-0.5 text-xs text-muted-foreground">Pending questions (missing Hindi, etc.) — edit/approve/reject</div>
              </a>
              {/* ROOT-CAUSE FIX: there was NO way anywhere in the app —
                  backend or frontend — to create an Exam (SSC CGL, SSC CHSL,
                  etc.) itself. bank.service.ts's meta() (powers "Choose Your
                  Exam" below) and tests.service.ts's sectionalExamForFamily()
                  both depend entirely on Exam rows existing; without this
                  page an admin had no recovery path if an exam was missing
                  or misconfigured except direct database access. Now wired
                  to /admin/exams (backend/src/admin/admin.controller.ts
                  listExams()/createExam()/updateExam()). */}
              <a href="/admin/exams" className="group rounded-lg border border-border/60 bg-card px-4 py-3 transition hover:border-amber-500/40">
                <div className="text-sm font-semibold group-hover:text-amber-600 dark:group-hover:text-amber-400">Exam Management</div>
                <div className="mt-0.5 text-xs text-muted-foreground">Create/activate exams — required before they appear for students</div>
              </a>
              {/* BUG FIX: backend/src/admin/admin-help.controller.ts's
                  GET /admin/help/formats and /admin/help/prompts (upload
                  format cheatsheet + AI-prompt templates for generating
                  questions/explanations) were fully built but never called
                  from anywhere in the frontend — only /admin/help/templates/*
                  (the file downloads) was wired, inside the Bulk Upload
                  section on /admin. There was no dedicated "Help" page or
                  dashboard tile at all. Now wired to /admin/help. */}
              <a href="/admin/help" className="group rounded-lg border border-border/60 bg-card px-4 py-3 transition hover:border-amber-500/40">
                <div className="text-sm font-semibold group-hover:text-amber-600 dark:group-hover:text-amber-400">Admin Help</div>
                <div className="mt-0.5 text-xs text-muted-foreground">Upload format cheatsheet + ready-to-use AI prompts</div>
              </a>
            </div>
          </div>
        )}

        {/* Primary action zone: the exam picker is the thing every student
            actually needs first, so it gets the dominant position and a
            visual treatment distinct from the utility tiles below —
            instead of being one card among a dozen identical ones. */}
        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-6 lg:col-span-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">Choose your exam</h2>
              <span className="text-xs text-muted-foreground">PYQs · mocks · sectional</span>
            </div>
            {/* BUG FIX: when the exams-with-questions API call fails, is
                still loading, or every exam simply has too few approved
                questions so far, examsWithQuestions stays an empty array —
                always show a fallback so there's at least one way forward:
                a direct link into the full question bank, which works with
                no exam filter.
                UX FIX: each exam card used to link straight into the raw
                question-bank browser and nowhere else. Clicking an exam
                gave no way to reach that exam's sectional practice, mocks,
                or year-wise PYQs from here — a student had to already know
                those separate tiles existed further up this page.
                /mocks and /sectional don't accept an exam-scoped URL param
                today (mocks are listed globally by template; sectional's
                subject picker isn't exam-filtered — see backend/src/tests/
                tests.service.ts sectionalSubjects()), so rather than
                silently building a link those pages would ignore, each card
                now lists all 3 real entry points with an honest label on
                which are exam-specific right now vs. exam-selectable once
                you're on that page. */}
            {examsWithQuestions.length > 0 ? (
              <div className="mt-5 divide-y divide-border">
                {examsWithQuestions.map((e) => (
                  <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{e.name}</span>
                        {/* NEW ("sabhi SSC exams ko bhi pattern year ke
                            saath dikhana he"): every exam with an active
                            ExamPattern now shows its year/pattern label
                            here, not just CGL. */}
                        {e.patternYear && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                            {e.patternYear}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {e.count}+ questions available
                        {e.totalQuestions ? ` · ${e.totalQuestions} Qs in real paper` : ""}
                        {e.durationMinutes ? ` · ${e.durationMinutes} min` : ""}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-sm">
                      <a
                        href={`/question-bank?exam=${encodeURIComponent(e.id)}`}
                        className="rounded-lg border border-border px-3 py-1.5 font-medium hover:border-primary hover:text-primary"
                      >
                        Browse PYQs
                      </a>
                      <a href="/year-wise" className="rounded-lg border border-border px-3 py-1.5 font-medium hover:border-primary hover:text-primary">
                        Year-wise
                      </a>
                      <a href="/sectional" className="rounded-lg border border-border px-3 py-1.5 font-medium hover:border-primary hover:text-primary">
                        Sectional
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                Exam list is still loading or being set up.{" "}
                <a href="/question-bank" className="font-semibold text-primary underline">
                  Browse the full question bank instead →
                </a>
              </div>
            )}
          </div>

          {/* Premium / subscription gets the one accent-color highlight on
              this page — it's the one thing worth genuinely standing out,
              rather than every tile competing for attention with its own
              colored border. */}
          <a
            href="/premium"
            className={`flex flex-col justify-between rounded-2xl p-6 transition hover:shadow-md ${
              subscription?.active
                ? "border border-emerald-500/30 bg-emerald-500/[0.04]"
                : "border border-primary/30 bg-gradient-to-br from-primary/[0.06] to-transparent hover:border-primary/50"
            }`}
          >
            <div>
              <h2 className="text-lg font-semibold">
                {subscription?.active ? "Premium active" : "Go Premium"}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {subscription?.active
                  ? `${subscription.plan?.name || "Plan"}${subscription.endsAt ? ` — until ${new Date(subscription.endsAt).toLocaleDateString()}` : ""}`
                  : "Unlimited mocks, sectional tests & PYQs."}
              </p>
            </div>
            <span className={`mt-4 text-sm font-semibold ${subscription?.active ? "text-emerald-600 dark:text-emerald-400" : "text-primary"}`}>
              {subscription?.active ? "Manage plan →" : "See plans & pricing →"}
            </span>
          </a>
        </div>

        {/* Test formats — a quiet, equal-weight row since these are peers
            of each other, not competing for hierarchy the way the exam
            picker above does. */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <a href="/mocks" className="rounded-xl border border-border bg-card p-5 transition hover:border-primary/40">
            <h3 className="font-semibold">Mock Tests</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">Full-length timed mocks, a few free per exam.</p>
          </a>
          <a href="/sectional" className="rounded-xl border border-border bg-card p-5 transition hover:border-primary/40">
            <h3 className="font-semibold">Sectional Practice</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">Pick a subject, get a multi-year mixed set.</p>
          </a>
          <a href="/cgl-test" className="rounded-xl border border-border bg-card p-5 transition hover:border-primary/40">
            <h3 className="font-semibold">Full Sectional Paper (CGL)</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">Real exam-format mock — sections, per-section timer.</p>
          </a>
          <a href="/year-wise" className="rounded-xl border border-border bg-card p-5 transition hover:border-primary/40">
            <h3 className="font-semibold">Year-wise PYQ Test</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">Choose exam + year, narrow to subject or chapter.</p>
          </a>
        </div>

        {/* Utilities: distinguished from the primary flows above by a
            quieter, unbordered list treatment — same information, lower
            visual weight, since these are secondary to actually studying. */}
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border/60 bg-card/50 p-5">
            <h3 className="text-sm font-semibold">Weak areas practice</h3>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Auto-generated from your wrong & skipped questions.
            </p>
            <a href="/weak-practice" className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">
              Start practice →
            </a>
          </div>
          <div className="rounded-xl border border-border/60 bg-card/50 p-5">
            <h3 className="text-sm font-semibold">Leaderboard</h3>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Climb the ranks with XP from tests & daily quizzes.
            </p>
            <a href="/leaderboard" className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">
              View leaderboard →
            </a>
          </div>
          <div className="rounded-xl border border-border/60 bg-card/50 p-5">
            <h3 className="text-sm font-semibold">Refer & earn</h3>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Free subscription when 10 friends buy using your code.
            </p>
            <a href="/referral" className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">
              Invite friends →
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
