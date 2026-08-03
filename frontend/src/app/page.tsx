"use client";

import * as React from "react";
import { ThemeContext } from "@/components/theme-provider";

const exams = [
  "SSC CGL",
  "SSC CHSL",
  "SSC CPO",
  "SSC MTS",
  "SSC GD",
  "SSC JE",
  "SSC Stenographer",
  "Delhi Police",
];

const features = [
  {
    title: "Real SSC Exam Experience",
    desc: "Question palette, mark-for-review, calculator, auto-submit — exactly like the real exam hall.",
  },
  {
    title: "AI-Powered Analytics",
    desc: "Weak topics, predicted SSC score, all-India rank & a personalised study plan built by AI.",
  },
  {
    title: "PYQ Question Bank",
    desc: "Lakhs of previous year questions with source PDF, exam, year, shift & paper tags.",
  },
  {
    title: "Daily Practice + Streaks",
    desc: "10 free questions daily, streak multipliers, XP & coins. Consistency builds rank.",
  },
  {
    title: "Hindi + English",
    desc: "Every question in both languages with instant Hindi explanations.",
  },
  {
    title: "Live All-India Leaderboard",
    desc: "Realtime rank vs 1 lakh+ aspirants after every mock.",
  },
];

const pricing = [
  {
    name: "Monthly Pass",
    price: "₹19",
    period: "/month",
    features: ["Unlimited chapter & topic tests", "All PYQ papers", "Full analytics", "AI recommendations"],
  },
  {
    name: "Super Pass",
    price: "₹199",
    period: "/24 months",
    features: ["Everything in Monthly Pass", "All mock tests", "PDF downloads", "Priority support"],
    highlight: true,
  },
];

export default function HomePage() {
  const { theme, toggleTheme } = React.useContext(ThemeContext);

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
            <a
              href="/login"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              Login
            </a>
          </div>
        </div>
      </header>

      {/* ===== HERO ===== */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" />
        <div className="mx-auto max-w-7xl px-4 pt-20 pb-16 text-center">
          <span className="mb-6 inline-block rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary">
            🇮🇳 India's Most Advanced SSC Practice Platform
          </span>
          <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">
            Crack SSC CGL &amp; CHSL with{" "}
            <span className="bg-gradient-to-r from-primary to-fuchsia-500 bg-clip-text text-transparent">
              AI-Powered
            </span>{" "}
            Mock Tests
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Real exam-format tests, lakhs of PYQ questions, instant results,
            all-India rank &amp; a personal AI study plan — starting at just ₹19.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <a
              href="/signup"
              className="rounded-xl bg-primary px-8 py-3.5 text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition hover:opacity-90"
            >
              Start Free Practice →
            </a>
            <a
              href="#pricing"
              className="rounded-xl border border-border bg-card px-8 py-3.5 text-base font-semibold transition hover:bg-muted"
            >
              View Plans
            </a>
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-sm text-muted-foreground">
            <span>✅ 1,00,000+ Aspirants</span>
            <span>✅ 50,000+ PYQ Questions</span>
            <span>✅ Hindi + English</span>
          </div>
        </div>
      </section>

      {/* ===== EXAMS ===== */}
      <section id="tests" className="mx-auto max-w-7xl px-4 py-16">
        <h2 className="text-center text-3xl font-bold">Prepare for Every SSC Exam</h2>
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {exams.map((exam) => (
            <div
              key={exam}
              className="group cursor-pointer rounded-xl border border-border bg-card p-5 text-center transition hover:-translate-y-1 hover:border-primary hover:shadow-lg"
            >
              <div className="text-xl">📘</div>
              <div className="mt-2 font-semibold group-hover:text-primary">
                {exam}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                PYQs + Mock Tests
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ===== FEATURES ===== */}
      <section id="features" className="bg-muted/50 py-16">
        <div className="mx-auto max-w-7xl px-4">
          <h2 className="text-center text-3xl font-bold">
            Everything You Need to Top the Merit List
          </h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-border bg-card p-6 transition hover:shadow-md"
              >
                <div className="text-2xl">✨</div>
                <h3 className="mt-3 font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== PRICING ===== */}
      <section id="pricing" className="mx-auto max-w-7xl px-4 py-16">
        <h2 className="text-center text-3xl font-bold">Simple, Honest Pricing</h2>
        <div className="mx-auto mt-10 grid max-w-3xl gap-6 sm:grid-cols-2">
          {pricing.map((plan) => (
            <div
              key={plan.name}
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
              <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
                {plan.features.map((f) => (
                  <li key={f}>✅ {f}</li>
                ))}
              </ul>
              <a
                href="/signup"
                className={`mt-8 block rounded-xl py-3 text-center font-semibold transition ${
                  plan.highlight
                    ? "bg-primary text-primary-foreground hover:opacity-90"
                    : "border border-border hover:bg-muted"
                }`}
              >
                Get Started
              </a>
            </div>
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
