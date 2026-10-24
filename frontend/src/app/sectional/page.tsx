"use client";

import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { AppShell, PageHeading, EmptyState, ErrorNote, ChoiceChip } from "@/components/AppShell";

type Subject = { id: string; name: string; slug: string; questionCount: number };

const COUNTS = [10, 25, 50, 100];

export default function SectionalPage() {
  const t = useT();
  const [subjects, setSubjects] = React.useState<Subject[]>([]);
  const [selected, setSelected] = React.useState<string>("");
  const [count, setCount] = React.useState(25);
  const [loading, setLoading] = React.useState(true);
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState("");
  const [needsLogin, setNeedsLogin] = React.useState(false);

  const loadSubjects = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetchAuth(`${API_BASE}/tests/sectional/subjects`);
      if (!r.ok) {
        if (r.status === 401) setNeedsLogin(true);
        else setError("LOAD");
        return;
      }
      const d = await r.json();
      const list = (Array.isArray(d) ? d : d.subjects || []).filter((s: Subject) => s.questionCount > 0);
      setSubjects(list);
      setSelected((prev) => prev || (list.length > 0 ? list[0].id : ""));
    } catch {
      setError("NETWORK");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadSubjects();
  }, [loadSubjects]);

  const current = subjects.find((s) => s.id === selected);
  // Never offer more questions than the subject actually has.
  const maxForSubject = current ? current.questionCount : 0;
  const effectiveCount = Math.min(count, maxForSubject || count);

  const start = async () => {
    if (!selected) return;
    setStarting(true);
    setError("");
    try {
      // Compose the set now (validates it and lets /test read it from sessionStorage).
      const r = await fetchAuth(`${API_BASE}/tests/sectional?subjectId=${selected}&count=${effectiveCount}`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(`FAILED:${d.message || r.status}`);
        return;
      }
      const d = await r.json();
      sessionStorage.setItem("ssc_sectional_set", JSON.stringify(d));
      sessionStorage.setItem("ssc_sectional_subject", current?.name || "");
      window.location.href = "/test?sectional=1";
    } catch {
      setError("COMPOSE");
    } finally {
      setStarting(false);
    }
  };

  const errorText = error.startsWith("FAILED:")
    ? `${t("Could not compose the test", "Test nahi ban paya")}: ${error.slice(7)}`
    : error === "NETWORK"
      ? t("Could not reach the server. Check your internet.", "Server tak nahi pahunch paye. Internet check karein.")
      : error === "COMPOSE"
        ? t("Network error while composing the test.", "Test banate waqt network error aaya.")
        : error === "LOAD"
          ? t("Subjects could not be loaded.", "Subjects load nahi ho paye.")
          : "";

  return (
    <AppShell>
      <PageHeading
        title={t("Sectional tests", "Sectional tests")}
        subtitle={t(
          "Subject-wise practice with questions pulled from many years of papers.",
          "Subject-wise practice, kai saalon ke papers ke sawalon se.",
        )}
        actions={<a href="/mocks" className="btn btn-outline btn-sm">{t("Mock tests", "Mock tests")}</a>}
      />

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2" aria-busy="true" aria-label="Loading">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card space-y-2 p-4">
              <div className="skeleton h-4 w-1/2" />
              <div className="skeleton h-3 w-2/3" />
            </div>
          ))}
        </div>
      ) : null}

      {!loading && needsLogin ? (
        <EmptyState
          title={t("Log in to start a sectional test", "Sectional test ke liye login karein")}
          action={<a href="/login" className="btn btn-primary">{t("Log in", "Login")}</a>}
        />
      ) : null}

      {!loading && !needsLogin && error && subjects.length === 0 ? (
        <ErrorNote onRetry={loadSubjects} retryLabel={t("Try again", "Dobara try karein")}>{errorText}</ErrorNote>
      ) : null}

      {!loading && !needsLogin && !error && subjects.length === 0 ? (
        <EmptyState
          icon="📚"
          title={t("No subjects ready yet", "Abhi koi subject ready nahi hai")}
          body={t("Subjects appear here once they have bilingual questions. Try the question bank meanwhile.", "Bilingual sawal aate hi subjects yahan dikhenge. Tab tak question bank try karein.")}
          action={<a href="/question-bank" className="btn btn-outline">{t("Open question bank", "Question bank kholein")}</a>}
        />
      ) : null}

      {!loading && !needsLogin && subjects.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem] lg:items-start">
          <section aria-label={t("Choose subject", "Subject chunein")}>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{t("Choose a subject", "Subject chunein")}</h2>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {subjects.map((s) => (
                <ChoiceChip key={s.id} tile selected={selected === s.id} onClick={() => setSelected(s.id)}>
                  <p className="font-semibold">{s.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {s.questionCount.toLocaleString()} {t("bilingual questions", "bilingual sawal")}
                  </p>
                </ChoiceChip>
              ))}
            </div>
          </section>

          {/* Summary + start. Sticks on desktop; sits below the list on phones. */}
          <aside className="card space-y-4 p-5 lg:sticky lg:top-24">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">{t("Questions", "Sawal")}</p>
              <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={t("Questions per test", "Test me sawal")}>
                {COUNTS.map((c) => (
                  <ChoiceChip key={c} selected={effectiveCount === c} disabled={maxForSubject > 0 && c > maxForSubject} onClick={() => setCount(c)}>
                    {c}
                  </ChoiceChip>
                ))}
              </div>
            </div>
            <div className="rounded-lg bg-muted/60 px-3.5 py-3 text-sm">
              <p className="font-semibold">{current?.name}</p>
              <p className="mt-0.5 text-muted-foreground">
                {effectiveCount} {t("questions", "sawal")} · {t("about", "lagbhag")} {Math.max(1, Math.round(effectiveCount * 0.5))} {t("min", "min")}
              </p>
            </div>
            {error && subjects.length > 0 ? <ErrorNote>{errorText}</ErrorNote> : null}
            <button onClick={start} disabled={!selected || starting} className="btn btn-primary btn-lg w-full">
              {starting ? t("Preparing your test…", "Test taiyaar ho raha hai…") : t("Start sectional test", "Sectional test shuru karein")}
            </button>
          </aside>
        </div>
      ) : null}
    </AppShell>
  );
}
