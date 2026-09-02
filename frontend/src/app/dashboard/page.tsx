"use client";

import * as React from "react";
import { ThemeContext } from "@/components/theme-provider";
import { API_BASE } from "@/lib/api";

export default function DashboardPage() {
  const { theme, toggleTheme } = React.useContext(ThemeContext);
  const [user, setUser] = React.useState<{
    fullName: string;
    email: string;
    role?: string;
  } | null>(null);
  const [gami, setGami] = React.useState<{ currentStreak: number; longestStreak: number; xp: number; coins: number; hintQuota: number; rank: number } | null>(null);
  // v7 §2 — pattern label comes from ExamPattern (meta), never hardcoded
  const [cglPattern, setCglPattern] = React.useState<string | null>(null);
  const [examsWithQuestions, setExamsWithQuestions] = React.useState<Array<{id: string; name: string; count: number}>>([]);
  const [subscription, setSubscription] = React.useState<{ active: boolean; plan?: { name: string; priceInr: number }; endsAt?: string } | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/bank/meta`);
        const d = await r.json();
        const cgl = (Array.isArray(d?.exams) ? d.exams : []).find((e: any) => e.slug === "cgl");
        if (cgl?.pattern?.name) {
          const m = cgl.pattern.name.match(/\((\d{4})\)/);
          setCglPattern(m ? `${m[1]} Pattern` : cgl.pattern.name);
        }
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
          setExamsWithQuestions(exams.map((e: any) => ({ id: e.id, name: e.name, count: e.count })));
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
    const token = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
    if (token) {
      fetch(`${API_BASE}/gamification/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setGami(d))
        .catch(() => undefined);
      // Subscription status — was previously fetched nowhere on the
      // dashboard, so there was no visible "you're on the free plan" /
      // "Premium active until X" indicator anywhere the student would
      // actually see it day-to-day.
      fetch(`${API_BASE}/payments/subscription`, {
        headers: { Authorization: `Bearer ${token}` },
      })
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

  const stats = [
    { label: "Your Rank", value: gami ? `#${gami.rank}` : "—" },
    { label: "XP Points", value: gami ? `${gami.xp}` : "—" },
    { label: "Study Streak", value: gami ? `🔥 ${gami.currentStreak} days` : "—" },
    { label: "Best Streak", value: gami ? `${gami.longestStreak} days` : "—" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <span className="text-lg font-bold">
            SSC<span className="text-primary">PrepHub</span>
          </span>
          <div className="flex items-center gap-3 text-sm">
            <button
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="rounded-lg border border-border p-2 text-sm"
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
            <span className="hidden font-medium sm:block">
              {user?.fullName || "Student"}
            </span>
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

      <main className="mx-auto max-w-7xl px-4 py-8">
        <h1 className="text-2xl font-bold">
          Namaste, {user?.fullName?.split(" ")[0] || "Student"} 👋
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your daily practice goal: 10 questions
        </p>

        {isAdmin && (
          <div className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
            <h2 className="font-semibold text-amber-600 dark:text-amber-400">
              🛠️ Admin Tools
            </h2>
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
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <a
                href="/admin"
                className="rounded-lg border border-border bg-card p-4 hover:border-amber-500/50 hover:shadow-md transition"
              >
                <div className="font-semibold">⚙️ Admin Panel</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Users, plans, bulk question upload
                </div>
              </a>
              {/* SESSION 13 FIX: backend/src/pdf-ingestion/pdf-ingestion.controller.ts
                  had 15 working endpoints (upload, batch progress, chunk retry,
                  approve/reject, translation queue) with NO frontend page at all —
                  an admin could not upload a single PDF through the UI. Now wired
                  to /admin/pdf-studio. */}
              <a
                href="/admin/pdf-studio"
                className="rounded-lg border border-border bg-card p-4 hover:border-amber-500/50 hover:shadow-md transition"
              >
                <div className="font-semibold">📄 PDF Ingestion Studio</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Upload PDFs, track extraction batches, review AI-drafted questions
                </div>
              </a>
              <a
                href="/verification"
                className="rounded-lg border border-border bg-card p-4 hover:border-amber-500/50 hover:shadow-md transition"
              >
                <div className="font-semibold">✅ Question Verification</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Approve/reject questions, PDF ingestion batches, solver recompute
                </div>
              </a>
              {/* SESSION 13 FIX: backend/src/report-error already had the full
                  student-report review workflow (list/resolve/unsuspend) working —
                  students could report a wrong question via /quiz, but no admin
                  page existed to see or act on those reports. Now wired to
                  /admin/error-reports. */}
              <a
                href="/admin/error-reports"
                className="rounded-lg border border-border bg-card p-4 hover:border-amber-500/50 hover:shadow-md transition"
              >
                <div className="font-semibold">🚩 Error Reports</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Review student-reported errors, unsuspend auto-flagged questions
                </div>
              </a>
              {/* SESSION 13 FIX: GET /bank/admin/coverage (backend/src/bank/bank.service.ts
                  contentCoverageReport()) already ran the full exam×subject ×
                  translation-coverage SQL — nobody could see the result without
                  querying the DB by hand. Now wired to /admin/coverage. */}
              <a
                href="/admin/coverage"
                className="rounded-lg border border-border bg-card p-4 hover:border-amber-500/50 hover:shadow-md transition"
              >
                <div className="font-semibold">📊 Content Coverage</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Exam × subject question counts and Hindi translation coverage
                </div>
              </a>
              {/* SESSION 14 FIX (pending item #1 from Session 13's handoff):
                  bank-upload.service.ts's validateReferences() requires a
                  pre-existing chapterId on every uploaded question row and
                  never creates one on the fly — but nothing in the UI could
                  create a chapter, which blocked Bulk Question Upload
                  entirely on any subject with zero chapters. Backend
                  (bank.controller.ts GET/POST /bank/admin/chapters) already
                  existed; now wired to /admin/chapters. */}
              <a
                href="/admin/chapters"
                className="rounded-lg border border-border bg-card p-4 hover:border-amber-500/50 hover:shadow-md transition"
              >
                <div className="font-semibold">🧩 Chapter Management</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Create chapters so Bulk Question Upload has a valid chapterId to target
                </div>
              </a>
            </div>
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-border bg-card p-5"
            >
              <div className="text-2xl font-extrabold">{s.value}</div>
              <div className="mt-1 text-sm text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        {/* FIX: previously the dashboard had no link to Mock Tests, no
            subscription status, and no "Buy Premium" call-to-action
            anywhere — a logged-in student had no visible way to find
            /mocks or /premium at all unless they already knew the URL. */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <a
            href="/mocks"
            className="rounded-xl border border-border bg-card p-5 hover:border-primary/50 hover:shadow-md transition"
          >
            <h2 className="font-semibold">📝 Mock Tests</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Full-length timed mocks — a few free per exam, unlock more anytime.
            </p>
          </a>
          <a
            href="/premium"
            className={`rounded-xl border p-5 hover:shadow-md transition ${
              subscription?.active
                ? "border-emerald-500/40 bg-emerald-500/5"
                : "border-primary/40 bg-primary/5 hover:border-primary"
            }`}
          >
            <h2 className="font-semibold">
              {subscription?.active ? "⭐ Premium Active" : "🚀 Go Premium"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {subscription?.active
                ? `${subscription.plan?.name || "Plan"} — active${subscription.endsAt ? ` until ${new Date(subscription.endsAt).toLocaleDateString()}` : ""}`
                : "Unlimited mocks, sectional tests & PYQs — see plans & pricing."}
            </p>
          </a>
        </div>

        {/* BUGFIX (student-facing "test nahi de pa raha" audit): /sectional,
            /cgl-test, and /year-wise are all fully working, server-verified
            test-taking flows (timer, autosave, submit, full attemptDetail()
            analysis) — but NONE of them had a dashboard link. A student had
            no way to reach them unless they already knew the exact URL, so
            in practice these features were dead to every real user even
            though the code behind them worked. Added here, same card
            pattern as Mock Tests/Premium above. */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <a
            href="/sectional"
            className="rounded-xl border border-border bg-card p-5 hover:border-primary/50 hover:shadow-md transition"
          >
            <h2 className="font-semibold">🧩 Sectional Practice</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick a subject, get a multi-year mixed set — quick focused practice.
            </p>
          </a>
          <a
            href="/cgl-test"
            className="rounded-xl border border-border bg-card p-5 hover:border-primary/50 hover:shadow-md transition"
          >
            <h2 className="font-semibold">📄 Full Sectional Paper (CGL)</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Real exam-format sectional mock — sections, per-section timer, language toggle.
            </p>
          </a>
          <a
            href="/year-wise"
            className="rounded-xl border border-border bg-card p-5 hover:border-primary/50 hover:shadow-md transition"
          >
            <h2 className="font-semibold">📅 Year-wise PYQ Test</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose exam + year, optionally narrow to subject/chapter/topic, or attempt the full paper.
            </p>
          </a>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-border bg-card p-6 lg:col-span-2">
            <h2 className="font-semibold">📚 Choose Your Exam</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Select an exam to see its PYQs, mock tests, and sectional practice
            </p>
            {/* BUG FIX: when the exams-with-questions API call fails, is
                still loading, or every exam simply has fewer than 100
                approved questions so far, examsWithQuestions stays an empty
                array and this whole block used to render nothing — no
                cards, no text, no link, nothing clickable ("kese click
                karu, kuch available nahi hai"). Always show a fallback so
                there's at least one way forward: a direct link into the
                full question bank, which works with no exam filter. */}
            {examsWithQuestions.length > 0 ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {examsWithQuestions.map((e) => (
                  <a
                    key={e.id}
                    href={`/question-bank?exam=${encodeURIComponent(e.id)}`}
                    className="rounded-xl border border-border bg-card p-4 hover:border-primary/50 hover:shadow-md transition"
                  >
                    <div className="font-semibold text-lg">{e.name}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {e.count}+ questions
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                Exam list is still loading or being set up.{" "}
                <a href="/question-bank" className="font-semibold text-primary underline">
                  Browse the full question bank instead →
                </a>
              </div>
            )}
          </div>
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="font-semibold">🎯 Weak Areas Practice</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Auto-generated practice from your wrong & skipped questions across all tests
            </p>
            <a
              href="/weak-practice"
              className="mt-4 inline-block rounded-lg bg-destructive px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
            >
              Start Practice
            </a>
          </div>
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="font-semibold">🏆 Leaderboard</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Climb the ranks — earn XP from tests & daily quizzes, keep your streak alive!
            </p>
            <a
              href="/leaderboard"
              className="mt-4 inline-block rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
            >
              View Leaderboard
            </a>
          </div>
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="font-semibold">Refer & Earn 🎁</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Get FREE subscription when 10 friends buy using your code!
            </p>
            <a
              href="/referral"
              className="mt-4 inline-block rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
            >
              Invite Friends
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
