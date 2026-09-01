"use client";

// Error Report Resolution panel — admin UI for backend/src/report-error.
//
// SESSION 13 FIX: the entire student→admin error-report loop already worked
// end-to-end on the backend (POST /report-error is called live from
// frontend/src/app/quiz/page.tsx, and a question auto-suspends once it hits
// SOFT_SUSPEND_THRESHOLD=3 open reports) — but there was no admin page to
// ever SEE those reports or resolve them. Auto-suspended questions had no
// way back into rotation except a raw DB update. This page closes the loop:
// list reports (filterable by status), resolve CONFIRMED/REJECTED, and
// manually unsuspend a question once it's fixed.

import * as React from "react";
import { useRouter } from "next/navigation";
import { API_BASE, fetchAuth } from "@/lib/api";

type ReportRow = {
  id: string;
  category: string;
  description: string;
  status: "OPEN" | "REVIEWING" | "CONFIRMED" | "REJECTED";
  createdAt: string;
  adminNotes?: string | null;
  question: {
    id: string;
    questionText: string;
    correctAnswer: string;
    year: number | null;
    shift: string | null;
    autoSuspended: boolean;
    errorReportCount: number;
    exam?: { name: string } | null;
  };
  user: { id: string; fullName: string; email: string };
};

type CategoryStats = {
  total: number;
  byCategory: { category: string; count: number; open: number }[];
};

const STATUS_BADGE: Record<string, string> = {
  OPEN: "bg-warning/15 text-warning border-warning/30",
  REVIEWING: "bg-info/15 text-info border-info/30",
  CONFIRMED: "bg-danger/15 text-danger border-danger/30",
  REJECTED: "bg-muted text-muted-foreground border-border",
};

