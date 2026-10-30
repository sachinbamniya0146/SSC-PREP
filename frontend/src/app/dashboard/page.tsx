"use client";

import PlanTestBanner from "@/components/PlanTestBanner";
import { UnfinishedTests } from "@/components/UnfinishedTests";
import PremiumStatus, { type PlanState } from "@/components/PremiumStatus";
import * as React from "react";
import { AppHeader } from "@/components/AppHeader";
import { API_BASE, fetchAuth } from "@/lib/api";
import { PERMISSION_INFO, StaffPermission } from "@/lib/permissions";
import { useT } from "@/lib/i18n";
import { useFeatures } from "@/lib/features";

export default function DashboardPage() {
  const tr = useT();
  const { on } = useFeatures();
  const [user, setUser] = React.useState<{
    fullName: string;
    email: string;
    role?: string;
    permissions?: StaffPermission[];
  } | null>(null);
  const [gami, setGami] = React.useState<{
    currentStreak: number;
    longestStreak: number;
    xp: number;
    coins: number;
    hintQuota: number;
    // null for an admin / staff account: they are not on the leaderboard and have no rank
    rank: number | null;
    staff?: boolean;
    totalUsers?: number;
    today?: string;
    todayAnswered?: number;
    lastPracticeDate?: string | null;
  } | null>(null);
  // Smart study signals (all real endpoints): weak list + spaced-repetition queue.
  const [weak, setWeak] = React.useState<{ weakCount: number; top: Array<{ id: string; label: string; subjectName: string; wrongCount: number; chapterId: string | null }> } | null>(null);
  const [reviewDue, setReviewDue] = React.useState<number | null>(null);
  const [dailyGoal, setDailyGoal] = React.useState<number>(20);
  React.useEffect(() => {
    try {
      const v = parseInt(localStorage.getItem("ssc_daily_goal") || "", 10);
      if ([10, 20, 30, 50].includes(v)) setDailyGoal(v);
    } catch {
      /* storage blocked — keep default */
    }
  }, []);
  const chooseGoal = (n: number) => {
    setDailyGoal(n);
    try {
      localStorage.setItem("ssc_daily_goal", String(n));
    } catch {
      /* ignore */
    }
  };
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
  // null = still loading (the plan pill shows a fixed-size placeholder), then { active, admin?, plan?, endsAt?, daysLeft?, expiringSoon? }
  const [subscription, setSubscription] = React.useState<PlanState>(null);

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
    const readUser = () => {
      const raw = localStorage.getItem("ssc_user");
      if (raw) {
        try {
          setUser(JSON.parse(raw));
        } catch {
          /* ignore */
        }
      }
    };
    readUser();
    // SessionSync (layout) refreshes role/permissions from the server and
    // fires this event — so a student who was just given staff access sees
    // their tools without having to log out and in again.
    window.addEventListener("ssc-user-updated", readUser);
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
      fetchAuth(`${API_BASE}/bank/weak-topics`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) return;
          setWeak({
            weakCount: d.summary?.weakCount ?? 0,
            top: Array.isArray(d.weak) ? d.weak.slice(0, 3) : [],
          });
        })
        .catch(() => undefined);
      fetchAuth(`${API_BASE}/review/stats`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && typeof d.dueCount === "number" && setReviewDue(d.dueCount))
        .catch(() => undefined);
    }
    return () => window.removeEventListener("ssc-user-updated", readUser);
  }, []);

  // BUG FIX: an ADMIN/MODERATOR account saw the exact same dashboard as a
  // plain student — no link anywhere to /admin, /verification, or /review,
  // even though `user.role` was already being returned by the login API
  // and stored in localStorage ("ssc_user"). It just wasn't being read
  // here. Without this, an admin had no visible way into their own tools
  // unless they already knew the raw URLs by heart.
  const isAdmin = user?.role === "ADMIN";
  // Department staff (MODERATOR) get a small panel with only what the admin
  // granted them — not the full admin grid.
  const isStaffOnly = user?.role === "MODERATOR";
  const staffPerms: StaffPermission[] = user?.permissions ?? [];

  const answeredToday = gami?.todayAnswered ?? 0;
  const goalPct = Math.min(100, Math.round((answeredToday / dailyGoal) * 100));
  const goalDone = answeredToday >= dailyGoal;
  // Streak is "at risk" when the student has a running streak but hasn't
  // practised yet today (IST day, same rule as the server).
  const istKey = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const practisedToday = !!(gami?.lastPracticeDate && gami?.today && istKey(gami.lastPracticeDate) === gami.today);
  const streakAtRisk = !!gami && gami.currentStreak > 0 && !practisedToday;

  const firstName = user?.fullName?.split(" ")[0] || "Student";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="min-h-screen bg-background">
      <AppHeader name={user?.fullName} />

      <main className="container-page py-8 sm:py-10">
        <PlanTestBanner />
        <UnfinishedTests className="mb-6" />

        {/* Greeting + live stats */}
        <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 sm:p-8">
          <div className="hero-bg pointer-events-none absolute inset-0 opacity-70" />
          <div className="relative grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="text-sm font-medium text-muted-foreground">{greeting}</p>
              <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">{firstName}</h1>

              {/* Daily goal */}
              {on("dailyGoal") && (
              <div className="mt-4 max-w-md">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-semibold">
                    {goalDone ? tr("Daily goal complete 🎉", "Aaj ka goal complete 🎉") : tr("Today's goal", "Aaj ka goal")}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {answeredToday} / {dailyGoal} {tr("questions", "sawal")}
                  </span>
                </div>
                <div
                  className="mt-2 h-2.5 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={goalPct}
                  aria-label="Daily goal progress"
                >
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${goalDone ? "bg-success" : "bg-primary"}`}
                    style={{ width: `${goalPct}%` }}
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{tr("Daily target:", "Roz ka target:")}</span>
                  {[10, 20, 30, 50].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => chooseGoal(n)}
                      aria-pressed={dailyGoal === n}
                      className={`rounded-full border px-2.5 py-0.5 font-semibold transition ${
                        dailyGoal === n ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/50"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              )}

              {streakAtRisk && (
                <p className="mt-4 inline-flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm font-medium">
                  🔥 {tr(
                    `Your ${gami!.currentStreak}-day streak ends tonight — answer a few questions to keep it alive.`,
                    `Aapka ${gami!.currentStreak} din ka streak aaj raat khatam ho sakta hai — kuch sawal solve karke bachaiye.`,
                  )}
                </p>
              )}

              <div className="mt-5 flex flex-wrap gap-2">
                <a href="/question-bank-practice" className="btn btn-primary">{tr("Start practice", "Practice shuru karein")}</a>
                <a href="/mocks" className="btn btn-outline">{tr("Take a mock", "Mock dein")}</a>
                <PremiumStatus subscription={subscription} className="self-center" />
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-3 sm:gap-4">
              {[
                { l: "Day streak", v: gami ? gami.currentStreak : "—", tone: "text-accent" },
                { l: "XP", v: gami ? gami.xp : "—", tone: "text-primary" },
                { l: "Rank", v: gami && gami.rank != null ? `#${gami.rank}` : "—", tone: "text-foreground" },
              ].map((x) => (
                <div key={x.l} className="min-w-[5.5rem] rounded-xl border border-border bg-background/80 px-4 py-3 text-center backdrop-blur">
                  <dd className={`text-2xl font-extrabold tabular-nums leading-none sm:text-3xl ${x.tone}`}>{x.v}</dd>
                  <dt className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{x.l}</dt>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Today's smart plan — built from the student's own data */}
        {!isStaffOnly && (
          <section className="mt-6 grid gap-3 md:grid-cols-3" aria-label="Today's plan">
            <a href="/review" className="card card-hover p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">🔁 {tr("Revision queue", "Revision queue")}</h3>
                <span className={`badge ${reviewDue ? "badge-primary" : "badge-success"}`}>
                  {reviewDue === null ? "…" : reviewDue > 0 ? `${reviewDue} ${tr("due", "baaki")}` : tr("All clear", "Sab clear")}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {reviewDue
                  ? tr("Questions you got wrong come back at the right time — revise them before you forget.", "Galat hue sawal sahi samay par wapas aate hain — bhoolne se pehle revise karein.")
                  : tr("Nothing due right now. Wrong answers will show up here automatically.", "Abhi kuch baaki nahi. Galat jawab yahan apne aap aa jayenge.")}
              </p>
            </a>
            <a href="/weak-topics" className="card card-hover p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">🎯 {tr("Weak topics", "Kamzor topics")}</h3>
                <span className={`badge ${weak && weak.weakCount > 0 ? "badge-danger" : "badge-success"}`}>
                  {weak === null ? "…" : weak.weakCount > 0 ? weak.weakCount : "0"}
                </span>
              </div>
              {weak && weak.top.length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {weak.top.map((w) => (
                    <li key={w.id} className="truncate">
                      • {w.label || w.subjectName}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {tr("No weak topics yet — attempt a few tests and we will find them for you.", "Abhi koi kamzor topic nahi — kuch test dein, hum dhoondh denge.")}
                </p>
              )}
            </a>
            {on("vocabulary") && (
            <a href="/vocabulary" className="card card-hover p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">📖 {tr("Vocabulary", "Vocabulary")}</h3>
                <span className="badge badge-primary">{tr("Continue", "Jari rakhein")}</span>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {tr("Pick up where you stopped. Words you unlock stay unlocked.", "Jahan ruke the wahin se shuru karein. Unlock hue words unlock hi rehte hain.")}
              </p>
            </a>
            )}
          </section>
        )}

        {isStaffOnly && (
          <div className="mt-8 rounded-xl border border-primary/30 bg-primary/[0.04] p-5">
            <h2 className="font-semibold text-primary">Staff Tools</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              These departments are assigned to you.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {staffPerms.length === 0 && (
                <p className="text-sm text-muted-foreground">{tr("No department is assigned yet — please contact the admin.", "Abhi koi department assign nahi hua — admin se contact karein.")}</p>
              )}
              {staffPerms.map((p) => (
                <a
                  key={p}
                  href={PERMISSION_INFO[p].href}
                  className="group rounded-lg border border-border/60 bg-card px-4 py-3 transition hover:border-primary/40"
                >
                  <div className="text-sm font-semibold">{PERMISSION_INFO[p].emoji} {PERMISSION_INFO[p].label}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{PERMISSION_INFO[p].desc}</div>
                </a>
              ))}
            </div>
          </div>
        )}

        {isAdmin && (
          <a
            href="/admin"
            className="mt-8 flex items-center justify-between gap-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.05] p-5 transition hover:border-amber-500/60"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                <h2 className="font-semibold text-amber-700 dark:text-amber-400">Admin console</h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Users, referrals, payments, questions and support — everything in one place.
              </p>
            </div>
            <span className="btn btn-outline btn-sm shrink-0">Open →</span>
          </a>
        )}

        {/* Exam picker (the plan is now a small pill in the greeting card, see PremiumStatus) */}
        <div className="mt-8">
          <section className="card p-6">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-bold">Choose your exam</h2>
              <span className="text-xs text-muted-foreground">PYQs · mocks · sectional</span>
            </div>
            {examsWithQuestions.length > 0 ? (
              <div className="mt-4 divide-y divide-border">
                {examsWithQuestions.map((e) => (
                  <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{e.name}</span>
                        {e.patternYear && <span className="badge badge-primary">{e.patternYear}</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {e.count}+ questions available
                        {e.totalQuestions ? ` · ${e.totalQuestions} Qs in real paper` : ""}
                        {e.durationMinutes ? ` · ${e.durationMinutes} min` : ""}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <a href={`/question-bank?exam=${encodeURIComponent(e.id)}`} className="btn btn-outline btn-sm">Browse PYQs</a>
                      <a href="/year-wise" className="btn btn-outline btn-sm">Year-wise</a>
                      <a href="/sectional" className="btn btn-outline btn-sm">Sectional</a>
                    </div>
                  </div>
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
          </section>
        </div>

        {/* Main practice entry */}
        <a
          href="/question-bank-practice"
          className="card card-hover mt-6 flex flex-col gap-3 border-success/30 bg-gradient-to-br from-success/[0.07] to-transparent p-6 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <h2 className="text-lg font-bold">Practice for SSC Exams</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Subject → chapter practice sets covering the full syllabus, with your progress and accuracy tracked per chapter.
            </p>
          </div>
          <span className="btn btn-primary shrink-0 self-start sm:self-center">Start practicing →</span>
        </a>

        {/* Study tools */}
        <h2 className="mb-3 mt-10 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Study tools</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {on("studyPlan") && (
          <a href="/study-plan/board" className="card card-hover border-primary/40 bg-primary/[0.05] p-5">
            <h3 className="font-semibold">🗓️ My Study Planner</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{tr("Target exam + date, mark chapters, tomorrow's 9 AM test, daily revision.", "Target exam + date, chapters mark karein, kal 9 AM ka test, roz ka revision.")}</p>
          </a>
          )}
          <a href="/weak-topics" className="card card-hover border-danger/30 bg-danger/[0.04] p-5">
            <h3 className="font-semibold">🎯 My Weak List</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{tr("Chapters / topics / sub-topics you got wrong — strengthen them one by one.", "Galat hue chapter / topic / sub-topic — ek-ek ko strong karein.")}</p>
          </a>
          <a href="/mocks" className="card card-hover p-5">
            <h3 className="font-semibold">Mock Tests</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{tr("Full-length timed mocks — every previous-year paper is free.", "Full-length timed mocks — har previous-year paper free hai.")}</p>
          </a>
          <a href="/sectional" className="card card-hover p-5">
            <h3 className="font-semibold">Sectional Practice</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">Pick a subject, get a multi-year mixed set.</p>
          </a>
          <a href="/cgl-test" className="card card-hover p-5">
            <h3 className="font-semibold">Full Sectional Paper (CGL)</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">Real exam-format mock — sections, per-section timer.</p>
          </a>
          <a href="/year-wise" className="card card-hover p-5">
            <h3 className="font-semibold">Year-wise PYQ Test</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">Choose exam + year, narrow to subject or chapter.</p>
          </a>
          {on("vocabulary") && (
          <a href="/vocabulary" className="card card-hover p-5">
            <h3 className="font-semibold">📖 Vocabulary Mastery</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">Learn one word at a time — quiz, 95%+ to unlock the next.</p>
          </a>
          )}
        </div>

        {/* Utilities */}
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            { t: "Weak areas practice", d: "Auto-generated from your wrong & skipped questions.", h: "/weak-practice", c: "Start practice →" },
            ...(on("leaderboard") ? [{ t: "Leaderboard", d: "Climb the ranks with XP from tests & daily quizzes. See your State rank too.", h: "/leaderboard", c: "View leaderboard →" }] : []),
            { t: "My bookmarks", d: "Questions you starred in tests and reviews - with notes and a one-tap practice set.", h: "/bookmarks", c: "Open bookmarks →" },
            ...(on("referral") ? [{ t: "Refer & earn", d: "Free subscription when 10 friends buy using your code.", h: "/referral", c: "Invite friends →" }] : []),
          ].map((u) => (
            <div key={u.h} className="card p-5">
              <h3 className="text-sm font-semibold">{u.t}</h3>
              <p className="mt-1.5 text-xs text-muted-foreground">{u.d}</p>
              <a href={u.h} className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">{u.c}</a>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
