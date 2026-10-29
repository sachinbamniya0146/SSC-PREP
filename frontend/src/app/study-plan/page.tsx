"use client";

// Study plan SET-UP page (rewritten Oct 28 2026).
//
//  * A student who already has a plan lands on the Prep Board (/study-plan/board) - the old overview here duplicated it with
//    less accurate numbers. "Change" / "Plan settings" on the board come back here with ?edit=1.
//  * No plan yet, or ?edit=1: pick the exam and the date by which the syllabus should be finished. Saving replaces the plan's
//    exam / date / daily target; chapter progress (ticked chapters, test results) is kept.
import * as React from "react";
import { useFeatures, FeatureOff } from "@/lib/features";
import { API_BASE, fetchAuth } from "@/lib/api";
import DateField from "@/components/DateField";
import { useT } from "@/lib/i18n";
import { CardSkeletons, ErrorNote, ShellHeader } from "@/components/AppShell";

type Exam = { id: string; name: string };
type ExistingPlan = { examId: string; targetDate: string } | null;

/** today's calendar day in India, as YYYY-MM-DD (the server counts days in IST too) */
const istToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** `key` + n calendar months; 31 Aug + 6 months = 28/29 Feb, never "3 Mar" */
function addMonths(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, d));
  if (dt.getUTCDate() !== d) return new Date(Date.UTC(y, m + n, 0)).toISOString().slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

