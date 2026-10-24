"use client";

import * as React from "react";
import { Reveal } from "@/components/Reveal";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

const exams = [
  { id: "exam-cgl", name: "SSC CGL", sub: "Combined Graduate Level", tone: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  { id: "exam-chsl", name: "SSC CHSL", sub: "10+2 Level", tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  { id: "exam-cpo", name: "SSC CPO", sub: "Sub-Inspector", tone: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  { id: "exam-mts", name: "SSC MTS", sub: "Multi Tasking Staff", tone: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
  { id: "exam-gd", name: "SSC GD", sub: "Constable (GD)", tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  { id: "exam-je", name: "SSC JE", sub: "Junior Engineer", tone: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" },
  { id: "exam-steno", name: "SSC Steno", sub: "Stenographer C & D", tone: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
  { id: "exam-delhi-police", name: "Delhi Police", sub: "Constable & Head Constable", tone: "bg-teal-500/10 text-teal-600 dark:text-teal-400" },
];

type IconProps = { className?: string };
const svg = (children: React.ReactNode, sw = 1.8) =>
  function Icon({ className = "" }: IconProps) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    );
  };

const IconBook = svg(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>);
const IconBolt = svg(<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />);
const IconChart = svg(<><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></>);
const IconFlame = svg(<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />);
const IconGlobe = svg(<><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></>);
const IconTrophy = svg(<><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></>);
const IconCheck = svg(<polyline points="20 6 9 17 4 12" />, 2.5);
const IconClock = svg(<><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>);
const IconArrow = svg(<><path d="M5 12h14" /><path d="M12 5l7 7-7 7" /></>, 2);
const IconTarget = svg(<><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>);

const features = [
  { icon: IconTarget, title: "Real exam interface", desc: "Question palette, mark for review, section timer and auto-submit, built like the actual SSC CBT.", tone: "bg-primary/10 text-primary" },
  { icon: IconChart, title: "Deep analytics", desc: "Accuracy, speed and weak topics after every test, with a personal study plan built from your attempts.", tone: "bg-info/10 text-info" },
  { icon: IconBook, title: "PYQ question bank", desc: "Previous year questions tagged by exam, year, shift and paper, with detailed solutions.", tone: "bg-success/10 text-success" },
  { icon: IconFlame, title: "Daily practice & streaks", desc: "A short daily set keeps you consistent. Build streaks, earn XP and watch your rank climb.", tone: "bg-warning/10 text-warning" },
  { icon: IconGlobe, title: "Hindi + English", desc: "Every question and explanation is available in both languages. Switch any time.", tone: "bg-accent/10 text-accent" },
  { icon: IconBolt, title: "Instant results", desc: "Score, rank and solution review the moment you submit. Retry only the questions you got wrong.", tone: "bg-primary/10 text-primary" },
];

const steps = [
  { n: "1", title: "Pick your exam", desc: "Choose CGL, CHSL, CPO, MTS, GD or any other exam you are preparing for." },
  { n: "2", title: "Take free tests", desc: "Start with 3 free mocks and 3 free sectional tests on every exam. No card needed." },
  { n: "3", title: "Analyse and improve", desc: "See where you lose marks, fix weak topics, and unlock unlimited tests when ready." },
];

const pricing = [
  {
    name: "Monthly Pass",
    price: "₹11",
    period: "/month",
    blurb: "Everything you need to practise daily.",
    features: ["Unlimited chapter & topic tests", "All PYQ papers", "Full analytics", "AI recommendations"],
    highlight: false,
  },
  {
    name: "Super Pass",
    price: "₹151",
    period: "/24 months",
    blurb: "Best value for a full preparation cycle.",
    features: ["Everything in Monthly Pass", "All mock tests", "PDF downloads", "Priority support"],
    highlight: true,
  },
];

type LbRow = { rank: number; name: string; score: number };

/* ------------------------------------------------------------------ */
/* Hero visual: a static, illustrative preview of the test interface   */
/* ------------------------------------------------------------------ */

function TestPreview() {
  const palette: Record<number, string> = {
    1: "bg-emerald-500 text-white", 2: "bg-emerald-500 text-white", 3: "bg-red-500 text-white",
    4: "bg-emerald-500 text-white", 5: "bg-violet-500 text-white", 6: "bg-primary text-primary-foreground ring-2 ring-primary/30",
  };
  return (
    <div className="relative mx-auto w-full max-w-md" aria-hidden="true">
      <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-primary/20 via-transparent to-accent/20 blur-2xl" />
      <div className="card overflow-hidden shadow-lift">
        <div className="flex items-center justify-between border-b border-border bg-primary px-4 py-2.5 text-primary-foreground">
          <span className="text-xs font-semibold">SSC CGL Tier-I · Mock 12</span>
          <span className="flex items-center gap-1 rounded-md bg-white/15 px-2 py-0.5 text-xs font-mono font-semibold">
            <IconClock className="h-3.5 w-3.5" /> 42:18
          </span>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-4 p-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
              <span className="badge badge-primary">Q.6</span> Quantitative Aptitude · +2 / −0.5
            </div>
            <p className="text-sm font-medium leading-snug">
              A train 150 m long passes a pole in 15 seconds. What is its speed in km/h?
            </p>
            <div className="mt-3 space-y-2">
              {["30 km/h", "36 km/h", "40 km/h", "45 km/h"].map((o, i) => (
                <div
                  key={o}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs ${
                    i === 1 ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border"
                  }`}
                >
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold ${i === 1 ? "border-primary bg-primary text-primary-foreground" : "border-input"}`}>
                    {"ABCD"[i]}
                  </span>
                  {o}
                </div>
              ))}
            </div>
          </div>
          <div className="w-[88px]">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Palette</div>
            <div className="grid grid-cols-3 gap-1.5">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                <span
                  key={n}
                  className={`flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold ${palette[n] || "bg-muted text-muted-foreground"}`}
                >
                  {n}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border bg-muted/50 px-4 py-2.5">
          <span className="rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-semibold">Mark for review</span>
          <span className="rounded-md bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground">Save &amp; Next</span>
        </div>
      </div>
      <div className="absolute -bottom-5 -left-3 hidden rounded-xl border border-border bg-card px-3.5 py-2.5 shadow-lift sm:block">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Your score</div>
        <div className="text-lg font-extrabold text-success">142.5 <span className="text-xs font-semibold text-muted-foreground">/ 200</span></div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function HomePage() {
  const [leaderboard, setLeaderboard] = React.useState<LbRow[]>([]);

  // Real leaderboard preview only; stays hidden if the API has no data.
  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/tests/leaderboard?limit=5");
        if (!res.ok) return;
        const data = await res.json();
        if (data.data && Array.isArray(data.data)) {
          setLeaderboard(
            data.data.map((u: any, i: number) => ({
              rank: u.rank || i + 1,
              name: u.name || `User ${u.userId?.slice(0, 6)}`,
              score: u.score || 0,
            })),
          );
        }
      } catch (e) {
        console.debug("Leaderboard preview fetch failed:", e);
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      {/* ===== HERO ===== */}
      <section className="hero-bg relative overflow-hidden border-b border-border/60">
        <div className="grid-dots pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_75%)]" />
        <div className="container-page relative grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <span className="eyebrow animate-rise">
              India&apos;s SSC practice platform
            </span>
            <h1 style={{ animationDelay: "60ms" }} className="animate-rise mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl lg:text-[3.4rem]">
              Practise like the real exam.
              <br />
              <span className="text-primary">Score like a topper.</span>
            </h1>
            <p style={{ animationDelay: "120ms" }} className="animate-rise mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Full-length SSC mock tests, previous year papers and detailed analytics in Hindi and English.
              Start free today, and unlock everything from just ₹11 a month.
            </p>
            <div style={{ animationDelay: "180ms" }} className="animate-rise mt-8 flex flex-wrap items-center gap-3">
              <a href="/signup" className="btn btn-primary btn-lg shadow-lift">
                Start free practice <IconArrow className="h-4 w-4" />
              </a>
              <a href="#pricing" className="btn btn-outline btn-lg">
                View plans
              </a>
            </div>
            <ul style={{ animationDelay: "240ms" }} className="animate-rise mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {["3 free mocks per exam", "Hindi + English", "Detailed solutions"].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <IconCheck className="h-4 w-4 text-success" /> {t}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ animationDelay: "200ms" }} className="animate-rise">
            <TestPreview />
          </div>
        </div>
      </section>

      {/* ===== STATS STRIP ===== */}
      <section className="border-b border-border bg-card">
        <div className="container-page grid grid-cols-2 gap-6 py-8 text-center md:grid-cols-4">
          {[
            { v: "1,00,000+", l: "Aspirants" },
            { v: "50,000+", l: "PYQ questions" },
            { v: "8", l: "SSC & police exams" },
            { v: "2", l: "Languages" },
          ].map((s) => (
            <div key={s.l}>
              <div className="text-2xl font-extrabold tracking-tight text-primary sm:text-3xl">{s.v}</div>
              <div className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ===== EXAMS ===== */}
      <section id="exams" className="container-page scroll-mt-20 py-16 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="section-title">Prepare for every exam</h2>
          <p className="section-sub">
            Pick an exam to open its PYQs and mock tests. Every exam includes{" "}
            <strong className="text-foreground">3 free mocks + 3 free sectional tests</strong>.
          </p>
        </div>
        <div className="mt-10 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
          {exams.map((exam, i) => (
            <Reveal as="a" key={exam.id} href={`/question-bank?exam=${exam.id}`} delay={(i % 4) * 0.05} className="card card-hover group flex flex-col p-4 sm:p-5">
              <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${exam.tone}`}>
                <IconBook className="h-5 w-5" />
              </span>
              <span className="mt-4 text-base font-bold group-hover:text-primary">{exam.name}</span>
              <span className="mt-0.5 text-xs text-muted-foreground">{exam.sub}</span>
              <span className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs">
                <span className="font-semibold text-success">Free mocks</span>
                <IconArrow className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
              </span>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section className="border-y border-border bg-card">
        <div className="container-page py-16 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="section-title">How it works</h2>
            <p className="section-sub">Three simple steps from sign-up to your best score.</p>
          </div>
          <div className="relative mt-12 grid gap-6 md:grid-cols-3">
            {steps.map((s, i) => (
              <Reveal as="div" delay={i * 0.08}
                key={s.n}
                className="relative rounded-xl border border-border bg-background p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground shadow-sm">
                  {s.n}
                </span>
                <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FEATURES ===== */}
      <section id="features" className="container-page scroll-mt-20 py-16 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="section-title">Everything you need to top the merit list</h2>
          <p className="section-sub">Built around how SSC aspirants actually prepare.</p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <Reveal as="div" delay={(i % 3) * 0.06}
              key={f.title}
              className="card card-hover p-6">
              <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${f.tone}`}>
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-bold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
            </Reveal>
          ))}
        </div>

        {leaderboard.length > 0 && (
          <div className="card mt-6 overflow-hidden">
            <div className="flex items-center gap-3 border-b border-border px-6 py-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning/10 text-warning">
                <IconTrophy className="h-5 w-5" />
              </span>
              <div>
                <h3 className="font-bold leading-tight">Live leaderboard</h3>
                <p className="text-xs text-muted-foreground">Top performers right now</p>
              </div>
              <a href="/leaderboard" className="ml-auto text-sm font-semibold text-primary hover:underline">
                View all
              </a>
            </div>
            <ul className="divide-y divide-border">
              {leaderboard.map((row) => (
                <li key={row.rank} className="flex items-center justify-between px-6 py-3 text-sm">
                  <span className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold">{row.rank}</span>
                    <span className="font-medium">{row.name}</span>
                  </span>
                  <span className="font-mono font-semibold">{row.score}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ===== PRICING ===== */}
      <section id="pricing" className="scroll-mt-20 border-t border-border bg-card">
        <div className="container-page py-16 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="section-title">Simple, honest pricing</h2>
            <p className="section-sub">Start free. Upgrade only when you are ready.</p>
          </div>
          <div className="mx-auto mt-10 grid max-w-3xl gap-6 sm:grid-cols-2">
            {pricing.map((plan, i) => (
              <Reveal as="div" key={plan.name} delay={i * 0.08} className={`relative flex flex-col rounded-2xl border p-7 ${
                  plan.highlight ? "border-primary bg-primary/[0.04] shadow-lift" : "border-border bg-background"
                }`}>
                {plan.highlight && (
                  <span className="absolute -top-3 left-6 rounded-full bg-accent px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-accent-foreground">
                    Best value
                  </span>
                )}
                <h3 className="text-lg font-bold">{plan.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{plan.blurb}</p>
                <div className="mt-5 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold tracking-tight">{plan.price}</span>
                  <span className="text-sm text-muted-foreground">{plan.period}</span>
                </div>
                <ul className="mt-6 flex-1 space-y-3 text-sm">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/15">
                        <IconCheck className="h-3 w-3 text-success" />
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
                <a href="/signup" className={`btn btn-lg mt-8 ${plan.highlight ? "btn-primary" : "btn-outline"}`}>
                  Get started
                </a>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FINAL CTA ===== */}
      <section className="container-page py-16">
        <div className="relative overflow-hidden rounded-3xl bg-primary px-6 py-12 text-center text-primary-foreground sm:px-12">
          <div className="grid-dots pointer-events-none absolute inset-0 opacity-30 invert" />
          <h2 className="relative text-2xl font-extrabold tracking-tight sm:text-3xl">Ready for your next mock?</h2>
          <p className="relative mx-auto mt-2 max-w-lg text-sm opacity-90 sm:text-base">
            Create a free account in under a minute and take your first full-length test today.
          </p>
          <a href="/signup" className="btn btn-lg relative mt-6 bg-white text-primary shadow-lift hover:bg-white/90">
            Create free account <IconArrow className="h-4 w-4" />
          </a>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
