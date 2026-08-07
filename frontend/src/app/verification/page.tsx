"use client";

import * as React from "react";

type VerifStats = {
  stats: Record<string, number>;
  total: number;
};

type QRow = {
  id: string;
  questionText: string;
  answerVerificationStatus: string;
  lastVerifiedAt?: string | null;
};

const STATUS_META: Record<string, { label: string; cls: string; badge: string }> = {
  VERIFIED_OFFICIAL: {
    label: "Matches SSC's official answer key",
    cls: "bg-success/15 text-success border-success/30",
    badge: "✅ VERIFIED · OFFICIAL",
  },
  VERIFIED_MULTI_SOURCE: {
    label: "Cross-verified from 2+ sources",
    cls: "bg-info/15 text-info border-info/30",
    badge: "🔵 VERIFIED · MULTI-SOURCE",
  },
  VERIFIED_COMPUTED: {
    label: "Answer re-derived independently",
    cls: "bg-warning/15 text-warning border-warning/30",
    badge: "🟡 VERIFIED · COMPUTED",
  },
  UNVERIFIED_SINGLE_SOURCE: {
    label: "Single source — pending review",
    cls: "bg-muted text-muted-foreground border-border",
    badge: "⚪ UNVERIFIED",
  },
  DISPUTED: {
    label: "Sources disagree — needs review",
    cls: "bg-danger/15 text-danger border-danger/30",
    badge: "🔴 DISPUTED",
  },
};

export default function VerificationPage() {
  const [stats, setStats] = React.useState<VerifStats | null>(null);
  const [questions, setQuestions] = React.useState<QRow[]>([]);
  const [user, setUser] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);

  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
  const headers = () => {
    const t = localStorage.getItem("ssc_access_token");
    return { Authorization: `Bearer ${t}` };
  };

  React.useEffect(() => {
    const raw = localStorage.getItem("ssc_user");
    if (raw) { try { setUser(JSON.parse(raw)); } catch {} }
    loadAll();
  }, []);

  const loadAll = async () => {
    try {
      const [s, q] = await Promise.all([
        fetch(`${apiBase}/bank/verification-stats`, { headers: headers() }).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/bank/questions?take=20`, { headers: headers() }).then(r => r.ok ? r.json() : null),
      ]);
      setStats(s);
      setQuestions(q?.data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const updateStatus = async (qid: string, status: string) => {
    try {
      const r = await fetch(`${apiBase}/bank/questions/${qid}/verify`, {
        method: "PUT",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (r.ok) loadAll();
    } catch (e) { console.error(e); }
  };

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-muted-foreground">Loading verification data...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">← <span className="text-primary">SSC</span>PrepHub</a>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">Accuracy Dashboard</span>
            <a href="/dashboard" className="btn btn-outline">Dashboard</a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-2xl font-bold">✅ Answer Accuracy Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Zero-error promise: every published question is verified against official keys or cross-checked sources.
        </p>

        {/* Stats cards */}
        {stats && (
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {Object.entries(stats.stats).map(([status, count]) => {
              const meta = STATUS_META[status] || STATUS_META.UNVERIFIED_SINGLE_SOURCE;
              return (
                <div key={status} className={`card border p-5 ${meta.cls}`}>
                  <p className="text-xs font-semibold">{meta.badge}</p>
                  <p className="mt-2 text-3xl font-extrabold">{count}</p>
                  <p className="mt-1 text-xs opacity-80">{meta.label}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* Questions list with badges */}
        <div className="mt-10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Recent Questions &amp; Verification Status</h2>
            <span className="text-xs text-muted-foreground">{questions.length} shown</span>
          </div>

          <div className="mt-4 space-y-3">
            {questions.length === 0 && (
              <p className="card p-6 text-center text-sm text-muted-foreground">No questions found.</p>
            )}
            {questions.map((q) => {
              const meta = STATUS_META[q.answerVerificationStatus] || STATUS_META.UNVERIFIED_SINGLE_SOURCE;
              return (
                <div key={q.id} className="card flex flex-wrap items-center justify-between gap-3 p-5">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium">{q.questionText}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {meta.badge} · Last verified: {q.lastVerifiedAt ? new Date(q.lastVerifiedAt).toLocaleDateString() : "Never"}
                    </p>
                  </div>
                  {user?.role === "ADMIN" ? (
                    <select
                      value={q.answerVerificationStatus}
                      onChange={e => updateStatus(q.id, e.target.value)}
                      className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold"
                    >
                      {Object.keys(STATUS_META).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : (
                    <span className={`rounded-full border px-3 py-1 text-xs font-bold ${meta.cls}`}>
                      {q.answerVerificationStatus.replace(/_/g, " ")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Trust section */}
        <div className="card mt-10 border-primary/30 bg-primary/5 p-6">
          <h2 className="font-bold text-primary">🛡️ Our Accuracy Promise</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>• Official SSC answer keys are always the ground truth (VERIFIED_OFFICIAL)</li>
            <li>• Questions without official keys are cross-verified from 2+ independent sources</li>
            <li>• Quant &amp; Reasoning answers are independently re-computed</li>
            <li>• Disputed answers never go live — they route to priority admin review</li>
            <li>• Every correction is logged with full audit history</li>
          </ul>
        </div>
      </main>
    </div>
  );
}