export default function ErrorReportsPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = React.useState(false);
  const [reports, setReports] = React.useState<ReportRow[]>([]);
  const [stats, setStats] = React.useState<CategoryStats | null>(null);
  const [statusFilter, setStatusFilter] = React.useState("OPEN");
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState("");
  const [err, setErr] = React.useState("");
  const [msg, setMsg] = React.useState("");

  const headers = React.useCallback(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") : "";
    return { Authorization: `Bearer ${t || ""}` };
  }, []);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem("ssc_user");
      const user = raw ? JSON.parse(raw) : null;
      const isAdmin = user?.role === "ADMIN" || user?.role === "MODERATOR";
      if (!isAdmin) {
        router.replace("/dashboard");
        return;
      }
    } catch {
      router.replace("/dashboard");
      return;
    }
    setAuthChecked(true);
  }, [router]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set("status", statusFilter);
      const [rRes, sRes] = await Promise.all([
        fetchAuth(`${API_BASE}/report-error?${qs.toString()}`, { headers: headers() }),
        fetchAuth(`${API_BASE}/report-error/category-stats`, { headers: headers() }),
      ]);
      if (rRes.ok) {
        const d = await rRes.json();
        setReports(d.reports || []);
      }
      if (sRes.ok) setStats(await sRes.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, headers]);

  React.useEffect(() => {
    if (!authChecked) return;
    load();
  }, [authChecked, load]);

  const resolve = async (reportId: string, status: "CONFIRMED" | "REJECTED") => {
    let adminNotes: string | undefined;
    if (status === "CONFIRMED") {
      adminNotes = prompt("Confirm karne se pehle koi note (optional) — kya galat hai isme?") || undefined;
      const ok = confirm("CONFIRM karne se yeh question auto-suspended reh jaayega jab tak fix nahi hota. Continue?");
      if (!ok) return;
    }
    setBusy(reportId);
    setErr("");
    try {
      const r = await fetchAuth(`${API_BASE}/report-error/${reportId}/resolve`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ status, adminNotes }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(d?.message || "Resolve fail ho gaya");
        return;
      }
      setMsg(status === "CONFIRMED" ? "Report confirm ho gaya — question suspended hi rahega jab tak fix na ho." : "Report reject ho gaya — question ki suspension hata di gayi.");
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Resolve fail ho gaya");
    } finally {
      setBusy("");
    }
  };

  const unsuspend = async (questionId: string) => {
    const ok = confirm("Yeh question manually unsuspend karna hai? Iske sab OPEN/REVIEWING reports REJECTED ho jaayenge aur error count reset hoga.");
    if (!ok) return;
    setBusy(questionId);
    setErr("");
    try {
      const r = await fetchAuth(`${API_BASE}/report-error/question/${questionId}/unsuspend`, {
        method: "POST",
        headers: headers(),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(d?.message || "Unsuspend fail ho gaya");
        return;
      }
      setMsg(d.message || "Question unsuspend ho gaya.");
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unsuspend fail ho gaya");
    } finally {
      setBusy("");
    }
  };

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Checking access...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">← <span className="text-primary">SSC</span>PrepHub</a>
          <span className="text-sm text-muted-foreground">🚩 Error Reports</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold">🚩 Error Report Resolution</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Students ne jo questions galat report kiye hain unhe yahan review karo. 3+ open reports pe question auto-suspend ho jaata hai.
        </p>

        {stats && stats.byCategory.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-3">
            {stats.byCategory.map((c) => (
              <div key={c.category} className="card px-4 py-3">
                <p className="text-xs text-muted-foreground">{c.category.replace(/_/g, " ")}</p>
                <p className="mt-1 text-lg font-bold">
                  {c.open} <span className="text-xs font-normal text-muted-foreground">open / {c.count} total</span>
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 flex gap-2">
          {["OPEN", "REVIEWING", "CONFIRMED", "REJECTED", ""].map((s) => (
            <button
              key={s || "ALL"}
              onClick={() => setStatusFilter(s)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${statusFilter === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
            >
              {s || "ALL"}
            </button>
          ))}
        </div>

        {err && <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{err}</p>}
        {msg && <p className="mt-4 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">{msg}</p>}

        {loading ? (
          <p className="mt-6 text-sm text-muted-foreground">Loading reports...</p>
        ) : reports.length === 0 ? (
          <p className="card mt-6 p-6 text-center text-sm text-muted-foreground">Is filter mein koi report nahi hai. 🎉</p>
        ) : (
          <div className="mt-6 space-y-4">
            {reports.map((r) => (
              <div key={r.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_BADGE[r.status]}`}>{r.status}</span>
                      <span className="text-[10px] font-semibold text-muted-foreground">{r.category.replace(/_/g, " ")}</span>
                      {r.question.autoSuspended && (
                        <span className="rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[10px] font-bold text-danger">
                          ⛔ AUTO-SUSPENDED ({r.question.errorReportCount} reports)
                        </span>
                      )}
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm font-medium">{r.question.questionText}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.question.exam?.name || "—"} {r.question.year ? `· ${r.question.year}` : ""} · Correct Ans: {r.question.correctAnswer}
                    </p>
                    <p className="mt-2 rounded-lg bg-muted/50 p-2 text-xs">
                      <span className="font-semibold">{r.user.fullName}</span> ne likha: “{r.description}”
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    {(r.status === "OPEN" || r.status === "REVIEWING") && (
                      <>
                        <button
                          onClick={() => resolve(r.id, "CONFIRMED")}
                          disabled={busy === r.id}
                          className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs font-bold text-danger hover:bg-danger/20 disabled:opacity-50"
                        >
                          Confirm Error
                        </button>
                        <button
                          onClick={() => resolve(r.id, "REJECTED")}
                          disabled={busy === r.id}
                          className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-bold hover:bg-muted disabled:opacity-50"
                        >
                          Reject Report
                        </button>
                      </>
                    )}
                    {r.question.autoSuspended && (
                      <button
                        onClick={() => unsuspend(r.question.id)}
                        disabled={busy === r.question.id}
                        className="rounded-lg border border-success/40 bg-success/10 px-3 py-1.5 text-xs font-bold text-success hover:bg-success/20 disabled:opacity-50"
                      >
                        ✅ Unsuspend
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
