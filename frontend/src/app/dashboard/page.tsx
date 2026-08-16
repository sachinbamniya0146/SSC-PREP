"use client";

import * as React from "react";
import { ThemeContext } from "@/components/theme-provider";

export default function DashboardPage() {
  const { theme, toggleTheme } = React.useContext(ThemeContext);
  const [user, setUser] = React.useState<{
    fullName: string;
    email: string;
  } | null>(null);
  const [gami, setGami] = React.useState<{ currentStreak: number; longestStreak: number; xp: number; coins: number; hintQuota: number; rank: number } | null>(null);
  // v7 §2 — pattern label comes from ExamPattern (meta), never hardcoded
  const [cglPattern, setCglPattern] = React.useState<string | null>(null);
  const [examsWithQuestions, setExamsWithQuestions] = React.useState<Array<{id: string; name: string; count: number}>>([]);

  React.useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1"}/bank/meta`);
        const d = await r.json();
        const cgl = (Array.isArray(d?.exams) ? d.exams : []).find((e: any) => e.slug === "cgl");
        if (cgl?.pattern?.name) {
          const m = cgl.pattern.name.match(/\((\d{4})\)/);
          setCglPattern(m ? `${m[1]} Pattern` : cgl.pattern.name);
        }
        // Load exams with questions
        if (Array.isArray(d?.exams)) {
          const exams = d.exams.filter((e: any) => e.count > 100).sort((a: any, b: any) => b.count - a.count);
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
      fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1"}/gamification/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setGami(d))
        .catch(() => undefined);
    }
  }, []);

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

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-border bg-card p-6 lg:col-span-2">
            <h2 className="font-semibold">📚 Choose Your Exam</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Select an exam to see its PYQs, mock tests, and sectional practice
            </p>
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