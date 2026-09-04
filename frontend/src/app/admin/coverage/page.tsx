"use client";

// Content Coverage Dashboard — admin UI for GET /bank/admin/coverage
// (backend/src/bank/bank.service.ts contentCoverageReport()).
//
// SESSION 13 FIX: this endpoint already ran the exact per-exam × per-subject
// SQL breakdown (total questions, approved-live, Hindi-translated,
// human-verified-translation) — the only report that answers "kitne
// question kis exam ke kis subject ke available hain, aur unme se kitne
// translate hue hain" in one shot. It had zero frontend; the only way to
// see it was a manual DB query. Wired here as a plain sortable table.

import * as React from "react";
import { useRouter } from "next/navigation";
import { API_BASE, fetchAuth } from "@/lib/api";

type CoverageRow = {
  examName: string | null;
  subjectName: string | null;
  totalQuestions: number;
  approvedLive: number;
  hindiTranslated: number;
  humanVerifiedTranslation: number;
};

type CoverageReport = {
  rows: CoverageRow[];
  totals: {
    totalQuestions: number;
    approvedLive: number;
    hindiTranslated: number;
    humanVerifiedTranslation: number;
  };
};

// NEW — exam × subject × YEAR breakdown ("kis exam ke kis subject key kis
// year ke kitne questions hey"). Separate type/state/tab from the
// exam×subject-only report above (GET /bank/admin/coverage/by-year).
type CoverageByYearRow = {
  examName: string | null;
  subjectName: string | null;
  year: number | null;
  totalQuestions: number;
  approvedLive: number;
  hindiTranslated: number;
};

type CoverageByYearReport = {
  rows: CoverageByYearRow[];
  totals: {
    totalQuestions: number;
    approvedLive: number;
    hindiTranslated: number;
  };
};

