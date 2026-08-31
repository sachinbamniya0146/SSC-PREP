"use client";

import * as React from "react";
import { API_BASE } from "@/lib/api";

type PlanData = {
  plan: {
    id: string;
    userId: string;
    examId: string;
    subjectId?: string | null;
    type: string;
    startDate: string;
    targetDate: string;
    dailyTarget: number;
    currentStreak: number;
    longestStreak: number;
    lastPracticeDate?: string | null;
  };
  stats?: {
    totalQuestions: number;
    remainingDays: number;
    dailyTarget: number;
  };
  progress?: {
    totalQuestions: number;
    questionsDone: number;
    remaining: number;
    percentComplete: number;
  };
};

type DailyTarget = {
  hasPlan: boolean;
  planId?: string;
  dailyTarget?: number;
  todayDone?: number;
  remaining?: number;
  totalQuestions?: number;
  remainingDays?: number;
  streak?: number;
  targetDate?: string;
  message?: string;
};

export default function StudyPlanPage() {
  const [step, setStep] = React.useState<"create" | "view">("view");
  const [plan, setPlan] = React.useState<PlanData | null>(null);
  const [daily, setDaily] = React.useState<DailyTarget | null>(null);
  const [exams, setExams] = React.useState<{ id: string; name: string }[]>([]);
  const [subjects, setSubjects] = React.useState<{ id: string; name: string }[]>([]);
  const [selectedExam, setSelectedExam] = React.useState("");
  const [selectedSubject, setSelectedSubject] = React.useState("");
  const [duration, setDuration] = React.useState("3"); // months
  const [loading, setLoading] = React.useState(true);

  const apiBase = API_BASE;
  const headers = () => {
    const t = localStorage.getItem("ssc_access_token");
    return { Authorization: `Bearer ${t}` };
  };

  const loadPlan = async () => {
    try {
      const planRes = await fetch(`${apiBase}/study-plan`, { headers: headers() });
      const planData = planRes.ok && planRes.status !== 204 ? await planRes.json().catch(() => null) : null;
      const dailyRes = await fetch(`${apiBase}/study-plan/daily-target`, { headers: headers() });
      const dailyData = dailyRes.ok && dailyRes.status !== 204 ? await dailyRes.json().catch(() => null) : null;
      const metaRes = await fetch(`${apiBase}/bank/meta`, { headers: headers() });
      const metaData = metaRes.ok ? await metaRes.json().catch(() => null) : null;
      setPlan(planData ? { plan: planData } : null);
      setDaily(dailyData && dailyData.hasPlan ? dailyData : null);
      if (metaData?.exams) setExams(metaData.exams);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { loadPlan(); }, []);

  const createPlan = async () => {
    if (!selectedExam) return alert("Please select an exam");
    const targetDate = new Date();
    targetDate.setMonth(targetDate.getMonth() + parseInt(duration));
    const body: any = { examId: selectedExam, type: "COMBINED", targetDate: targetDate.toISOString().split("T")[0] };
    if (selectedSubject) body.subjectId = selectedSubject;
    try {
      const r = await fetch(`${apiBase}/study-plan/create`, {
        method: "POST", headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) { setStep("view"); loadPlan(); }
      else alert("Failed to create plan");
    } catch { alert("Error creating plan"); }
  };

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-muted-foreground">Loading...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">← <span className="text-primary">SSC</span>PrepHub</a>
          <div className="flex items-center gap-3 text-sm">
            {!plan && <button onClick={() => setStep("create")} className="btn btn-primary">Create Plan</button>}
            <a href="/dashboard" className="btn btn-outline">Dashboard</a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10">
        {step === "create" && (
          <>
            <h1 className="text-2xl font-bold">Create Your Study Plan 📋</h1>
            <p className="mt-1 text-sm text-muted-foreground">Select exam, duration, and we'll calculate your daily target.</p>

            <div className="card mt-6 space-y-5 p-6">
              <div>
                <label className="text-sm font-medium">Select Exam</label>
                <select value={selectedExam} onChange={e => setSelectedExam(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm">
                  <option value="">Choose exam...</option>
                  {exams.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Prep Duration</label>
                <div className="mt-2 flex gap-2">
                  {["3", "6", "12"].map(m => (
                    <button key={m} onClick={() => setDuration(m)}
                      className={`flex-1 rounded-lg border px-4 py-3 text-sm font-semibold transition ${duration === m ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                      {m} Months
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={createPlan} disabled={!selectedExam}
                className="w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
                Generate Plan
              </button>
            </div>
          </>
        )}

        {step === "view" && !plan && (
          <div className="card p-10 text-center">
            <p className="text-4xl">📋</p>
            <h2 className="mt-4 text-xl font-bold">No Study Plan Yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">Create a personalised study plan to track your daily progress!</p>
            <button onClick={() => setStep("create")} className="btn btn-primary mt-6">Create Your Plan</button>
          </div>
        )}

        {step === "view" && plan && daily && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold">Your Study Plan 🎯</h1>
              <button onClick={() => setStep("create")} className="btn btn-outline text-sm">Recreate</button>
            </div>

            {/* Streak + Daily Target */}
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="card p-5 text-center">
                <p className="text-xs text-muted-foreground">🔥 Streak</p>
                <p className="mt-1 text-3xl font-bold text-warning">{daily.streak || 0} days</p>
              </div>
              <div className="card p-5 text-center">
                <p className="text-xs text-muted-foreground">Today's Target</p>
                <p className="mt-1 text-3xl font-bold text-primary">{daily.dailyTarget} Q</p>
              </div>
              <div className="card p-5 text-center">
                <p className="text-xs text-muted-foreground">Done Today</p>
                <p className="mt-1 text-3xl font-bold text-success">{daily.todayDone} Q</p>
              </div>
              <div className="card p-5 text-center">
                <p className="text-xs text-muted-foreground">Remaining</p>
                <p className="mt-1 text-3xl font-bold">{daily.remaining} Q</p>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="card p-6">
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="font-medium">Progress</span>
                <span className="text-muted-foreground">{plan.progress?.percentComplete || 0}%</span>
              </div>
              <div className="h-4 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min(plan.progress?.percentComplete || 0, 100)}%` }} />
              </div>
              <div className="mt-3 flex justify-between text-xs text-muted-foreground">
                <span>{plan.progress?.questionsDone || 0} done</span>
                <span>Target: {plan.progress?.totalQuestions || 0}</span>
              </div>
            </div>

            {/* Plan Details */}
            {/* BUGFIX: this used to show plan.plan.examId (a raw database ID
                like "ckx9a2j4b0001...") in the "Exam" row instead of the
                exam's actual name — the exact "exam ka naam nahi aa raha"
                problem, just showing up here on the study-plan page too. */}
            <div className="card divide-y divide-border overflow-hidden">
              {[
                ["Exam", exams.find((e) => e.id === plan.plan.examId)?.name || plan.plan.examId],
                ["Type", plan.plan.type === "COMBINED" ? "Combined (All Subjects)" : "Subject-wise"],
                ["Daily Target", `${plan.plan.dailyTarget} questions`],
                ["Start Date", new Date(plan.plan.startDate).toLocaleDateString()],
                ["Target Date", new Date(plan.plan.targetDate).toLocaleDateString()],
                ["Remaining Days", `${daily.remainingDays} days`],
                ["Longest Streak", `${plan.plan.longestStreak} days`],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm text-muted-foreground">{k}</span>
                  <span className="text-sm font-semibold">{v}</span>
                </div>
              ))}
            </div>

            {/* CTA */}
            {/* BUGFIX: this linked to plain "/test" (no ?daily=1), so clicking
                it never actually started the plan-based Daily Test — it fell
                through to a generic random 10-question set instead, even
                though the button text promised "N questions today" tied to
                the study plan. */}
            <a href="/test?daily=1" className="block w-full rounded-xl bg-primary py-4 text-center text-lg font-bold text-primary-foreground transition hover:opacity-90">
              🎯 Practice Now ({daily.dailyTarget} questions today)
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
