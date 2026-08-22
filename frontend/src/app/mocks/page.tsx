"use client";
import { fetchAuth } from "@/lib/api";
import * as React from "react";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";

interface TestTemplate {
  id: string;
  title: string;
  description: string;
  type: string;
  durationMinutes: number;
  totalQuestions: number;
  totalMarks: number;
  isPremium: boolean;
  isActive: boolean;
  exam?: {
    id: string;
    name: string;
    slug: string;
  };
  subject?: {
    id: string;
    name: string;
    slug: string;
  };
  tags?: string[];
  createdAt: string;
  // Payment/access fields
  free?: boolean;
  locked?: boolean;
  reason?: string;
  offerPriceInr?: number;
  offerDays?: number;
}

interface Exam {
  id: string;
  name: string;
  slug: string;
  count: number;
}

interface MockAccessResponse {
  freeMocksPerExam: number;
  mockAccess: TestTemplate[];
  examPacks: {
    name: string;
    priceInr: number;
    mocksIncluded: number;
    durationDays: number;
  };
  offer: {
    active: boolean;
    priceInr: number;
    days: number;
    message: string;
  };
}

function apiBase() {
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
}

function getAuthHeaders(): { [k: string]: string } {
  try {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

const TYPE_COLOR: Record<string, string> = {
  FULL_MOCK: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  MINI_MOCK: "bg-purple-500/15 text-purple-600 border-purple-500/30",
  SUBJECT: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  TOPIC: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  DAILY_PRACTICE: "bg-indigo-500/15 text-indigo-600 border-indigo-500/30",
  PREVIOUS_YEAR: "bg-rose-500/15 text-rose-600 border-rose-500/30",
  SHIFT_WISE: "bg-cyan-500/15 text-cyan-600 border-cyan-500/30",
  YEAR_WISE: "bg-orange-500/15 text-orange-600 border-orange-500/30",
  CUSTOM: "bg-gray-500/15 text-gray-600 border-gray-500/30",
};

const TYPE_ICON: Record<string, string> = {
  FULL_MOCK: "📋",
  MINI_MOCK: "📝",
  SUBJECT: "📚",
  TOPIC: "🎯",
  DAILY_PRACTICE: "📅",
  PREVIOUS_YEAR: "📜",
  SHIFT_WISE: "🔄",
  YEAR_WISE: "📆",
  CUSTOM: "⚙️",
};

export default function MocksPage() {
  const [templates, setTemplates] = React.useState<TestTemplate[]>([]);
  const [exams, setExams] = React.useState<Exam[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedExam, setSelectedExam] = React.useState<string>("");
  const [selectedType, setSelectedType] = React.useState<string>("");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [viewMode, setViewMode] = React.useState<"grid" | "list">("grid");

  React.useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [mocksRes, examsRes] = await Promise.all([
          fetchAuth(`${apiBase()}/mocks`, { headers: getAuthHeaders() }),
          fetchAuth(`${apiBase()}/bank/meta`, { headers: getAuthHeaders() }).then((r) => r.json()),
        ]);
        const mocksData: MockAccessResponse = await mocksRes.json();
        setTemplates(mocksData.mockAccess || []);
        const allExams = Array.isArray(examsRes?.exams) ? examsRes.exams.filter((e: Exam) => e.count > 0) : [];
        setExams(allExams);

        // Check URL for exam filter
        if (typeof window !== "undefined") {
          const urlExam = new URLSearchParams(window.location.search).get("exam");
          if (urlExam && allExams.some((e: Exam) => e.id === urlExam)) {
            setSelectedExam(urlExam);
          }
        }
      } catch (e) {
        console.error("Failed to load mocks:", e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filteredTemplates = templates.filter((t) => {
    if (selectedExam && t.exam?.id !== selectedExam) return false;
    if (selectedType && t.type !== selectedType) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (
        !t.title.toLowerCase().includes(q) &&
        !t.description.toLowerCase().includes(q) &&
        !t.exam?.name.toLowerCase().includes(q) &&
        !t.subject?.name.toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  const groupedByExam = filteredTemplates.reduce((acc, t) => {
    const examName = t.exam?.name || "General";
    if (!acc[examName]) acc[examName] = [];
    acc[examName].push(t);
    return acc;
  }, {} as Record<string, TestTemplate[]>);

  const groupedByType = filteredTemplates.reduce((acc, t) => {
    if (!acc[t.type]) acc[t.type] = [];
    acc[t.type].push(t);
    return acc;
  }, {} as Record<string, TestTemplate[]>);

  const typeOrder = [
    "FULL_MOCK",
    "MINI_MOCK",
    "SUBJECT",
    "TOPIC",
    "DAILY_PRACTICE",
    "PREVIOUS_YEAR",
    "SHIFT_WISE",
    "YEAR_WISE",
    "CUSTOM",
  ];

  const formatDuration = (mins: number) => {
    if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    return `${mins}m`;
  };

  const renderTemplateCard = (t: TestTemplate) => {
    // Handle premium/locked status
    const isLocked = t.locked === true;
    const isFree = t.free === true;
    const offerPrice = t.offerPriceInr || 0;
    const offerDays = t.offerDays || 0;

    return (
      <Link
        key={t.id}
        href={isLocked ? `/mocks` : `/test?template=${encodeURIComponent(t.id)}`}
        className="group block rounded-xl border border-border bg-card p-5 transition hover:border-primary/50 hover:shadow-lg"
        onClick={isLocked ? (e) => e.preventDefault() : undefined}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TYPE_COLOR[t.type] || TYPE_COLOR.CUSTOM}`}>
                {TYPE_ICON[t.type] || "📝"} {t.type.replace(/_/g, " ")}
              </span>
              {t.isPremium && (
                <span className="inline-flex items-center rounded-full border border-amber-400/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-200">
                  💎 Premium
                </span>
              )}
              {isLocked && (
                <span className="inline-flex items-center rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-700 dark:text-red-200">
                  🔒 Locked
                </span>
              )}
              {isFree && !isLocked && (
                <span className="inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-200">
                  ✅ Free
                </span>
              )}
              {!t.isActive && (
                <span className="inline-flex items-center rounded-full border border-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                  Inactive
                </span>
              )}
            </div>
            <h3 className="mt-2 text-lg font-bold truncate group-hover:text-primary">{t.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{t.description}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">{t.totalQuestions} Qs</span>
              <span className="flex items-center gap-1">⏱ {formatDuration(t.durationMinutes)}</span>
              <span className="flex items-center gap-1">⭐ {t.totalMarks} Marks</span>
              {t.exam && <span className="flex items-center gap-1 text-primary">{t.exam.name}</span>}
              {t.subject && <span className="flex items-center gap-1 text-info">{t.subject.name}</span>}
            </div>
            {isLocked && offerPrice > 0 && (
              <div className="mt-3 flex items-center gap-2 text-sm">
                <span className="rounded-lg bg-amber-500/10 px-3 py-1 text-amber-700 dark:text-amber-300">
                  Unlock for ₹{offerPrice} ({offerDays} days)
                </span>
              </div>
            )}
          </div>
          <div className="shrink-0 flex flex-col items-end gap-2">
            {isLocked ? (
              <span className="rounded-xl bg-red-500/10 px-3 py-1.5 text-sm font-bold text-red-600">
                Locked - Pay to Unlock
              </span>
            ) : (
              <span className="rounded-xl bg-primary/10 px-3 py-1.5 text-sm font-bold text-primary">
                Start Test →
              </span>
            )}
          </div>
        </div>
      </Link>
    );
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">🧪 SSC Mock Tests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Full mocks, sectional tests, topic tests, and daily practice — bilingual, verified, real exam pattern
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-5 animate-pulse">
              <div className="h-4 w-3/4 rounded bg-muted" />
              <div className="mt-3 h-6 w-full rounded bg-muted" />
              <div className="mt-2 h-4 w-1/2 rounded bg-muted" />
              <div className="mt-3 flex gap-2">
                <div className="h-4 w-20 rounded bg-muted" />
                <div className="h-4 w-20 rounded bg-muted" />
                <div className="h-4 w-20 rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader showSupport={true} />
      <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">🧪 SSC Mock Tests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Full mocks, sectional tests, topic tests, and daily practice — bilingual, verified, real exam pattern
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-muted-foreground">Search</label>
            <input
              type="text"
              placeholder="Search mock tests..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="min-w-[180px]">
            <label className="text-xs font-medium text-muted-foreground">Exam</label>
            <select
              value={selectedExam}
              onChange={(e) => setSelectedExam(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">All Exams</option>
              {exams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[160px]">
            <label className="text-xs font-medium text-muted-foreground">Type</label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">All Types</option>
              {typeOrder.map((type) => (
                <option key={type} value={type}>
                  {TYPE_ICON[type]} {type.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode("grid")}
              className={`rounded-md p-2 ${viewMode === "grid" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/50"}`}
              aria-label="Grid view"
            >
              ⊞
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`rounded-md p-2 ${viewMode === "list" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/50"}`}
              aria-label="List view"
            >
              ≡
            </button>
          </div>
        </div>
      </div>

      {/* Templates grouped by exam */}
      {Object.keys(groupedByExam).length > 0 && (
        <div className="space-y-8">
          {Object.entries(groupedByExam)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([examName, examTemplates]) => (
              <section key={examName}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-bold flex items-center gap-2">
                      {examTemplates[0]?.exam && (
                        <span className="rounded-full bg-primary/15 px-3 py-1 text-sm font-semibold text-primary">
                          {examTemplates[0].exam.name}
                        </span>
                      )}
                      {examName}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {examTemplates.length} mock test{examTemplates.length > 1 ? "s" : ""} available
                    </p>
                  </div>
                </div>
                <div className={viewMode === "grid" ? "grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "space-y-3"}>
                  {examTemplates.map(renderTemplateCard)}
                </div>
              </section>
            ))}
        </div>
      )}

      {/* Templates grouped by type (when no exam filter or for quick reference) */}
      {selectedExam === "" && Object.keys(groupedByType).length > 0 && (
        <div className="mt-10 space-y-8">
          <h2 className="text-xl font-bold">By Test Type</h2>
          {typeOrder
            .filter((type) => groupedByType[type] && groupedByType[type].length > 0)
            .map((type) => (
              <section key={type}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TYPE_COLOR[type] || TYPE_COLOR.CUSTOM}`}>
                      {TYPE_ICON[type]} {type.replace(/_/g, " ")}
                    </span>
                    <h3 className="text-lg font-bold">{type.replace(/_/g, " ")} Tests</h3>
                  </div>
                  <span className="text-sm text-muted-foreground">{groupedByType[type].length} tests</span>
                </div>
                <div className={viewMode === "grid" ? "grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "space-y-3"}>
                  {groupedByType[type].map(renderTemplateCard)}
                </div>
              </section>
            ))}
        </div>
      )}

      {filteredTemplates.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-muted-foreground">No mock tests match your filters.</p>
          <button
            onClick={() => {
              setSelectedExam("");
              setSelectedType("");
              setSearchQuery("");
            }}
            className="mt-4 rounded-lg border border-primary px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/10"
          >
            Clear Filters
          </button>
        </div>
      )}

      {/* Quick access to daily practice */}
      <div className="mt-10 rounded-xl border border-info/30 bg-info/5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-info">📅 Daily Practice Test</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Get a fresh 10-question set based on your study plan every day. Tracks your progress and
              adapts to weak areas.
            </p>
          </div>
          <Link
            href="/test?daily=1"
            className="shrink-0 rounded-xl bg-info px-6 py-3 text-sm font-bold text-info-foreground hover:opacity-90"
          >
            Start Daily Test →
          </Link>
        </div>
      </div>
    </main>
  </div>
);
}