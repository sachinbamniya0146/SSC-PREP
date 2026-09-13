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

// NEW (this session — "jo topic subtopic ke questions upload nahi hue unka
// list ho... exam attach karne ka option, exam ke toggle par kaam kare"):
// exam → subject → chapter → topic → sub-topic drilldown, INCLUDING zero-
// question leaves (that's the whole point — an empty cell here is exactly
// what tells the admin what to upload next). Backed by
// GET /bank/admin/coverage/drilldown (contentCoverageDrilldown(), extended
// this session to go two levels deeper than chapter).
type SubTopicNode = {
  subTopicId: string;
  subTopicName: string;
  subTopicNameHindi: string | null;
  subTopicSlug: string;
  total: number;
  approvedLive: number;
};
type TopicNode = {
  topicId: string;
  topicName: string;
  topicNameHindi: string | null;
  topicSlug: string;
  total: number;
  approvedLive: number;
  subTopics: SubTopicNode[];
};
type ChapterNode = {
  chapterId: string;
  chapterName: string;
  chapterNameHindi: string | null;
  chapterSlug: string;
  total: number;
  approvedLive: number;
  missingHindi: number;
  pyqCount: number;
  practiceCount: number;
  withSolution: number;
  topics: TopicNode[];
};
type SubjectNode = {
  subjectId: string;
  subjectName: string;
  subjectNameHindi: string | null;
  subjectSlug: string;
  total: number;
  approvedLive: number;
  chapters: ChapterNode[];
};
type ExamNode = {
  examId: string;
  examName: string;
  examSlug: string;
  examCode: string | null;
  isActive: boolean;
  total: number;
  approvedLive: number;
  subjects: SubjectNode[];
};
type EmptyRow = {
  level: "Chapter" | "Topic" | "Sub-Topic";
  name: string;
  nameHindi: string | null;
  slug: string;
  subjectName: string;
  chapterName: string;
  topicName?: string;
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
  const [activeTab, setActiveTab] = React.useState<"subject" | "year" | "drilldown">("subject");
  const [yearReport, setYearReport] = React.useState<CoverageByYearReport | null>(null);
  const [yearLoading, setYearLoading] = React.useState(false);
  const [yearErr, setYearErr] = React.useState("");
  const [yearExamFilter, setYearExamFilter] = React.useState("");

  // NEW — drilldown (Chapter → Topic → Sub-Topic gap finder) tab state.
  const [drillExams, setDrillExams] = React.useState<ExamNode[]>([]);
  const [drillLoading, setDrillLoading] = React.useState(false);
  const [drillErr, setDrillErr] = React.useState("");
  const [drillExamId, setDrillExamId] = React.useState("");
  const [expandedChapterId, setExpandedChapterId] = React.useState<string | null>(null);
  const [expandedTopicId, setExpandedTopicId] = React.useState<string | null>(null);
  const [onlyEmptyChapters, setOnlyEmptyChapters] = React.useState(false);
  const [gapSearch, setGapSearch] = React.useState("");

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

  // NEW — fetch the drilldown tree the first time the admin opens that tab.
  React.useEffect(() => {
    if (!authChecked || activeTab !== "drilldown" || drillExams.length > 0 || drillLoading) return;
    (async () => {
      setDrillLoading(true);
      setDrillErr("");
      try {
        const r = await fetchAuth(`${API_BASE}/bank/admin/coverage/drilldown`);
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          setDrillErr(d?.message || `HTTP ${r.status}`);
          return;
        }
        const data: { exams: ExamNode[] } = await r.json();
        setDrillExams(data.exams || []);
        setDrillExamId((prev) => prev || data.exams?.[0]?.examId || "");
      } catch (e) {
        setDrillErr(e instanceof Error ? e.message : "Drilldown load nahi hua");
      } finally {
        setDrillLoading(false);
      }
    })();
  }, [authChecked, activeTab, drillExams.length, drillLoading]);

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

  // NEW — drilldown tab: selected exam node + flattened "0 questions" gap
  // list (Chapter/Topic/Sub-Topic — whichever level is the actual leaf).
  const selectedDrillExam = React.useMemo(
    () => drillExams.find((e) => e.examId === drillExamId) || null,
    [drillExams, drillExamId],
  );

  const emptyRows = React.useMemo<EmptyRow[]>(() => {
    if (!selectedDrillExam) return [];
    const rows: EmptyRow[] = [];
    for (const subj of selectedDrillExam.subjects) {
      for (const ch of subj.chapters) {
        if (ch.topics.length === 0) {
          if (ch.total === 0) {
            rows.push({ level: "Chapter", name: ch.chapterName, nameHindi: ch.chapterNameHindi, slug: ch.chapterSlug, subjectName: subj.subjectName, chapterName: ch.chapterName });
          }
          continue;
        }
        for (const t of ch.topics) {
          if (t.subTopics.length === 0) {
            if (t.total === 0) {
              rows.push({ level: "Topic", name: t.topicName, nameHindi: t.topicNameHindi, slug: t.topicSlug, subjectName: subj.subjectName, chapterName: ch.chapterName });
            }
            continue;
          }
          for (const st of t.subTopics) {
            if (st.total === 0) {
              rows.push({ level: "Sub-Topic", name: st.subTopicName, nameHindi: st.subTopicNameHindi, slug: st.subTopicSlug, subjectName: subj.subjectName, chapterName: ch.chapterName, topicName: t.topicName });
            }
          }
        }
      }
    }
    return rows;
  }, [selectedDrillExam]);

  const filteredEmptyRows = React.useMemo(() => {
    const q = gapSearch.trim().toLowerCase();
    if (!q) return emptyRows;
    return emptyRows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.nameHindi || "").includes(gapSearch.trim()) ||
        r.chapterName.toLowerCase().includes(q) ||
        r.subjectName.toLowerCase().includes(q),
    );
  }, [emptyRows, gapSearch]);

  function copySlug(slug: string) {
    navigator.clipboard?.writeText(slug).catch(() => undefined);
  }

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
          <button
            onClick={() => setActiveTab("drilldown")}
            className={`border-b-2 px-4 py-2 text-sm font-semibold ${activeTab === "drilldown" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
          >
            🕳️ Chapter → Topic → Sub-Topic (Gaps)
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

        {/* NEW — Chapter → Topic → Sub-Topic gap-finder tab */}
        {activeTab === "drilldown" && drillErr && <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{drillErr}</p>}

        {activeTab === "drilldown" && drillLoading ? (
          <p className="mt-6 text-sm text-muted-foreground">Loading drilldown...</p>
        ) : activeTab === "drilldown" && drillExams.length > 0 ? (
          <>
            <p className="mt-4 text-sm text-muted-foreground">
              Har exam ke hisaab se dekhein kaunse Subject → Chapter → Topic → Sub-Topic mein abhi tak koi question
              upload nahi hua — seedha wahi slug copy karke Bulk Upload sheet mein daal dein.
            </p>

            {/* Exam toggle */}
            <div className="mt-4 flex flex-wrap gap-2">
              {drillExams.map((e) => (
                <button
                  key={e.examId}
                  onClick={() => setDrillExamId(e.examId)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${drillExamId === e.examId ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"} ${!e.isActive ? "opacity-50" : ""}`}
                  title={e.isActive ? "" : "Inactive exam"}
                >
                  {e.examName} <span className="opacity-70">({e.approvedLive}/{e.total} live)</span>
                </button>
              ))}
            </div>

            {selectedDrillExam && (
              <>
                {/* Empty-coverage summary */}
                <div className="card mt-6 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-semibold text-danger">
                      🕳️ Empty Topics / Sub-Topics — {selectedDrillExam.examName}{" "}
                      <span className="text-muted-foreground">({filteredEmptyRows.length})</span>
                    </h2>
                    <input
                      value={gapSearch}
                      onChange={(e) => setGapSearch(e.target.value)}
                      placeholder="Search chapter/topic naam..."
                      className="w-56 rounded-lg border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary"
                    />
                  </div>
                  {filteredEmptyRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      🎉 {selectedDrillExam.examName} ke liye har chapter/topic/sub-topic mein kam se kam ek question hai.
                    </p>
                  ) : (
                    <div className="max-h-96 overflow-y-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="sticky top-0 border-b border-border bg-card text-xs text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2">Level</th>
                            <th className="px-3 py-2">Naam (English / हिंदी)</th>
                            <th className="px-3 py-2">Subject → Chapter → Topic</th>
                            <th className="px-3 py-2">Slug</th>
                            <th className="px-3 py-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredEmptyRows.map((r, i) => (
                            <tr key={`${r.level}-${r.slug}-${i}`} className="border-b border-border last:border-0">
                              <td className="px-3 py-2">
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.level === "Chapter" ? "bg-danger/10 text-danger" : r.level === "Topic" ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary"}`}>
                                  {r.level}
                                </span>
                              </td>
                              <td className="px-3 py-2 font-medium">
                                {r.name}
                                {r.nameHindi ? <span className="text-muted-foreground"> / {r.nameHindi}</span> : ""}
                              </td>
                              <td className="px-3 py-2 text-xs text-muted-foreground">
                                {r.subjectName} → {r.chapterName}{r.topicName ? ` → ${r.topicName}` : ""}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.slug}</td>
                              <td className="px-3 py-2 text-right">
                                <button onClick={() => copySlug(r.slug)} className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted">
                                  Copy slug
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Full tree */}
                <div className="mb-2 mt-6 flex items-center gap-2">
                  <h2 className="font-semibold">Poora Coverage Tree</h2>
                  <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input type="checkbox" checked={onlyEmptyChapters} onChange={(e) => setOnlyEmptyChapters(e.target.checked)} />
                    Sirf 0-question chapters dikhayein
                  </label>
                </div>
                <div className="space-y-3">
                  {selectedDrillExam.subjects.map((subj) => {
                    const visibleChapters = onlyEmptyChapters ? subj.chapters.filter((c) => c.total === 0) : subj.chapters;
                    if (onlyEmptyChapters && visibleChapters.length === 0) return null;
                    return (
                      <div key={subj.subjectId} className="card p-4">
                        <div className="mb-2 flex items-center justify-between">
                          <h3 className="font-semibold">
                            {subj.subjectName}{subj.subjectNameHindi ? <span className="text-muted-foreground"> / {subj.subjectNameHindi}</span> : ""}
                          </h3>
                          <span className="text-xs text-muted-foreground">{subj.approvedLive}/{subj.total} live</span>
                        </div>
                        <div className="divide-y divide-border">
                          {visibleChapters.map((ch) => (
                            <div key={ch.chapterId} className="py-2">
                              <button
                                onClick={() => setExpandedChapterId((prev) => (prev === ch.chapterId ? null : ch.chapterId))}
                                className="flex w-full items-center justify-between text-left text-sm"
                              >
                                <span className={ch.total === 0 ? "font-semibold text-danger" : "font-medium"}>
                                  {ch.total === 0 ? "🕳️ " : ""}
                                  {ch.chapterName}{ch.chapterNameHindi ? <span className="text-muted-foreground"> / {ch.chapterNameHindi}</span> : ""}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {ch.approvedLive}/{ch.total} live · {ch.pyqCount} PYQ · {ch.practiceCount} practice
                                  {ch.missingHindi > 0 ? ` · ${ch.missingHindi} missing Hindi` : ""}{" "}
                                  {expandedChapterId === ch.chapterId ? "▲" : "▼"}
                                </span>
                              </button>

                              {expandedChapterId === ch.chapterId && (
                                <div className="mt-2 ml-4 space-y-1.5 border-l border-border pl-4">
                                  {ch.topics.length === 0 && (
                                    <p className="text-xs text-muted-foreground">
                                      Is chapter mein abhi koi topic define nahi hai —{" "}
                                      <a href="/admin/topics" className="text-primary underline">Topic Manage se add karein</a>.
                                    </p>
                                  )}
                                  {ch.topics.map((t) => (
                                    <div key={t.topicId}>
                                      <button
                                        onClick={() => setExpandedTopicId((prev) => (prev === t.topicId ? null : t.topicId))}
                                        className="flex w-full items-center justify-between text-left text-xs"
                                      >
                                        <span className={t.total === 0 ? "font-semibold text-danger" : ""}>
                                          {t.total === 0 ? "🕳️ " : ""}
                                          {t.topicName}{t.topicNameHindi ? <span className="text-muted-foreground"> / {t.topicNameHindi}</span> : ""}
                                        </span>
                                        <span className="text-muted-foreground">
                                          {t.approvedLive}/{t.total} live{" "}
                                          {t.subTopics.length > 0 ? (expandedTopicId === t.topicId ? "▲" : "▼") : ""}
                                        </span>
                                      </button>
                                      {expandedTopicId === t.topicId && t.subTopics.length > 0 && (
                                        <div className="mt-1 ml-4 space-y-1 border-l border-border pl-3">
                                          {t.subTopics.map((st) => (
                                            <div key={st.subTopicId} className="flex items-center justify-between text-[11px]">
                                              <span className={st.total === 0 ? "font-semibold text-danger" : ""}>
                                                {st.total === 0 ? "🕳️ " : ""}
                                                {st.subTopicName}{st.subTopicNameHindi ? <span className="text-muted-foreground"> / {st.subTopicNameHindi}</span> : ""}
                                              </span>
                                              <span className="text-muted-foreground">{st.approvedLive}/{st.total} live</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
