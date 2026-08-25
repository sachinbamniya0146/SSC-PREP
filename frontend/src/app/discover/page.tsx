"use client";
import { fetchAuth } from "@/lib/api";

import * as React from "react";
import { motion } from "framer-motion";
import { API_BASE } from "@/lib/api";

type Exam = { id: string; name: string; count: number };
type Chapter = { id: string; name: string; subject: string; count: number };

function apiBase() {
  return API_BASE;
}

function getAuthHeaders(): { [k: string]: string } {
  try {
    const token =
      typeof window !== "undefined"
        ? localStorage.getItem("ssc_access_token") || ""
        : "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

const examFamilies = [
  "All",
  "CGL",
  "CHSL",
  "CPO",
  "MTS",
  "GD",
  "JE",
  "Stenographer",
  "Selection Post",
  "Delhi Police",
  "Police & Paramilitary",
];

// PYQ library: authority cards -> year/shift archives (UI scaffold; archive data
// populates from the verified question bank as it grows).
const pyqLibrary = [
  {
    authority: "SSC CGL",
    tag: "Combined Graduate Level",
    years: [2025, 2024, 2023, 2022],
    accent: "text-primary bg-primary/10",
  },
  {
    authority: "SSC CHSL",
    tag: "Combined Higher Secondary Level",
    years: [2024, 2023, 2022, 2021],
    accent: "text-info bg-info/10",
  },
  {
    authority: "SSC CPO",
    tag: "Central Police Organisations",
    years: [2024, 2023, 2022],
    accent: "text-success bg-success/10",
  },
  {
    authority: "SSC MTS",
    tag: "Multi-Tasking Staff",
    years: [2024, 2023, 2022],
    accent: "text-warning bg-warning/10",
  },
  {
    authority: "SSC Selection Post",
    tag: "Phase XII & earlier",
    years: [2024, 2023],
    accent: "text-accent bg-accent/10",
  },
  {
    authority: "Delhi Police",
    tag: "Constable · Head Constable",
    years: [2023, 2022, 2021],
    accent: "text-danger bg-danger/10",
  },
];

const IconSearch = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);

export default function DiscoveryPage() {
  const [query, setQuery] = React.useState("");
  const [family, setFamily] = React.useState("All");
  const [exams, setExams] = React.useState<Exam[]>([]);
  const [chapters, setChapters] = React.useState<Chapter[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      try {
        const base = apiBase();
        const [m, c] = await Promise.all([
          fetchAuth(`${base}/bank/meta`, { headers: getAuthHeaders() }).then((r) => r.json()),
          fetchAuth(`${base}/bank/chapters`, { headers: getAuthHeaders() }).then((r) => r.json()),
        ]);
        setExams(Array.isArray(m?.exams) ? m.exams.filter((e: Exam) => e.count > 0) : []);
        setTotal(Number(m?.totalQuestions) || 0);
        setChapters(Array.isArray(c) ? c : []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // SearchMiss demand logging: when the user searches and nothing matches, log it.
  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const hits = [...exams, ...chapters].filter((x) =>
      (x.name || "").toLowerCase().includes(q.toLowerCase()),
    );
    if (hits.length === 0) {
      fetch(`${apiBase()}/bank/search-miss`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, exam: family }),
      }).catch(() => {});
    }
    const qs = new URLSearchParams({ q });
    window.location.href = `/question-bank?${qs}`;
  };

  const shownExams =
    family === "All"
      ? exams
      : exams.filter((e) => e.name.toLowerCase().includes(family.toLowerCase()));

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <a href="/" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">S</span>
            <span className="text-lg font-bold">SSC<span className="text-primary">PrepHub</span></span>
          </a>
          <div className="flex items-center gap-3">
            <a href="/test" className="btn btn-primary">Start Test</a>
            <a href="/dashboard" className="btn btn-outline">Dashboard</a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        {/* ===== GLOBAL SEARCH ===== */}
        <motion.form
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          onSubmit={search}
          className="mx-auto max-w-3xl"
        >
          <h1 className="text-center text-2xl font-extrabold sm:text-3xl">
            Find Exams, PYQs, Mock Tests &amp; Topics
          </h1>
          <div className="mt-6 flex items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-lg shadow-primary/5 focus-within:border-primary">
            <span className="pl-2 text-muted-foreground"><IconSearch /></span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for Exams, PYQs, Mock Tests, and Topics…"
              className="w-full bg-transparent px-2 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            <button type="submit" className="shrink-0 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
              Search
            </button>
          </div>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            {loading ? "Loading question bank…" : `${total}+ verified PYQs in the bank · searches you run help us fetch missing papers`}
          </p>
        </motion.form>

        <div className="mt-10 flex flex-col gap-8 lg:flex-row">
          {/* ===== LEFT CATEGORY SIDEBAR ===== */}
          <aside className="lg:w-60 shrink-0">
            <div className="card p-4">
              <p className="text-xs font-bold text-muted-foreground">SSC EXAM FAMILIES</p>
              <div className="mt-3 flex flex-wrap gap-1.5 lg:flex-col lg:gap-1">
                {examFamilies.map((f) => (
                  <button
                    key={f}
                    onClick={() => setFamily(f)}
                    className={`rounded-lg px-3 py-1.5 text-left text-sm transition ${
                      family === f
                        ? "bg-primary/10 font-semibold text-primary"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          </aside>

          {/* ===== EXAM / TEST CARD GRID ===== */}
          <section className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Mock Tests &amp; PYQs</h2>
              <span className="text-xs text-muted-foreground">{shownExams.length} exam series</span>
            </div>

            {loading ? (
              <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
            ) : shownExams.length === 0 ? (
              <div className="card mt-6 p-10 text-center">
                <p className="text-3xl">🔍</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  No exams found for “{family}”. Try another family — or search above and we&apos;ll
                  log it to fetch those papers.
                </p>
              </div>
            ) : (
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                {shownExams.map((e, i) => (
                  <motion.div
                    key={e.id}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: i * 0.04 }}
                    className="card p-6 transition hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-bold">{e.name}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {e.count} questions · Hindi + English
                        </p>
                      </div>
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg">
                        📘
                      </span>
                    </div>
                    <div className="mt-5 flex gap-2">
                      <a href="/test" className="btn btn-primary flex-1 text-xs">Start Now</a>
                      <a href="/question-bank" className="btn btn-outline flex-1 text-xs">Browse PYQs</a>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ===== PYQ LIBRARY ===== */}
        <section className="mt-14">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Previous Year Paper Library</h2>
            <span className="text-xs text-muted-foreground">Exam-authority archives</span>
          </div>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {pyqLibrary.map((p, i) => (
              <motion.div
                key={p.authority}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                className="card p-6 transition hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/5"
              >
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-base font-bold ${p.accent}`}>
                  {p.authority.split(" ")[1] || "PYQ"}
                </div>
                <h3 className="mt-3 text-base font-bold">{p.authority}</h3>
                <p className="text-xs text-muted-foreground">{p.tag}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {p.years.map((y) => (
                    <a
                      key={y}
                      href={`/question-bank?exam=${encodeURIComponent(p.authority)}`}
                      className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:border-primary hover:text-primary"
                    >
                      {y}
                    </a>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      </main>

      <footer className="mt-14 border-t border-border bg-muted/50 py-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 text-sm text-muted-foreground sm:flex-row">
          <span>© 2026 SSC Prep Hub · sscprephub.in</span>
          <a href="/" className="hover:text-foreground">← Home</a>
        </div>
      </footer>
    </div>
  );
}
