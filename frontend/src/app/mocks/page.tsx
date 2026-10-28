"use client";

import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";
import { getStoredLang, useT } from "@/lib/i18n";
import { AppShell, PageHeading, EmptyState, ErrorNote, CardSkeletons, ChoiceChip } from "@/components/AppShell";

type Mock = {
  id: string;
  title: string;
  description?: string | null;
  type: string;
  durationMinutes: number;
  totalQuestions: number;
  totalMarks: number;
  free: boolean;
  locked: boolean;
  reason?: string;
  offerPriceInr?: number;
  offerDays?: number;
  // NEW (Sep 29 2026): PYQ category meta from the auto-created real-paper mocks.
  isPyq?: boolean;
  year?: number | null;
  shift?: string | null;
  // NEW (26 Oct 2026): date-wise + tier-wise mocks (TIER_1 / TIER_2, PAPER_1.. for Tier 2).
  examTier?: string | null;
  tierPaper?: string | null;
};

// Exam picker shape: same fields /bank/meta already returns (question-bank/page.tsx uses the same endpoint).
type ExamOption = { id: string; name: string; count: number };

type Filter = "all" | "free" | "locked" | "pyq";
type TierFilter = "all" | "TIER_1" | "TIER_2";

// The mock name ends with "Set 3" (see backend common/pyq-mock-title.ts): papers of the same year + shift are told apart by it.
// Students never get the real exam date: only the admin sees that.
function setNoOf(title: string): number {
  const m = /Set (\d+)\s*$/.exec(title);
  return m ? Number(m[1]) : 0;
}
function tierLabel(tier?: string | null): string {
  return tier === "TIER_1" ? "Tier 1" : tier === "TIER_2" ? "Tier 2" : "";
}

// Cashfree JS SDK (v3), loaded only when the student is about to pay (same as /premium).
let cashfreeSdkPromise: Promise<any> | null = null;
function loadCashfreeSdk(): Promise<any> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if ((window as any).Cashfree) return Promise.resolve((window as any).Cashfree);
  if (cashfreeSdkPromise) return cashfreeSdkPromise;
  cashfreeSdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    script.async = true;
    script.onload = () => resolve((window as any).Cashfree);
    script.onerror = () => {
      cashfreeSdkPromise = null;
      reject(new Error(getStoredLang() === "hinglish" ? "Payment SDK load nahi hua — internet check karke dobara try karein" : "Payment SDK did not load — check your internet and try again"));
    };
    document.body.appendChild(script);
  });
  return cashfreeSdkPromise;
}

