"use client";

import * as React from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from "chart.js";
import { Bar, Line, Doughnut, Radar } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
);

type ChapterPerformance = {
  chapterId: string;
  chapterName: string;
  subjectId: string;
  subjectName: string;
  total: number;
  correct: number;
  accuracyPercent: number;
  strengthScore: number;
  isWeak: boolean;
  action: {
    drillQuestions: number;
    testQuestions: number;
    message: string;
  };
};

type AnalyticsData = {
  summary: {
    chaptersAttempted: number;
    weakChapters: number;
    strongChapters: number;
  };
  weakTopics: ChapterPerformance[];
  strongTopics: ChapterPerformance[];
  allTopics: ChapterPerformance[];
};

export default function AnalyticsPage() {
  const [data, setData] = React.useState<AnalyticsData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [timeRange, setTimeRange] = React.useState<"week" | "month" | "all">("all");

  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
  const headers = (): Record<string, string> => {
    const token = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/analytics/performance`, { headers: headers() });
      if (res.ok) {
        const d = await res.json();
        setData(d);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">📊</div>
          <p className="text-muted-foreground">Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">Failed to load analytics</p>
        </div>
      </div>
    );
  }

  const { summary, weakTopics, strongTopics, allTopics } = data;

  const accuracyChartData = {
    labels: allTopics.map((t) => t.chapterName.length > 15 ? t.chapterName.slice(0, 15) + "…" : t.chapterName),
    datasets: [
      {
        label: "Accuracy %",
        data: allTopics.map((t) => t.accuracyPercent),
        backgroundColor: allTopics.map((t) =>
          t.isWeak ? "rgba(239, 68, 68, 0.8)" : t.accuracyPercent >= 80 ? "rgba(34, 197, 94, 0.8)" : "rgba(234, 179, 8, 0.8)"
        ),
        borderColor: allTopics.map((t) =>
          t.isWeak ? "rgba(239, 68, 68, 1)" : t.accuracyPercent >= 80 ? "rgba(34, 197, 94, 1)" : "rgba(234, 179, 8, 1)"
        ),
        borderWidth: 1,
      },
    ],
  };

  const subjectDistribution = allTopics.reduce((acc, t) => {
    acc[t.subjectName] = (acc[t.subjectName] || 0) + t.total;
    return acc;
  }, {} as Record<string, number>);

  const uniqueSubjects = Array.from(new Set(allTopics.map((t) => t.subjectName)));

  const subjectChartData = {
    labels: Object.keys(subjectDistribution),
    datasets: [
      {
        label: "Questions Attempted",
        data: Object.values(subjectDistribution),
        backgroundColor: [
          "rgba(139, 92, 246, 0.8)",
          "rgba(239, 68, 68, 0.8)",
          "rgba(34, 197, 94, 0.8)",
          "rgba(234, 179, 8, 0.8)",
          "rgba(6, 182, 212, 0.8)",
          "rgba(249, 115, 22, 0.8)",
        ],
      },
    ],
  };

  const radarData = {
    labels: uniqueSubjects,
    datasets: [
      {
        label: "Strength Score",
        data: uniqueSubjects.map((subj) => {
          const topics = allTopics.filter((t) => t.subjectName === subj);
          return Math.round(topics.reduce((sum, t) => sum + t.strengthScore, 0) / topics.length);
        }),
        backgroundColor: "rgba(139, 92, 246, 0.2)",
        borderColor: "rgba(139, 92, 246, 1)",
        pointBackgroundColor: "rgba(139, 92, 246, 1)",
      },
    ],
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">
            ← <span className="text-primary">SSC</span>PrepHub
          </a>
          <span className="text-sm text-muted-foreground">Performance Analytics 📊</span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Performance Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track your progress, identify weak areas, and strengthen your preparation.
          </p>
        </div>

        <div className="flex gap-2 mb-6 border-b border-border">
          {(["week", "month", "all"] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition ${
                timeRange === range
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {range === "week" ? "📅 Week" : range === "month" ? "📆 Month" : "📈 All Time"}
            </button>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-3 mb-8">
          <div className="card p-5">
            <p className="text-xs text-muted-foreground">Chapters Attempted</p>
            <p className="mt-1 text-3xl font-bold text-primary">{summary.chaptersAttempted}</p>
          </div>
          <div className="card p-5">
            <p className="text-xs text-muted-foreground">Weak Areas</p>
            <p className="mt-1 text-3xl font-bold text-danger">{summary.weakChapters}</p>
            <p className="text-xs text-danger mt-1">Need attention</p>
          </div>
          <div className="card p-5">
            <p className="text-xs text-muted-foreground">Strong Areas</p>
            <p className="mt-1 text-3xl font-bold text-success">{summary.strongChapters}</p>
            <p className="text-xs text-success mt-1">Well prepared</p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2 mb-8">
          <div className="card p-5">
            <h2 className="text-lg font-semibold mb-4">Accuracy by Chapter</h2>
            <div className="h-80">
              <Bar
                data={accuracyChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  indexAxis: "y",
                  plugins: {
                    legend: { display: false },
                  },
                  scales: {
                    x: { beginAtZero: true, max: 100, title: { display: true, text: "Accuracy %" } },
                  },
                }}
              />
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-lg font-semibold mb-4">Questions by Subject</h2>
            <div className="h-80">
              <Doughnut
                data={subjectChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { position: "bottom" },
                  },
                }}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2 mb-8">
          <div className="card p-5">
            <h2 className="text-lg font-semibold mb-4">Subject Strength Radar</h2>
            <div className="h-80">
              <Radar
                data={radarData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  scales: {
                    r: { beginAtZero: true, max: 100 },
                  },
                }}
              />
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-lg font-semibold mb-4">Progress Trend (Mock)</h2>
            <div className="h-80">
              <Line
                data={{
                  labels: ["Week 1", "Week 2", "Week 3", "Week 4"],
                  datasets: [
                    {
                      label: "Avg Accuracy %",
                      data: [45, 52, 61, 68],
                      borderColor: "rgba(139, 92, 246, 1)",
                      backgroundColor: "rgba(139, 92, 246, 0.1)",
                      fill: true,
                      tension: 0.4,
                    },
                    {
                      label: "Questions/Day",
                      data: [15, 22, 28, 35],
                      borderColor: "rgba(34, 197, 94, 1)",
                      backgroundColor: "rgba(34, 197, 94, 0.1)",
                      fill: true,
                      tension: 0.4,
                      yAxisID: "y1",
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  interaction: { mode: "index", intersect: false },
                  scales: {
                    y: { type: "linear", position: "left", beginAtZero: true, max: 100 },
                    y1: { type: "linear", position: "right", beginAtZero: true, grid: { drawOnChartArea: false } },
                  },
                }}
              />
            </div>
          </div>
        </div>

        <div className="card mb-8">
          <div className="p-5">
            <h2 className="text-lg font-semibold mb-4">🎯 Weak Topics - Action Required</h2>
            {weakTopics.length === 0 ? (
              <p className="text-success text-center py-8">🎉 No weak topics! You're well prepared across all chapters.</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {weakTopics.map((topic) => (
                  <div
                    key={topic.chapterId}
                    className="p-4 rounded-lg bg-danger/5 border border-danger/20"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{topic.chapterName}</p>
                        <p className="text-xs text-muted-foreground">
                          {topic.subjectName} • {topic.total} attempted, {topic.correct} correct
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-danger">{topic.accuracyPercent}%</p>
                        <p className="text-xs text-muted-foreground">Accuracy</p>
                      </div>
                    </div>
                    <div className="mt-2 flex gap-2 flex-wrap">
                      <span className="rounded-full bg-danger/10 px-3 py-1 text-xs font-medium text-danger">
                        Drill: {topic.action.drillQuestions} Qs
                      </span>
                      <span className="rounded-full bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
                        Test: {topic.action.testQuestions} Qs
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{topic.action.message}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="p-5">
            <h2 className="text-lg font-semibold mb-4">✅ Strong Topics</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {strongTopics.map((topic) => (
                <div
                  key={topic.chapterId}
                  className="p-4 rounded-lg bg-success/5 border border-success/20"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{topic.chapterName}</p>
                    <span className="text-2xl font-bold text-success">{topic.accuracyPercent}%</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {topic.subjectName} • {topic.total} Qs • Strength: {topic.strengthScore}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}