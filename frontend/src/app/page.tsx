"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { ThemeContext } from "@/components/theme-provider";
import { api } from "@/lib/api";

const exams = [
  { id: "exam-cgl", name: "SSC CGL", short: "CGL", color: "from-blue-500 to-cyan-500" },
  { id: "exam-chsl", name: "SSC CHSL", short: "CHSL", color: "from-emerald-500 to-teal-500" },
  { id: "exam-cpo", name: "SSC CPO", short: "CPO", color: "from-orange-500 to-red-500" },
  { id: "exam-mts", name: "SSC MTS", short: "MTS", color: "from-purple-500 to-pink-500" },
  { id: "exam-gd", name: "SSC GD", short: "GD", color: "from-amber-500 to-yellow-500" },
  { id: "exam-je", name: "SSC JE", short: "JE", color: "from-indigo-500 to-purple-500" },
  { id: "exam-steno", name: "SSC Stenographer", short: "Steno", color: "from-rose-500 to-pink-500" },
  { id: "exam-delhi-police", name: "Delhi Police", short: "DP", color: "from-green-500 to-emerald-500" },
];

type IconProps = { className?: string };

const IconExam = ({ className = "" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

const IconBolt = ({ className = "" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const IconChart = ({ className = "" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18" />
    <path d="M18 17V9" />
    <path d="M13 17V5" />
    <path d="M8 17v-3" />
  </svg>
);

const IconBook = ({ className = "" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

const IconFlame = ({ className = "" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  </svg>
);

const IconGlobe = ({ className = "" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    <path d="M2 12h20" />
  </svg>
);

const IconTrophy = ({ className = "" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </svg>
);

const IconCheck = ({ className = "" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const IconLock = ({ className = "" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 15v3a2 2 0 1 0 4 0v-3" />
    <path d="M16 11V7a4 4 0 1 0-8 0v4" />
    <rect x="5" y="11" width="14" height="10" rx="2" />
  </svg>
);

const IconUsers = ({ className = "" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
    <path d="M2 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
  </svg>
);

const features = [
  {
    icon: IconExam,
    title: "Real SSC Exam Experience",
    desc: "Question palette, mark-for-review, calculator, auto-submit — exactly like the real exam hall.",
    accent: "text-primary bg-primary/10",
  },
  {
    icon: IconBolt,
    title: "AI-Powered Analytics",
    desc: "Weak topics, predicted SSC score, all-India rank & a personalised study plan built by AI.",
    accent: "text-accent bg-accent/10",
  },
  {
    icon: IconBook,
    title: "PYQ Question Bank",
    desc: "Lakhs of previous year questions with source PDF, exam, year, shift & paper tags.",
    accent: "text-info bg-info/10",
  },
  {
    icon: IconFlame,
    title: "Daily Practice + Streaks",
    desc: "10 free questions daily, streak multipliers, XP & coins. Consistency builds rank.",
    accent: "text-warning bg-warning/10",
  },
  {
    icon: IconGlobe,
    title: "Hindi + English",
    desc: "Every question in both languages with instant Hindi explanations — full bilingual support.",
    accent: "text-success bg-success/10",
  },
];

// Dynamic leaderboard preview - fetched from API to avoid fake data
// This will be populated client-side via useEffect calling /tests/leaderboard
const leaderboardPreview: { rank: number; name: string; score: number; you: boolean }[] = [];

const pricing = [
  {
    name: "Monthly Pass",
    price: "₹19",
    period: "/month",
    features: [
      "Unlimited chapter & topic tests",
      "All PYQ papers",
      "Full analytics",
      "AI recommendations",
    ],
    highlight: false,
  },
  {
    name: "Super Pass",
    price: "₹199",
    period: "/24 months",
    features: [
      "Everything in Monthly Pass",
      "All mock tests",
      "PDF downloads",
      "Priority support",
    ],
    highlight: true,
  },
];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
};

export default function HomePage() {
  const { theme, toggleTheme } = React.useContext(ThemeContext);
  const [isLoggedIn, setIsLoggedIn] = React.useState(false);
  const [leaderboardPreview, setLeaderboardPreview] = React.useState<{ rank: number; name: string; score: number; you: boolean }[]>([]);

  React.useEffect(() => {
    const token = localStorage.getItem("ssc_access_token");
    setIsLoggedIn(!!token);
  }, []);

  // Fetch real leaderboard data for the preview
  React.useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const res = await fetch("/api/v1/tests/leaderboard?limit=5");
        if (res.ok) {
          const data = await res.json();
          if (data.data && Array.isArray(data.data)) {
            setLeaderboardPreview(data.data.map((u: any, i: number) => ({
              rank: u.rank || i + 1,
              name: u.name || `User ${u.userId?.slice(0, 6)}`,
              score: u.score || 0,
              you: false // Don't mark as "you" on landing page
            })));
          }
        }
      } catch (e) {
        // Silently fail - empty leaderboard is better than fake data
        console.debug("Leaderboard preview fetch failed:", e);
      }
    };
    fetchLeaderboard();
  }, []);

  // Exam card click handler — redirect to question bank with exam filter
  const handleExamClick = (exam: typeof exams[0]) => {
    window.location.href = `/question-bank?exam=${exam.id}`;
  };

  return (
    <div className="min-h-screen bg-background">
      {/* ===== NAVBAR ===== */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <a href="/" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">
              S
            </span>
            <span className="text-lg font-bold tracking-tight">
              SSC<span className="text-primary">PrepHub</span>
            </span>
          </a>
          <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
            <a href="#tests" className="hover:text-foreground">Tests</a>
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#pricing" className="hover:text-foreground">Pricing</a>
            <a href="#blog" className="hover:text-foreground">Blog</a>
          </nav>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="rounded-lg border border-border p-2 text-sm hover:bg-muted"
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
            {isLoggedIn ? (
              <a
                href="/dashboard"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
              >
                Dashboard
              </a>
            ) : (
              <a
                href="/login"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
              >
                Login
              </a>
            )}
          </div>
        </div>
      </header>

      {/* ===== HERO ===== */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" />
        <div className="pointer-events-none absolute top-40 right-0 h-72 w-72 rounded-full bg-accent/10 blur-3xl" />
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.1 } } }}
          className="mx-auto max-w-7xl px-4 pt-20 pb-16 text-center"
        >
          <motion.span
            variants={fadeUp}
            className="mb-6 inline-block rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary"
          >
            🇮🇳 India's Most Advanced SSC Practice Platform
          </motion.span>
          <motion.h1
            variants={fadeUp}
            className="mx-auto max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl"
          >
            Crack SSC CGL &amp; CHSL with{" "}
            <span className="bg-gradient-to-r from-primary to-fuchsia-500 bg-clip-text text-transparent">
              AI-Powered
            </span>{" "}
            Mock Tests
          </motion.h1>
          <motion.p
            variants={fadeUp}
            className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground"
          >
            Real exam-format tests, lakhs of PYQ questions, instant results,
            all-India rank &amp; a personal AI study plan — starting at just ₹19.
          </motion.p>
          <motion.div
            variants={fadeUp}
            className="mt-8 flex flex-wrap items-center justify-center gap-4"
          >
            <a
              href="/signup"
              className="rounded-xl bg-primary px-8 py-3.5 text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition hover:-translate-y-0.5 hover:opacity-90 active:translate-y-0"
            >
              Start Free Practice →
            </a>
            <a
              href="#pricing"
              className="rounded-xl border border-border bg-card px-8 py-3.5 text-base font-semibold transition hover:bg-muted active:translate-y-0"
            >
              View Plans
            </a>
          </motion.div>
          <motion.div
            variants={fadeUp}
            className="mt-10 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-sm text-muted-foreground"
          >
            <span className="flex items-center gap-1.5">
              <IconCheck className="h-4 w-4 text-success" /> 1,00,000+ Aspirants
            </span>
            <span className="flex items-center gap-1.5">
              <IconCheck className="h-4 w-4 text-success" /> 50,000+ PYQ Questions
            </span>
            <span className="flex items-center gap-1.5">
              <IconCheck className="h-4 w-4 text-success" /> Hindi + English
            </span>
          </motion.div>
        </motion.div>
      </section>

      {/* ===== EXAMS ===== */}
      <section id="tests" className="mx-auto max-w-7xl px-4 py-16">
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="text-center text-3xl font-bold"
        >
          Prepare for Every SSC Exam
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className="mx-auto mt-3 max-w-2xl text-center text-sm text-muted-foreground"
        >
          Click any exam to start. <strong>3 free mock tests + 3 free sectional tests</strong> on every exam.
          Unlimited access with a plan — starting at just ₹19/month.
        </motion.p>
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {exams.map((exam, i) => (
            <motion.div
              key={exam.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: i * 0.05 }}
              onClick={() => handleExamClick(exam)}
              className={`group relative cursor-pointer rounded-xl border border-border bg-card p-5 text-center transition hover:-translate-y-1 hover:border-primary hover:shadow-xl`}
            >
              <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${exam.color} text-white shadow-lg`}>
                <IconExam className="h-5 w-5" />
              </div>
              <div className="mt-2 font-semibold group-hover:text-primary text-base">
                {exam.name}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                PYQs + Mock Tests
              </div>
              <div className="mt-2 flex items-center justify-center gap-1">
                <span className="text-xs text-success">✓ 3 Free Mocks</span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-success">✓ 3 Free Sectional</span>
              </div>
              {/* Lock icon for premium upgrade hint */}
              <div className="absolute -top-1 -right-1 hidden group-hover:block">
                <IconLock className="h-3 w-3 text-muted-foreground" />
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ===== FREE TIER EXPLAINER ===== */}
      <section className="mx-auto max-w-7xl px-4 py-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="rounded-2xl border border-border bg-gradient-to-br from-primary/5 to-accent/5 p-8 text-center"
        >
          <h3 className="text-2xl font-bold mb-3">Zero-Risk Learning — Start Free</h3>
          <p className="text-sm text-muted-foreground max-w-2xl mx-auto mb-6">
            New to SSC PrepHub? Get <strong>3 free mock tests + 3 free sectional tests</strong>
            on every SSC exam — no payment required. Each mock gives you an
            all-India rank, detailed analytics, and a personalized study plan.
            When you're ready, unlock unlimited tests, PDF downloads, and full
            analytics with a plan starting at just ₹19/month.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-6 text-center">
            <div>
              <div className="text-2xl font-bold text-success">3</div>
              <div className="text-xs text-muted-foreground">Free Mock Tests</div>
            </div>
            <div className="text-3xl font-bold text-primary">+</div>
            <div>
              <div className="text-2xl font-bold text-success">3</div>
              <div className="text-xs text-muted-foreground">Free Sectional Tests</div>
            </div>
            <div className="mx-4 my-1 h-10 w-px bg-border" />
            <div>
              <div className="text-2xl font-bold text-primary">₹19</div>
              <div className="text-xs text-muted-foreground">per month (unlimited)</div>
            </div>
          </div>
          <div className="mt-6">
            <a
              href="/question-bank?exam=exam-cgl"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-8 py-3 text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition hover:-translate-y-0.5 hover:opacity-90 active:translate-y-0"
            >
              <IconUsers className="h-4 w-4" />
              Start Free Practice →
            </a>
          </div>
        </motion.div>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section className="mx-auto max-w-5xl px-4 py-16">
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="text-center text-3xl font-bold"
        >
          How It Works
        </motion.h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: 0.05 }}
            className="card p-6 text-center"
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <span className="text-xl font-bold">1</span>
            </div>
            <h3 className="mt-3 font-semibold">Choose Your Exam</h3>
            <p className="mt-2 text-sm text-muted-foreground">Click any exam card to see PYQs and mock tests for that exam only.</p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: 0.1 }}
            className="card p-6 text-center"
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <span className="text-xl font-bold">2</span>
            </div>
            <h3 className="mt-3 font-semibold">Start Free Tests</h3>
            <p className="mt-2 text-sm text-muted-foreground">3 free mock tests + 3 free sectional tests per exam. No card needed.</p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: 0.15 }}
            className="card p-6 text-center"
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <span className="text-xl font-bold">3</span>
            </div>
            <h3 className="mt-3 font-semibold">Upgrade for Unlimited</h3>
            <p className="mt-2 text-sm text-muted-foreground">From ₹19/month — unlock all tests, analytics, PDF downloads.</p>
          </motion.div>
        </div>
      </section>

      {/* ===== FEATURES ===== */}
      <section id="features" className="bg-muted/50 py-16">
        <div className="mx-auto max-w-7xl px-4">
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4 }}
            className="text-center text-3xl font-bold"
          >
            Everything You Need to Top the Merit List
          </motion.h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.35, delay: (i % 3) * 0.08 }}
                className="card p-6 transition hover:-translate-y-1 hover:shadow-md"
              >
                <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${f.accent}`}>
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-3 font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
              </motion.div>
            ))}
            {/* Live Leaderboard feature card - only show with real data */}
            {leaderboardPreview.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.35, delay: 0.16 }}
                className="card overflow-hidden transition hover:-translate-y-1 hover:shadow-md"
              >
                <div className="p-6">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-warning/10 text-warning">
                    <IconTrophy className="h-5 w-5" />
                  </div>
                  <h3 className="mt-3 font-semibold">Live All-India Leaderboard</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Realtime rank vs 1 lakh+ aspirants after every mock.
                  </p>
                </div>
                <div className="mx-6 mb-6 space-y-1.5 rounded-xl border border-border bg-background/60 p-3">
                  {leaderboardPreview.map((row) => (
                    <div
                      key={row.rank}
                      className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-xs ${
                        row.you
                          ? "bg-primary/15 font-semibold text-primary"
                          : "text-muted-foreground"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="w-3 font-bold">{row.rank}</span>
                        <span>{row.name}</span>
                      </span>
                      <span className="font-mono">{row.score}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </section>

      {/* ===== PRICING ===== */}
      <section id="pricing" className="mx-auto max-w-7xl px-4 py-16">
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="text-center text-3xl font-bold"
        >
          Simple, Honest Pricing
        </motion.h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-muted-foreground">
          No hidden fees. Cancel anytime. Start free, upgrade when you're ready.
        </p>
        <div className="mx-auto mt-10 grid max-w-3xl gap-6 sm:grid-cols-2">
          {pricing.map((plan, i) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.1 }}
              className={`relative rounded-2xl border p-8 ${
                plan.highlight
                  ? "border-primary bg-primary/5 shadow-xl shadow-primary/10"
                  : "border-border bg-card"
              }`}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
                  BEST VALUE
                </span>
              )}
              <h3 className="text-lg font-semibold">{plan.name}</h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold">{plan.price}</span>
                <span className="text-sm text-muted-foreground">{plan.period}</span>
              </div>
              <ul className="mt-6 space-y-2.5 text-sm text-muted-foreground">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success/15">
                      <IconCheck className="h-3 w-3 text-success" />
                    </span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <a
                href="/signup"
                className={`mt-8 block rounded-xl py-3 text-center font-semibold transition hover:-translate-y-0.5 active:translate-y-0 ${
                  plan.highlight
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30 hover:opacity-90"
                    : "border border-border hover:bg-muted"
                }`}
              >
                Get Started
              </a>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="border-t border-border bg-muted/50 py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground sm:flex-row">
          <span>© 2026 SSC Prep Hub · sscprephub.in</span>
          <div className="flex gap-6">
            <a href="#" className="hover:text-foreground">Privacy</a>
            <a href="#" className="hover:text-foreground">Terms</a>
            <a href="#" className="hover:text-foreground">Contact</a>
          </div>
        </div>
      </footer>

    </div>
  );
}
