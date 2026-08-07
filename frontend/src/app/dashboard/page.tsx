"use client";

import * as React from "react";

export default function DashboardPage() {
  const [user, setUser] = React.useState<{
    fullName: string;
    email: string;
  } | null>(null);

  React.useEffect(() => {
    const raw = localStorage.getItem("ssc_user");
    if (raw) {
      try {
        setUser(JSON.parse(raw));
      } catch {
        /* ignore */
      }
    }
  }, []);

  const stats = [
    { label: "Tests Attempted", value: "0" },
    { label: "Questions Solved", value: "0" },
    { label: "Avg. Accuracy", value: "—" },
    { label: "Study Streak", value: "0 days" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <span className="text-lg font-bold">
            SSC<span className="text-primary">PrepHub</span>
          </span>
          <div className="flex items-center gap-3 text-sm">
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
            <h2 className="font-semibold">Your Tests</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Attempt mocks, daily quizzes, and chapter tests — then check your weak topics.
            </p>
            <a
              href="/quiz"
              className="mt-4 mr-3 inline-block rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              📅 Daily Quiz
            </a>
            <a
              href="/mocks"
              className="mt-4 mr-3 inline-block rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              🎯 Mock Tests
            </a>
            <a
              href="/question-bank"
              className="mt-4 mr-3 inline-block rounded-lg border border-border px-5 py-2.5 text-sm font-semibold hover:bg-muted"
            >
              📚 Question Bank
            </a>
            <a
              href="/weak-topics"
              className="mt-4 inline-block rounded-lg border border-border px-5 py-2.5 text-sm font-semibold hover:bg-muted"
            >
              📊 My Weak Topics
            </a>
            <a
              href="/study-plan"
              className="mt-4 mr-3 inline-block rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              📋 My Study Plan
            </a>
            <a
              href="/verification"
              className="mt-4 inline-block rounded-lg border border-border px-5 py-2.5 text-sm font-semibold hover:bg-muted"
            >
              ✅ Accuracy Dashboard
            </a>
          </div>
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="font-semibold">Refer &amp; Earn 🎁</h2>
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