export default function MocksPage() {
  const t = useT();
  const [mocks, setMocks] = React.useState<Mock[]>([]);
  const [offer, setOffer] = React.useState<{ active: boolean; priceInr: number; days: number; message: string } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [payError, setPayError] = React.useState("");
  const [busyId, setBusyId] = React.useState<string | null>(null);
  // Exam scoping (mocks.service.ts#listAvailableMocks): "" = All Exams, same convention as question-bank.
  const [exams, setExams] = React.useState<ExamOption[]>([]);
  const [examId, setExamId] = React.useState<string>("");
  const [filter, setFilter] = React.useState<Filter>("all");
  const [query, setQuery] = React.useState("");
  const [tier, setTier] = React.useState<TierFilter>("all");

  // Exam list for the picker: same /bank/meta endpoint and count > 0 filter as question-bank.
  React.useEffect(() => {
    (async () => {
      try {
        const r = await fetchAuth(`${API_BASE}/bank/meta`);
        const d = await r.json();
        const allExams = Array.isArray(d?.exams) ? d.exams.filter((e: ExamOption) => e.count > 0) : [];
        setExams(allExams);
        const urlExam = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("exam") : null;
        if (urlExam && allExams.some((e: ExamOption) => e.id === urlExam)) setExamId(urlExam);
      } catch {
        // non-fatal: picker just stays hidden / "All Exams"
      }
    })();
  }, []);

  // fetchAuth() so an expired access token auto-refreshes instead of leaving the list empty / all-locked.
  const load = React.useCallback(async (forExamId: string) => {
    try {
      setLoading(true);
      setLoadError("");
      const qs = forExamId ? `?examId=${encodeURIComponent(forExamId)}` : "";
      const res = await fetchAuth(`${API_BASE}/mocks${qs}`);
      if (res.ok) {
        const d = await res.json();
        setMocks(Array.isArray(d.mockAccess) ? d.mockAccess : []);
        setOffer(d.offer ?? null);
      } else {
        setLoadError(res.status === 401 ? "LOGIN" : "FAILED");
      }
    } catch {
      setLoadError("NETWORK");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load(examId);
  }, [examId, load]);

  // SECURITY: real purchases go through the Cashfree order flow (server verifies payment before unlocking).
  // /mocks/purchase is admin-only on the backend; never call it from here.
  const purchase = async (m: Mock) => {
    setPayError("");
    setBusyId(m.id);
    try {
      const res = await fetchAuth(`${API_BASE}/payments/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mockTemplateId: m.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setPayError(err.message || t("Could not start payment. Try again.", "Payment shuru nahi ho paya. Dobara try karein."));
        return;
      }
      const order = await res.json();
      const Cashfree = await loadCashfreeSdk();
      if (!Cashfree) throw new Error("Payment SDK failed to load");
      const cashfree = Cashfree({ mode: order.cashfreeEnv === "PRODUCTION" ? "production" : "sandbox" });
      await cashfree.checkout({ paymentSessionId: order.paymentSessionId, redirectTarget: "_self" });
    } catch (e: any) {
      setPayError(e?.message || t("Could not start payment. Try again.", "Payment shuru nahi ho paya. Dobara try karein."));
    } finally {
      setBusyId(null);
    }
  };

  const counts = React.useMemo(
    () => ({
      all: mocks.length,
      free: mocks.filter((m) => m.free).length,
      locked: mocks.filter((m) => !m.free).length,
      pyq: mocks.filter((m) => m.isPyq).length,
    }),
    [mocks],
  );

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return mocks.filter((m) => {
      if (filter === "free" && !m.free) return false;
      if (filter === "locked" && m.free) return false;
      if (filter === "pyq" && !m.isPyq) return false;
      if (tier !== "all" && m.examTier !== tier) return false;
      if (q && !`${m.title} ${m.year ?? ""} ${m.shift ?? ""} ${tierLabel(m.examTier)}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [mocks, filter, query, tier]);

  // Tier tabs only appear once at least one real paper carries a tier.
  const tierCounts = React.useMemo(
    () => ({
      TIER_1: mocks.filter((m) => m.examTier === "TIER_1").length,
      TIER_2: mocks.filter((m) => m.examTier === "TIER_2").length,
    }),
    [mocks],
  );

  const pyqByYear = new Map<number, Mock[]>();
  for (const m of visible.filter((x) => x.isPyq)) {
    const y = m.year ?? 0;
    if (!pyqByYear.has(y)) pyqByYear.set(y, []);
    pyqByYear.get(y)!.push(m);
  }
  for (const list of Array.from(pyqByYear.values())) {
    list.sort((a, b) => String(a.examTier ?? "").localeCompare(String(b.examTier ?? "")) || String(a.shift ?? "~").localeCompare(String(b.shift ?? "~")) || setNoOf(a.title) - setNoOf(b.title));
  }
  const pyqYears = Array.from(pyqByYear.keys()).sort((a, b) => b - a);
  // Inside a year: one block per shift (Shift 1, Shift 2 ...), papers inside it as Set 1, Set 2 ... A paper with no shift goes last.
  const groupByShift = (list: Mock[]) => {
    const groups: { key: string; label: string; items: Mock[] }[] = [];
    for (const m of list) {
      const key = m.shift ?? "";
      let g = groups.find((x) => x.key === key);
      if (!g) {
        g = { key, label: key, items: [] };
        groups.push(g);
      }
      g.items.push(m);
    }
    return groups.sort((a, b) => (a.key || "~").localeCompare(b.key || "~"));
  };
  const others = visible.filter((m) => !m.isPyq);

  const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: t("All", "Sab") },
    { id: "free", label: t("Free", "Free") },
    { id: "pyq", label: t("Previous year", "Pichle saal") },
    { id: "locked", label: t("Locked", "Locked") },
  ];

  const renderMock = (m: Mock) => {
    const paperNo = m.examTier === "TIER_2" && m.tierPaper ? `${t("Paper", "Paper")} ${m.tierPaper.slice(-1)}` : "";
    const meta = [m.isPyq && m.shift ? m.shift : "", paperNo].filter(Boolean).join(" · ");
    return (
      <div key={m.id} className="card card-hover flex flex-wrap items-center justify-between gap-x-4 gap-y-3 p-4 sm:p-5">
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug">{m.title}</p>
          {meta ? <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p> : null}
          <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>{m.totalQuestions} {t("questions", "sawal")}</span>
            <span>{m.durationMinutes} {t("min", "min")}</span>
            <span>{m.totalMarks} {t("marks", "marks")}</span>
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {m.free ? (
              <span className="badge badge-success">
                {t("Free", "Free")}
                {m.reason?.startsWith("FREE_") ? ` · ${t("2 free per mock", "har mock ke 2 free")}` : ""}
              </span>
            ) : (
              <span className="badge badge-primary">
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="4" y="11" width="16" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                {t("Locked", "Locked")} · ₹{m.offerPriceInr}/{m.offerDays} {t("days", "din")}
              </span>
            )}
            {m.isPyq ? <span className="badge badge-info">PYQ</span> : null}
            {m.examTier ? <span className="badge badge-primary">{tierLabel(m.examTier)}</span> : null}
          </div>
        </div>
        {m.free ? (
          <a href={`/test?template=${encodeURIComponent(m.id)}`} className="btn btn-primary w-full sm:w-auto">
            {t("Start mock", "Mock shuru karein")}
          </a>
        ) : (
          <button onClick={() => purchase(m)} disabled={busyId === m.id} className="btn btn-accent w-full sm:w-auto">
            {busyId === m.id ? t("Opening payment…", "Payment khul raha hai…") : t(`Unlock for ₹${m.offerPriceInr}`, `₹${m.offerPriceInr} me unlock karein`)}
          </button>
        )}
      </div>
    );
  };

  return (
    <AppShell>
      <PageHeading
        title={t("Mock tests", "Mock tests")}
        subtitle={t(
          `2 free mocks per test. Previous-year papers are always free. Unlock more for ₹${offer?.priceInr ?? 10} for ${offer?.days ?? 15} days.`,
          `Har test ke 2 mock free. Pichle saal ke papers hamesha free. Baaki ₹${offer?.priceInr ?? 10} me ${offer?.days ?? 15} din ke liye unlock karein.`,
        )}
        actions={
          <>
            <a href="/sectional" className="btn btn-outline btn-sm">{t("Sectional", "Sectional")}</a>
            <a href="/year-wise" className="btn btn-outline btn-sm">{t("Year-wise", "Year-wise")}</a>
          </>
        }
      />

      {!loading && !loadError && offer?.message ? (
        <div className="card mb-4 border-success/30 bg-success/5 px-5 py-4">
          <p className="text-sm font-semibold text-success">{t("Special offer", "Special offer")}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{offer.message}</p>
        </div>
      ) : null}

      {/* Daily Test (Live mode): one timed plan-based test per day */}
      {!loading && !loadError ? (
        <div className="card mb-6 flex flex-wrap items-center justify-between gap-3 border-primary/30 bg-primary/5 p-4 sm:p-5">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-primary">{t("Daily test (live mode)", "Daily test (live mode)")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                "One timed test a day from your study plan. Server-timed, auto-submits at zero. Missed days stack up as backlog.",
                "Study plan se roz ek timed test. Server-timed, zero par auto-submit. Chhute hue din backlog me jama hote hain.",
              )}
            </p>
          </div>
          <a href="/test?daily=1" className="btn btn-primary w-full sm:w-auto">{t("Start daily test", "Daily test shuru karein")}</a>
        </div>
      ) : null}

      {/* Filters */}
      <div className="mb-5 space-y-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("Filter mocks", "Mocks filter karein")}>
          {FILTERS.map((f) => (
            <ChoiceChip key={f.id} selected={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} <span className="text-xs text-muted-foreground">{counts[f.id]}</span>
            </ChoiceChip>
          ))}
        </div>
        {tierCounts.TIER_1 + tierCounts.TIER_2 > 0 ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("Filter by tier", "Tier se filter karein")}>
            <ChoiceChip selected={tier === "all"} onClick={() => setTier("all")}>{t("All tiers", "Sab tiers")}</ChoiceChip>
            <ChoiceChip selected={tier === "TIER_1"} onClick={() => setTier("TIER_1")}>
              Tier 1 <span className="text-xs text-muted-foreground">{tierCounts.TIER_1}</span>
            </ChoiceChip>
            <ChoiceChip selected={tier === "TIER_2"} onClick={() => setTier("TIER_2")}>
              Tier 2 <span className="text-xs text-muted-foreground">{tierCounts.TIER_2}</span>
            </ChoiceChip>
          </div>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search by title, year or shift", "Title, saal ya shift se dhundhein")}
            aria-label={t("Search mocks", "Mocks dhundhein")}
            className="w-full border bg-card px-3 py-2 text-sm sm:max-w-sm"
          />
          {exams.length > 0 ? (
            <select
              value={examId}
              onChange={(e) => setExamId(e.target.value)}
              aria-label={t("Exam", "Exam")}
              className="w-full border bg-card px-3 py-2 text-sm sm:w-64"
            >
              <option value="">{t("All exams", "Sab exams")}</option>
              {exams.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          ) : null}
        </div>
      </div>

      {payError ? <div className="mb-4"><ErrorNote>{payError}</ErrorNote></div> : null}

      {loading ? <CardSkeletons count={5} /> : null}

      {!loading && loadError ? (
        loadError === "LOGIN" ? (
          <EmptyState
            title={t("Log in to see your mocks", "Mocks dekhne ke liye login karein")}
            body={t("Your free and unlocked mocks show up here after you sign in.", "Login ke baad aapke free aur unlocked mocks yahan dikhenge.")}
            action={<a href="/login" className="btn btn-primary">{t("Log in", "Login")}</a>}
          />
        ) : (
          <ErrorNote onRetry={() => load(examId)} retryLabel={t("Try again", "Dobara try karein")}>
            {loadError === "NETWORK"
              ? t("Could not reach the server. Check your internet.", "Server tak nahi pahunch paye. Internet check karein.")
              : t("Mocks could not be loaded.", "Mocks load nahi ho paye.")}
          </ErrorNote>
        )
      ) : null}

      {!loading && !loadError ? (
        <div className="space-y-8">
          {mocks.length === 0 ? (
            <EmptyState
              icon="📝"
              title={t("No mock tests yet", "Abhi koi mock test nahi hai")}
              body={t(
                examId ? "This exam has no mocks yet. Try All exams, or practise from the question bank meanwhile." : "The question bank is still being loaded. Practise from the question bank meanwhile.",
                examId ? "Is exam ke mocks abhi nahi hain. Sab exams try karein, ya tab tak question bank se practice karein." : "Question bank abhi load ho raha hai. Tab tak question bank se practice karein.",
              )}
              action={<a href="/question-bank" className="btn btn-outline">{t("Open question bank", "Question bank kholein")}</a>}
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon="🔍"
              title={t("Nothing matches", "Kuch match nahi mila")}
              body={t("Try a different filter or clear the search.", "Doosra filter try karein ya search hata dein.")}
              action={
                <button type="button" className="btn btn-outline" onClick={() => { setFilter("all"); setQuery(""); }}>
                  {t("Clear filters", "Filters hatayein")}
                </button>
              }
            />
          ) : null}

          {/* Real PYQ papers grouped Year > Shift. One card = one real paper ("Set n"); the exam date is admin-only. */}
          {pyqYears.map((y) => (
            <section key={y} aria-label={`${y || "Other"} previous year papers`}>
              <h2 className="mb-3 flex items-baseline gap-2 text-lg font-bold">
                {y || t("Other", "Anya")}
                <span className="text-sm font-medium text-muted-foreground">{t("Previous year papers", "Pichle saal ke papers")} · {pyqByYear.get(y)!.length}</span>
              </h2>
              {groupByShift(pyqByYear.get(y)!).map((g) => (
                <div key={g.key || "noshift"} className="mb-4 last:mb-0">
                  {g.label ? (
                    <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
                      {g.label} <span className="font-normal">({g.items.length} {g.items.length === 1 ? t("paper", "paper") : t("papers", "papers")})</span>
                    </h3>
                  ) : null}
                  <div className="space-y-3">{g.items.map(renderMock)}</div>
                </div>
              ))}
            </section>
          ))}

          {others.length > 0 ? (
            <section aria-label="Other mock tests">
              {pyqYears.length > 0 ? (
                <h2 className="mb-3 flex items-baseline gap-2 text-lg font-bold">
                  {t("Other mock tests", "Anya mock tests")}
                  <span className="text-sm font-medium text-muted-foreground">{others.length}</span>
                </h2>
              ) : null}
              <div className="space-y-3">{others.map(renderMock)}</div>
            </section>
          ) : null}
        </div>
      ) : null}
    </AppShell>
  );
}