export default function CoveragePage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = React.useState(false);
  const [report, setReport] = React.useState<CoverageReport | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState("");
  const [examFilter, setExamFilter] = React.useState("");

  // NEW — year-wise tab state (kept separate from the exam×subject report
  // above; fetched lazily only when the admin actually opens this tab, so
  // the default page load stays exactly as fast as before).
  const [activeTab, setActiveTab] = React.useState<"subject" | "year">("subject");
  const [yearReport, setYearReport] = React.useState<CoverageByYearReport | null>(null);
  const [yearLoading, setYearLoading] = React.useState(false);
  const [yearErr, setYearErr] = React.useState("");
  const [yearExamFilter, setYearExamFilter] = React.useState("");

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

  React.useEffect(() => {
    if (!authChecked) return;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const t = localStorage.getItem("ssc_access_token") || "";
        const r = await fetchAuth(`${API_BASE}/bank/admin/coverage`, {
          headers: { Authorization: `Bearer ${t}` },
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          setErr(d?.message || `HTTP ${r.status}`);
          return;
        }
        setReport(await r.json());
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Coverage report load nahi hua");
      } finally {
        setLoading(false);
      }
    })();
  }, [authChecked]);

  // NEW — fetch the year-wise report the first time the admin opens that
  // tab (not on initial page load), same auth pattern as the effect above.
  React.useEffect(() => {
    if (!authChecked || activeTab !== "year" || yearReport || yearLoading) return;
    (async () => {
      setYearLoading(true);
      setYearErr("");
      try {
        const t = localStorage.getItem("ssc_access_token") || "";
        const r = await fetchAuth(`${API_BASE}/bank/admin/coverage/by-year`, {
          headers: { Authorization: `Bearer ${t}` },
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          setYearErr(d?.message || `HTTP ${r.status}`);
          return;
        }
        setYearReport(await r.json());
      } catch (e) {
        setYearErr(e instanceof Error ? e.message : "Year-wise report load nahi hua");
      } finally {
        setYearLoading(false);
      }
    })();
  }, [authChecked, activeTab, yearReport, yearLoading]);

  const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0);

  const exams = React.useMemo(() => {
    if (!report) return [];
    return Array.from(new Set(report.rows.map((r) => r.examName || "—"))).sort();
  }, [report]);

  const visibleRows = React.useMemo(() => {
    if (!report) return [];
    return examFilter ? report.rows.filter((r) => (r.examName || "—") === examFilter) : report.rows;
  }, [report, examFilter]);

  // NEW — same exam-filter pattern for the year-wise tab, kept as its own
  // memo/state so switching tabs never resets the other tab's filter.
  const yearExams = React.useMemo(() => {
    if (!yearReport) return [];
    return Array.from(new Set(yearReport.rows.map((r) => r.examName || "—"))).sort();
  }, [yearReport]);

  const yearVisibleRows = React.useMemo(() => {
    if (!yearReport) return [];
    return yearExamFilter ? yearReport.rows.filter((r) => (r.examName || "—") === yearExamFilter) : yearReport.rows;
  }, [yearReport, yearExamFilter]);

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
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">← <span className="text-primary">SSC</span>PrepHub</a>
          <span className="text-sm text-muted-foreground">📊 Content Coverage</span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-bold">📊 Content Coverage Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Kis exam ke kis subject mein kitne questions hain, aur unme se kitne Hindi mein translate ho chuke hain.
        </p>

        {/* NEW — tab switcher: exam×subject (existing) vs exam×subject×year (new) */}
        <div className="mt-6 flex gap-2 border-b border-border">
          <button
            onClick={() => setActiveTab("subject")}
            className={`border-b-2 px-4 py-2 text-sm font-semibold ${activeTab === "subject" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
          >
            Exam × Subject
          </button>
          <button
            onClick={() => setActiveTab("year")}
            className={`border-b-2 px-4 py-2 text-sm font-semibold ${activeTab === "year" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
          >
            Exam × Subject × Year
          </button>
        </div>

        {activeTab === "subject" && err && <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{err}</p>}

        {activeTab === "subject" && loading ? (
          <p className="mt-6 text-sm text-muted-foreground">Loading coverage report...</p>
        ) : activeTab === "subject" && report ? (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-4">
              <div className="card p-4">
                <p className="text-xs text-muted-foreground">Total Questions</p>
                <p className="mt-1 text-2xl font-bold">{report.totals.totalQuestions}</p>
              </div>
              <div className="card p-4">
                <p className="text-xs text-muted-foreground">Live (Approved &amp; Active)</p>
                <p className="mt-1 text-2xl font-bold text-success">{report.totals.approvedLive}</p>
              </div>
              <div className="card p-4">
                <p className="text-xs text-muted-foreground">Hindi Translated</p>
                <p className="mt-1 text-2xl font-bold text-info">
                  {report.totals.hindiTranslated} <span className="text-xs font-normal text-muted-foreground">({pct(report.totals.hindiTranslated, report.totals.totalQuestions)}%)</span>
                </p>
              </div>
              <div className="card p-4">
                <p className="text-xs text-muted-foreground">Human-Verified Translation</p>
                <p className="mt-1 text-2xl font-bold text-warning">{report.totals.humanVerifiedTranslation}</p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <button
                onClick={() => setExamFilter("")}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${!examFilter ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
              >
                All Exams
              </button>
              {exams.map((e) => (
                <button
                  key={e}
                  onClick={() => setExamFilter(e)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${examFilter === e ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                >
                  {e}
                </button>
              ))}
            </div>

            <div className="card mt-4 overflow-x-auto p-0">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Exam</th>
                    <th className="px-4 py-3">Subject</th>
                    <th className="px-4 py-3">Total</th>
                    <th className="px-4 py-3">Live</th>
                    <th className="px-4 py-3">Hindi Translated</th>
                    <th className="px-4 py-3">Human-Verified</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">Koi data nahi mila.</td>
                    </tr>
                  )}
                  {visibleRows.map((r, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">{r.examName || "—"}</td>
                      <td className="px-4 py-3">{r.subjectName || "—"}</td>
                      <td className="px-4 py-3">{r.totalQuestions}</td>
                      <td className="px-4 py-3">{r.approvedLive}</td>
                      <td className="px-4 py-3">
                        {r.hindiTranslated}{" "}
                        <span className="text-xs text-muted-foreground">({pct(r.hindiTranslated, r.totalQuestions)}%)</span>
                      </td>
                      <td className="px-4 py-3">{r.humanVerifiedTranslation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {/* NEW — Exam × Subject × Year tab */}
        {activeTab === "year" && yearErr && <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{yearErr}</p>}

        {activeTab === "year" && yearLoading ? (
          <p className="mt-6 text-sm text-muted-foreground">Loading year-wise report...</p>
        ) : activeTab === "year" && yearReport ? (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="card p-4">
                <p className="text-xs text-muted-foreground">Total Questions</p>
                <p className="mt-1 text-2xl font-bold">{yearReport.totals.totalQuestions}</p>
              </div>
              <div className="card p-4">
                <p className="text-xs text-muted-foreground">Live (Approved &amp; Active)</p>
                <p className="mt-1 text-2xl font-bold text-success">{yearReport.totals.approvedLive}</p>
              </div>
              <div className="card p-4">
                <p className="text-xs text-muted-foreground">Hindi Translated</p>
                <p className="mt-1 text-2xl font-bold text-info">
                  {yearReport.totals.hindiTranslated} <span className="text-xs font-normal text-muted-foreground">({pct(yearReport.totals.hindiTranslated, yearReport.totals.totalQuestions)}%)</span>
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <button
                onClick={() => setYearExamFilter("")}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${!yearExamFilter ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
              >
                All Exams
              </button>
              {yearExams.map((e) => (
                <button
                  key={e}
                  onClick={() => setYearExamFilter(e)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${yearExamFilter === e ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                >
                  {e}
                </button>
              ))}
            </div>

            <div className="card mt-4 overflow-x-auto p-0">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Exam</th>
                    <th className="px-4 py-3">Subject</th>
                    <th className="px-4 py-3">Year</th>
                    <th className="px-4 py-3">Total</th>
                    <th className="px-4 py-3">Live</th>
                    <th className="px-4 py-3">Hindi Translated</th>
                  </tr>
                </thead>
                <tbody>
                  {yearVisibleRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">Koi data nahi mila.</td>
                    </tr>
                  )}
                  {yearVisibleRows.map((r, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">{r.examName || "—"}</td>
                      <td className="px-4 py-3">{r.subjectName || "—"}</td>
                      <td className="px-4 py-3">{r.year ?? "(No Year)"}</td>
                      <td className="px-4 py-3">{r.totalQuestions}</td>
                      <td className="px-4 py-3">{r.approvedLive}</td>
                      <td className="px-4 py-3">
                        {r.hindiTranslated}{" "}
                        <span className="text-xs text-muted-foreground">({pct(r.hindiTranslated, r.totalQuestions)}%)</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