function StudyPlanPageInner() {
  const tr = useT();
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [exams, setExams] = React.useState<Exam[]>([]);
  const [existing, setExisting] = React.useState<ExistingPlan>(null);
  const [selectedExam, setSelectedExam] = React.useState("");
  const [months, setMonths] = React.useState<"3" | "6" | "12">("3");
  // exact date typed / picked by the student; "" = use the month chips
  const [targetIso, setTargetIso] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [formError, setFormError] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const wantsEdit = new URLSearchParams(window.location.search).get("edit") === "1";
      const planRes = await fetchAuth(`${API_BASE}/study-plan`);
      // an empty body (no plan yet) is a normal 200/204 - only a real HTTP error is a failure
      if (!planRes.ok && planRes.status !== 204) throw new Error("plan");
      const plan = planRes.status === 204 ? null : await planRes.json().catch(() => null);
      if (plan?.id && !wantsEdit) {
        window.location.replace("/study-plan/board");
        return;
      }
      const metaRes = await fetchAuth(`${API_BASE}/bank/meta`);
      if (!metaRes.ok) throw new Error("meta");
      const meta = await metaRes.json().catch(() => null);
      // S41: /bank/meta lists only exams that have questions; a plan made earlier keeps its own exam in the list.
      const visible: Exam[] = Array.isArray(meta?.exams) ? meta.exams : [];
      const all: Exam[] = Array.isArray(meta?.allExams) ? meta.allExams : [];
      const own = plan?.examId && !visible.some((x) => x.id === plan.examId) ? all.find((x) => x.id === plan.examId) : undefined;
      setExams(own ? [...visible, own] : visible);
      if (plan?.id) {
        setExisting({ examId: plan.examId, targetDate: String(plan.targetDate).slice(0, 10) });
        setSelectedExam(plan.examId);
        setTargetIso(String(plan.targetDate).slice(0, 10));
      }
    } catch {
      setLoadError(tr("Could not load. Check your internet and try again.", "Load nahi hua. Internet check karke dobara try karein."));
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    load();
  }, [load]);

  const effectiveTarget = targetIso || addMonths(istToday(), Number(months));

  const save = async () => {
    setFormError("");
    if (!selectedExam) return setFormError(tr("Please choose your exam.", "Pehle apna exam chunein."));
    if (effectiveTarget <= istToday()) return setFormError(tr("The target date must be tomorrow or later.", "Target date kal ya uske baad ki honi chahiye."));
    setBusy(true);
    try {
      const r = await fetchAuth(`${API_BASE}/study-plan/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ examId: selectedExam, type: "COMBINED", targetDate: effectiveTarget }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        const msg = Array.isArray(d?.message) ? d.message.join(", ") : d?.message;
        throw new Error(msg || tr("Could not save the plan. Please try again.", "Plan save nahi hua. Dobara try karein."));
      }
      window.location.assign("/study-plan/board");
    } catch (e: any) {
      setFormError(e?.message || tr("Could not save the plan. Please try again.", "Plan save nahi hua. Dobara try karein."));
      setBusy(false);
    }
  };

  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ShellHeader />
      <main className="mx-auto max-w-2xl px-4 py-8">
        {loading ? (
          <CardSkeletons count={2} />
        ) : loadError ? (
          <ErrorNote onRetry={load} retryLabel={tr("Try again", "Dobara try karein")}>{loadError}</ErrorNote>
        ) : (
          <>
            {existing && (
              <a href="/study-plan/board" className="mb-4 inline-block text-sm font-semibold text-primary">← {tr("Back to my Prep Board", "Meri Prep Board par wapas")}</a>
            )}
            <h1 className="text-2xl font-bold tracking-tight">
              {existing ? tr("Change your study plan", "Study plan badlein") : tr("Create your study plan", "Apna study plan banayein")} 📋
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {tr(
                "Choose your exam and the date by which you want to finish the syllabus. We split it into a daily target: chapters, practice questions and mocks.",
                "Exam aur woh date chunein jab tak syllabus khatam karna hai. Hum use daily target me baant dete hain: chapters, practice sawal aur mocks.",
              )}
            </p>
            {existing && (
              <p className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {tr(
                  `Your ticked chapters and test results are kept. Current target date: ${fmt(existing.targetDate)}.`,
                  `Aapke tick kiye chapters aur test results safe rahenge. Abhi ki target date: ${fmt(existing.targetDate)}.`,
                )}
              </p>
            )}

            <form
              className="card mt-5 space-y-5 p-5 sm:p-6"
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy) save();
              }}
              noValidate
            >
              <div>
                <label htmlFor="plan-exam" className="text-sm font-medium">{tr("Your exam", "Aapka exam")}</label>
                <select
                  id="plan-exam"
                  value={selectedExam}
                  onChange={(e) => setSelectedExam(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm"
                >
                  <option value="">{tr("Choose exam…", "Exam chunein…")}</option>
                  {exams.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>

              <fieldset>
                <legend className="text-sm font-medium">{tr("Finish the syllabus in", "Syllabus kab tak khatam karna hai")}</legend>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(["3", "6", "12"] as const).map((m) => {
                    const on = !targetIso && months === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          setMonths(m);
                          setTargetIso("");
                        }}
                        className={`min-h-[44px] rounded-lg border px-3 py-2 text-sm font-semibold transition ${on ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}
                      >
                        {m} {tr("months", "mahine")}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">{tr("Or pick an exact date (type it or use the 📅 calendar):", "Ya exact date chunein (likhein ya 📅 calendar se):")}</p>
                <div className="mt-1">
                  <DateField className="min-h-[44px] w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm" value={targetIso} onChange={setTargetIso} placeholder="DD/MM/YYYY" />
                </div>
                <p className="mt-2 text-xs font-medium">
                  {tr("Target date", "Target date")}: {fmt(effectiveTarget)}
                </p>
              </fieldset>

              {formError && (
                <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm font-medium text-danger">{formError}</p>
              )}

              <button
                type="submit"
                disabled={busy || !selectedExam}
                className="min-h-[48px] w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
              >
                {busy ? tr("Saving…", "Save ho raha hai…") : existing ? tr("Save changes", "Badlav save karein") : tr("Create my plan", "Mera plan banayein")}
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}

export default function StudyPlanPage() {
  const { on, loaded } = useFeatures();
  if (loaded && !on("studyPlan")) return <FeatureOff title="Study plan is switched off for now" />;
  return <StudyPlanPageInner />;
}
