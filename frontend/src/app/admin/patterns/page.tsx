"use client";

// Admin → Exam Patterns (NEW Oct 26 2026)
// One screen to create / edit an ExamPattern (sections table, strict sectional lock, scribe time, source note),
// to see whether every section can really be composed from the question bank, and to link / unlink mock tests.
// Nothing here hardcodes an exam number: every value is typed by the admin and checked by the backend
// (admin.controller.ts assertPatternShape) before it is saved.
import * as React from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { AppShell, PageHeading, EmptyState, ErrorNote, CardSkeletons } from "@/components/AppShell";

type Section = {
  name: string;
  subjectSlug: string;
  questions: number | "";
  marks: number | "";
  durationMinutes: number | "";
  scribeMinutes: number | "";
};
type Pattern = {
  id: string;
  examId: string;
  name: string;
  totalQuestions: number;
  totalMarks: number;
  durationMinutes: number;
  negativeMarks: number;
  isActive: boolean;
  lockPreviousSections: boolean;
  scribeExtraMinutes: number;
  sourceNote: string | null;
  sections: Array<Partial<Record<keyof Section, unknown>>>;
  exam?: { name: string; slug: string } | null;
};
type Form = {
  id: string | null; // null = new pattern
  examId: string;
  name: string;
  totalQuestions: number | "";
  totalMarks: number | "";
  durationMinutes: number | "";
  negativeMarks: number | "";
  isActive: boolean;
  lockPreviousSections: boolean;
  scribeExtraMinutes: number | "";
  sourceNote: string;
  sections: Section[];
};
type ExamRow = { id: string; name: string };
type SubjectRow = { id: string; name: string; slug: string };
type SectionHealth = { index: number; name: string; subjectSlug: string | null; subjectName: string | null; questions: number; available: number; status: string };
type TemplateRow = {
  id: string;
  title: string;
  type: string;
  isActive: boolean;
  isPremium: boolean;
  year?: number | null;
  shift?: string | null;
  warning?: string | null;
  missingSections?: string[];
  otherPattern?: string | null;
};
type Health = {
  pattern: { id: string; name: string; examName: string; lock: boolean };
  sections: SectionHealth[];
  linked: TemplateRow[];
  available: TemplateRow[];
};

const emptySection = (): Section => ({ name: "", subjectSlug: "", questions: "", marks: "", durationMinutes: "", scribeMinutes: "" });
const n = (v: number | "") => (v === "" ? 0 : Number(v));
const isVerified = (note: string | null | undefined) => /^VERIFIED\b/i.test((note || "").trim());

function toForm(p: Pattern): Form {
  return {
    id: p.id,
    examId: p.examId,
    name: p.name,
    totalQuestions: p.totalQuestions,
    totalMarks: p.totalMarks,
    durationMinutes: p.durationMinutes,
    negativeMarks: p.negativeMarks,
    isActive: p.isActive,
    lockPreviousSections: p.lockPreviousSections,
    scribeExtraMinutes: p.scribeExtraMinutes,
    sourceNote: p.sourceNote ?? "",
    sections: (Array.isArray(p.sections) ? p.sections : []).map((s) => ({
      name: String(s.name ?? ""),
      subjectSlug: String(s.subjectSlug ?? ""),
      questions: s.questions == null ? "" : Number(s.questions),
      marks: s.marks == null ? "" : Number(s.marks),
      durationMinutes: s.durationMinutes == null ? "" : Number(s.durationMinutes),
      scribeMinutes: s.scribeMinutes == null ? "" : Number(s.scribeMinutes),
    })),
  };
}

/** Same rules as the backend (assertPatternShape) so the admin sees the problem before pressing Save. */
function validate(f: Form): string[] {
  const out: string[] = [];
  if (!f.name.trim()) out.push("Pattern ka naam chahiye");
  if (!f.examId) out.push("Exam chunna zaroori hai");
  if (!(n(f.totalQuestions) > 0)) out.push("Total questions 0 se zyada hone chahiye");
  if (!(n(f.totalMarks) > 0)) out.push("Total marks 0 se zyada hone chahiye");
  if (!(n(f.durationMinutes) > 0)) out.push("Total duration 0 se zyada honi chahiye");
  if (f.sections.length === 0) out.push("Kam se kam ek section chahiye");
  const seen = new Set<string>();
  f.sections.forEach((s, i) => {
    const label = `Section ${i + 1}${s.name ? ` (${s.name})` : ""}`;
    if (!s.name.trim()) out.push(`${label}: naam chahiye`);
    if (!(n(s.questions) > 0)) out.push(`${label}: questions > 0 hone chahiye`);
    if (!(n(s.marks) > 0)) out.push(`${label}: marks > 0 hone chahiye`);
    if (f.lockPreviousSections) {
      if (!(n(s.durationMinutes) > 0)) out.push(`${label}: lock ON ho to section ka time chahiye`);
      if (!s.subjectSlug) out.push(`${label}: lock ON ho to subject chahiye`);
      const nm = `name:${s.name.trim().toLowerCase()}`;
      if (s.name.trim() && seen.has(nm)) out.push(`${label}: do sections ka naam same hai`);
      seen.add(nm);
      if (s.subjectSlug) {
        if (seen.has(s.subjectSlug)) out.push(`${label}: ye subject doosre section me bhi hai`);
        seen.add(s.subjectSlug);
      }
    }
    if (s.scribeMinutes !== "" && n(s.scribeMinutes) < n(s.durationMinutes)) out.push(`${label}: scribe time section ke time se kam nahi ho sakta`);
  });
  return out;
}

const STATUS_STYLE: Record<string, string> = {
  ok: "bg-success/10 text-success",
  short: "bg-warning/10 text-warning",
  blocked: "bg-danger/10 text-danger",
  no_subject: "bg-danger/10 text-danger",
  unknown_subject: "bg-danger/10 text-danger",
};

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60";
const labelCls = "mb-1 block text-xs font-semibold text-muted-foreground";

function NumField({ label, value, onChange, step, min = 0 }: { label: string; value: number | ""; onChange: (v: number | "") => void; step?: number; min?: number }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={min}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        className={inputCls}
      />
    </label>
  );
}

export default function AdminPatternsPage() {
  const t = useT();
  const router = useRouter();

  const [ok, setOk] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [loadErr, setLoadErr] = React.useState("");
  const [patterns, setPatterns] = React.useState<Pattern[]>([]);
  const [exams, setExams] = React.useState<ExamRow[]>([]);
  const [subjects, setSubjects] = React.useState<SubjectRow[]>([]);

  const [form, setForm] = React.useState<Form | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  const [health, setHealth] = React.useState<Health | null>(null);
  const [healthLoading, setHealthLoading] = React.useState(false);
  const [pick, setPick] = React.useState<Set<string>>(new Set());
  const [pyqOnly, setPyqOnly] = React.useState(false);
  const [noticeRef, setNoticeRef] = React.useState("");
  const [showAllAvail, setShowAllAvail] = React.useState(false);

  React.useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem("ssc_user") || "null");
      if (u?.role !== "ADMIN") {
        router.replace("/admin");
        return;
      }
    } catch {
      router.replace("/dashboard");
      return;
    }
    setOk(true);
  }, [router]);

  const loadAll = React.useCallback(async () => {
    setLoading(true);
    setLoadErr("");
    try {
      const [p, e, s] = await Promise.all([
        api<Pattern[]>("/admin/exam-patterns"),
        api<ExamRow[]>("/admin/exams"),
        api<SubjectRow[]>("/bank/subjects"),
      ]);
      setPatterns(Array.isArray(p) ? p : []);
      setExams(Array.isArray(e) ? e : []);
      setSubjects(Array.isArray(s) ? s : []);
    } catch (err) {
      setLoadErr((err as Error).message || "LOAD");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (ok) void loadAll();
  }, [ok, loadAll]);

  const loadHealth = React.useCallback(async (id: string) => {
    setHealthLoading(true);
    try {
      setHealth(await api<Health>(`/admin/exam-patterns/${id}/health`));
    } catch {
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const open = (p: Pattern) => {
    if (dirty && !window.confirm(t("Unsaved changes will be lost. Continue?", "Bina save kiye badlav chale jayenge. Aage badhein?"))) return;
    setForm(toForm(p));
    setDirty(false);
    setMsg(null);
    setPick(new Set());
    setHealth(null);
    void loadHealth(p.id);
  };

  const startNew = () => {
    if (dirty && !window.confirm(t("Unsaved changes will be lost. Continue?", "Bina save kiye badlav chale jayenge. Aage badhein?"))) return;
    setForm({
      id: null,
      examId: exams[0]?.id ?? "",
      name: "",
      totalQuestions: "",
      totalMarks: "",
      durationMinutes: "",
      negativeMarks: "",
      isActive: true,
      lockPreviousSections: false,
      scribeExtraMinutes: 0,
      sourceNote: "",
      sections: [emptySection()],
    });
    setDirty(false);
    setMsg(null);
    setHealth(null);
    setPick(new Set());
  };

  const patch = (p: Partial<Form>) => {
    setForm((f) => (f ? { ...f, ...p } : f));
    setDirty(true);
  };
  const patchSection = (i: number, p: Partial<Section>) => {
    setForm((f) => (f ? { ...f, sections: f.sections.map((s, j) => (j === i ? { ...s, ...p } : s)) } : f));
    setDirty(true);
  };
  const moveSection = (i: number, d: -1 | 1) => {
    setForm((f) => {
      if (!f) return f;
      const j = i + d;
      if (j < 0 || j >= f.sections.length) return f;
      const next = f.sections.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return { ...f, sections: next };
    });
    setDirty(true);
  };
  const removeSection = (i: number) => {
    setForm((f) => (f ? { ...f, sections: f.sections.filter((_, j) => j !== i) } : f));
    setDirty(true);
  };

  const sums = React.useMemo(() => {
    const s = form?.sections ?? [];
    return {
      q: s.reduce((a, r) => a + n(r.questions), 0),
      m: s.reduce((a, r) => a + n(r.marks), 0),
      d: s.reduce((a, r) => a + n(r.durationMinutes), 0),
    };
  }, [form?.sections]);

  const errors = React.useMemo(() => (form ? validate(form) : []), [form]);
  // Soft checks: allowed to save, but the numbers disagree, which is usually a typo.
  const warnings = React.useMemo(() => {
    if (!form) return [] as string[];
    const w: string[] = [];
    if (n(form.totalQuestions) > 0 && sums.q !== n(form.totalQuestions)) w.push(`Sections ke questions ka jod ${sums.q} hai, total ${n(form.totalQuestions)} hai`);
    if (n(form.totalMarks) > 0 && sums.m !== n(form.totalMarks)) w.push(`Sections ke marks ka jod ${sums.m} hai, total ${n(form.totalMarks)} hai`);
    if (form.lockPreviousSections && n(form.durationMinutes) > 0 && sums.d !== n(form.durationMinutes)) w.push(`Sections ke time ka jod ${sums.d} min hai, total ${n(form.durationMinutes)} min hai`);
    return w;
  }, [form, sums]);

  const body = (f: Form) => ({
    ...(f.id ? {} : { examId: f.examId }),
    name: f.name.trim(),
    totalQuestions: n(f.totalQuestions),
    totalMarks: n(f.totalMarks),
    durationMinutes: n(f.durationMinutes),
    negativeMarks: n(f.negativeMarks),
    lockPreviousSections: f.lockPreviousSections,
    scribeExtraMinutes: n(f.scribeExtraMinutes),
    sourceNote: f.sourceNote.trim() || null,
    ...(f.id ? { isActive: f.isActive } : {}),
    sections: f.sections.map((s) => ({
      name: s.name.trim(),
      ...(s.subjectSlug ? { subjectSlug: s.subjectSlug } : {}),
      questions: n(s.questions),
      marks: n(s.marks),
      ...(s.durationMinutes !== "" ? { durationMinutes: n(s.durationMinutes) } : {}),
      ...(s.scribeMinutes !== "" ? { scribeMinutes: n(s.scribeMinutes) } : {}),
    })),
  });

  const run = async (label: string, fn: () => Promise<unknown>, after?: () => Promise<void>) => {
    setMsg(null);
    setSaving(true);
    try {
      await fn();
      setMsg({ ok: true, text: `${label} ✅` });
      if (after) await after();
    } catch (e) {
      setMsg({ ok: false, text: `${label}: ${(e as Error).message || "fail"}` });
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    if (!form || errors.length) return;
    void run("Save", async () => {
      if (form.id) {
        await api(`/admin/exam-patterns/${form.id}`, { method: "PATCH", body: JSON.stringify(body(form)) });
      } else {
        const created = await api<Pattern>("/admin/exam-patterns", { method: "POST", body: JSON.stringify(body(form)) });
        setForm((f) => (f ? { ...f, id: created.id } : f));
        void loadHealth(created.id);
      }
      setDirty(false);
      await loadAll();
      if (form.id) await loadHealth(form.id);
    });
  };

  const markVerified = () => {
    if (!form || !noticeRef.trim()) return;
    const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const stripped = form.sourceNote.replace(/^VERIFIED[^\n]*\n?/i, "").trim();
    patch({ sourceNote: `VERIFIED ${today} against official SSC notice: ${noticeRef.trim()}${stripped ? `\n${stripped}` : ""}` });
    setNoticeRef("");
  };

  const link = (unlink: boolean, ids: string[]) => {
    if (!form?.id || ids.length === 0) return;
    void run(unlink ? "Unlink" : "Link", () => api(`/admin/exam-patterns/${form.id}/link-templates`, { method: "POST", body: JSON.stringify({ templateIds: ids, unlink }) }), async () => {
      setPick(new Set());
      await loadHealth(form.id!);
    });
  };

  const linkAllPyq = () => {
    if (!form?.id) return;
    if (!window.confirm(t("Link EVERY auto PYQ mock of this exam to this pattern?", "Is exam ke SAARE auto PYQ mocks is pattern se jod dein?"))) return;
    void run("Link PYQ", () => api(`/admin/exam-patterns/${form.id}/link-templates`, { method: "POST", body: JSON.stringify({ examId: form.examId, pyqOnly: true }) }), async () => {
      await loadHealth(form.id!);
    });
  };

  const seed = () => {
    if (!window.confirm(t("Create / refresh the two SSC CGL 2026 patterns? Numbers come from a blog, not the official notice.", "SSC CGL 2026 ke do pattern banayein / refresh karein? Numbers blog se hain, official notice se nahi."))) return;
    void run("Seed", () => api("/admin/exam-patterns/seed-ssc-2026", { method: "POST", body: "{}" }), loadAll);
  };

  const remove = () => {
    if (!form?.id) return;
    if (!window.confirm(t("Delete this pattern? Linked mocks go back to the normal single timer.", "Ye pattern delete karein? Jude mocks normal single timer par wapas aa jayenge."))) return;
    void run("Delete", () => api(`/admin/exam-patterns/${form.id}`, { method: "DELETE" }), async () => {
      setForm(null);
      setHealth(null);
      setDirty(false);
      await loadAll();
    });
  };

  const toggle = (id: string) =>
    setPick((s) => {
      const nx = new Set(s);
      if (nx.has(id)) nx.delete(id);
      else nx.add(id);
      return nx;
    });

  const warnText = (r: TemplateRow) =>
    r.warning === "unknown_paper"
      ? t("Year/shift unknown — cannot check this paper", "Year/shift nahi pata — paper check nahi ho sakta")
      : r.warning === "missing_sections"
        ? t(`No questions for: ${(r.missingSections ?? []).join(", ")}. This mock will not open.`, `In sections ke sawal nahi: ${(r.missingSections ?? []).join(", ")}. Ye mock khulega nahi.`)
        : "";

  const availShown = showAllAvail ? health?.available ?? [] : (health?.available ?? []).slice(0, 30);

  if (!ok) return null;

  return (
    <AppShell width="xl">
      <PageHeading
        title={t("Exam patterns", "Exam patterns")}
        subtitle={t(
          "Sections, marks, timers and strict sectional lock. Link mocks to a pattern so they run exactly like the real exam.",
          "Sections, marks, timer aur strict sectional lock. Mocks ko pattern se jodein taaki wo asli exam jaise chalein.",
        )}
        actions={
          <>
            <button type="button" onClick={startNew} className="btn btn-primary btn-sm">
              {t("New pattern", "Naya pattern")}
            </button>
            <button type="button" onClick={seed} disabled={saving} className="btn btn-outline btn-sm">
              {t("Seed SSC CGL 2026", "SSC CGL 2026 seed")}
            </button>
            <a href="/admin" className="btn btn-ghost btn-sm">
              ← Admin
            </a>
          </>
        }
      />

      {msg ? (
        <div role="status" className={`mb-4 rounded-lg border px-3 py-2 text-sm ${msg.ok ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger"}`}>
          {msg.text}
        </div>
      ) : null}

      {loading ? <CardSkeletons count={3} /> : null}
      {!loading && loadErr ? (
        <ErrorNote onRetry={loadAll} retryLabel={t("Try again", "Dobara try karein")}>
          {t("Patterns could not be loaded.", "Patterns load nahi ho paye.")} ({loadErr})
        </ErrorNote>
      ) : null}

      {!loading && !loadErr ? (
        <div className="grid gap-5 lg:grid-cols-[18rem_1fr] lg:items-start">
          {/* ---------- list ---------- */}
          <aside className="card p-3" aria-label={t("Patterns", "Patterns")}>
            {patterns.length === 0 ? (
              <EmptyState
                icon="🧭"
                title={t("No patterns yet", "Abhi koi pattern nahi")}
                body={t("Create one, or seed the SSC CGL 2026 pair.", "Ek banayein, ya SSC CGL 2026 wale do seed karein.")}
              />
            ) : (
              <ul className="space-y-1.5">
                {patterns.map((p) => {
                  const active = form?.id === p.id;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => open(p)}
                        aria-current={active ? "true" : undefined}
                        className={`w-full rounded-lg border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                          active ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                        }`}
                      >
                        <p className="text-sm font-semibold leading-5">{p.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {p.exam?.name ?? "—"} · {p.totalQuestions} Q · {p.durationMinutes} min
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                          {p.lockPreviousSections ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">{t("Sections locked", "Sections lock")}</span> : null}
                          {!p.isActive ? <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{t("Inactive", "Inactive")}</span> : null}
                          {isVerified(p.sourceNote) ? (
                            <span className="rounded-full bg-success/10 px-2 py-0.5 text-success">{t("Verified", "Verified")}</span>
                          ) : (
                            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-warning">{t("Not verified", "Verify nahi")}</span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          {/* ---------- editor ---------- */}
          <div className="space-y-5">
            {!form ? (
              <div className="card p-6 text-sm text-muted-foreground">{t("Pick a pattern on the left, or create a new one.", "Left se pattern chunein, ya naya banayein.")}</div>
            ) : (
              <>
                <section className="card space-y-4 p-4 sm:p-5" aria-label={t("Pattern details", "Pattern ki details")}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block sm:col-span-2">
                      <span className={labelCls}>{t("Name", "Naam")}</span>
                      <input value={form.name} onChange={(e) => patch({ name: e.target.value })} className={inputCls} placeholder="SSC CGL 2026 — Tier 1" />
                    </label>
                    <label className="block">
                      <span className={labelCls}>{t("Exam", "Exam")}</span>
                      <select value={form.examId} onChange={(e) => patch({ examId: e.target.value })} disabled={!!form.id} className={inputCls}>
                        {exams.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                      </select>
                      {form.id ? <span className="mt-1 block text-[11px] text-muted-foreground">{t("Exam cannot change after creation.", "Banne ke baad exam nahi badal sakta.")}</span> : null}
                    </label>
                    {form.id ? (
                      <label className="flex items-end gap-2 pb-2 text-sm font-medium">
                        <input type="checkbox" checked={form.isActive} onChange={(e) => patch({ isActive: e.target.checked })} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                        {t("Pattern is active", "Pattern active hai")}
                      </label>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <NumField label={t("Total questions", "Total sawal")} value={form.totalQuestions} onChange={(v) => patch({ totalQuestions: v })} />
                    <NumField label={t("Total marks", "Total marks")} value={form.totalMarks} onChange={(v) => patch({ totalMarks: v })} step={0.5} />
                    <NumField label={t("Total minutes", "Total minute")} value={form.durationMinutes} onChange={(v) => patch({ durationMinutes: v })} />
                    <NumField label={t("Negative per wrong", "Galat par minus")} value={form.negativeMarks} onChange={(v) => patch({ negativeMarks: v })} step={0.05} />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="card flex cursor-pointer items-start gap-3 p-3">
                      <input
                        type="checkbox"
                        checked={form.lockPreviousSections}
                        onChange={(e) => patch({ lockPreviousSections: e.target.checked })}
                        className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                      />
                      <span>
                        <span className="block text-sm font-semibold">{t("Strict sectional timers", "Strict sectional timer")}</span>
                        <span className="block text-xs text-muted-foreground">
                          {t(
                            "Each section has its own clock; a closed section can never be re-opened. Needs time and subject on every section.",
                            "Har section ka apna clock; band section dobara nahi khulta. Har section me time aur subject chahiye.",
                          )}
                        </span>
                      </span>
                    </label>
                    <NumField label={t("Scribe extra minutes (per section)", "Scribe ke extra minute (har section)")} value={form.scribeExtraMinutes} onChange={(v) => patch({ scribeExtraMinutes: v })} />
                  </div>
                </section>

                {/* sections */}
                <section className="card p-4 sm:p-5" aria-label={t("Sections", "Sections")}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base font-semibold">{t("Sections (in exam order)", "Sections (exam ke order me)")}</h2>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => patch({ totalQuestions: sums.q, totalMarks: sums.m, ...(form.lockPreviousSections ? { durationMinutes: sums.d } : {}) })}
                      >
                        {t("Set totals from sections", "Totals sections se bharein")}
                      </button>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => patch({ sections: [...form.sections, emptySection()] })}>
                        + {t("Section", "Section")}
                      </button>
                    </div>
                  </div>

                  <ol className="space-y-3">
                    {form.sections.map((s, i) => {
                      const h = health?.sections.find((x) => x.index === i);
                      return (
                        <li key={i} className="rounded-lg border border-border p-3">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-muted-foreground">#{i + 1}</span>
                            <div className="flex gap-1">
                              <button type="button" aria-label={t("Move up", "Upar karein")} disabled={i === 0} onClick={() => moveSection(i, -1)} className="btn btn-ghost btn-sm">
                                ↑
                              </button>
                              <button type="button" aria-label={t("Move down", "Neeche karein")} disabled={i === form.sections.length - 1} onClick={() => moveSection(i, 1)} className="btn btn-ghost btn-sm">
                                ↓
                              </button>
                              <button type="button" aria-label={t("Remove section", "Section hatayein")} onClick={() => removeSection(i)} className="btn btn-ghost btn-sm text-danger">
                                ✕
                              </button>
                            </div>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="block">
                              <span className={labelCls}>{t("Section name", "Section ka naam")}</span>
                              <input value={s.name} onChange={(e) => patchSection(i, { name: e.target.value })} className={inputCls} />
                            </label>
                            <label className="block">
                              <span className={labelCls}>{t("Subject", "Subject")}</span>
                              <select value={s.subjectSlug} onChange={(e) => patchSection(i, { subjectSlug: e.target.value })} className={inputCls}>
                                <option value="">— {t("choose", "chunein")} —</option>
                                {s.subjectSlug && !subjects.some((x) => x.slug.toLowerCase() === s.subjectSlug) ? <option value={s.subjectSlug}>{s.subjectSlug} (?)</option> : null}
                                {subjects.map((x) => (
                                  <option key={x.id} value={x.slug.toLowerCase()}>
                                    {x.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                            <NumField label={t("Questions", "Sawal")} value={s.questions} onChange={(v) => patchSection(i, { questions: v })} />
                            <NumField label={t("Marks", "Marks")} value={s.marks} onChange={(v) => patchSection(i, { marks: v })} step={0.5} />
                            <NumField label={t("Minutes", "Minute")} value={s.durationMinutes} onChange={(v) => patchSection(i, { durationMinutes: v })} />
                            <NumField label={t("Scribe minutes", "Scribe minute")} value={s.scribeMinutes} onChange={(v) => patchSection(i, { scribeMinutes: v })} />
                          </div>
                          {h && !dirty ? (
                            <p className={`mt-3 inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[h.status] ?? "bg-muted text-muted-foreground"}`}>
                              {h.status === "ok" && t(`Bank ready: ${h.available} questions available`, `Bank ready: ${h.available} sawal available`)}
                              {h.status === "short" && t(`Only ${h.available} of ${h.questions} questions — paper will be shortened`, `Sirf ${h.available}/${h.questions} sawal — paper chhota banega`)}
                              {h.status === "blocked" && t(`Only ${h.available} questions — mock cannot open`, `Sirf ${h.available} sawal — mock khulega nahi`)}
                              {(h.status === "no_subject" || h.status === "unknown_subject") && t("Subject missing or not found in the bank", "Subject missing ya bank me nahi mila")}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>

                  <p className="mt-3 text-xs text-muted-foreground">
                    {t("Totals from sections:", "Sections ka jod:")} <strong>{sums.q}</strong> {t("questions", "sawal")} · <strong>{sums.m}</strong> marks · <strong>{sums.d}</strong> min
                  </p>
                </section>

                {/* source note */}
                <section className="card space-y-3 p-4 sm:p-5" aria-label={t("Source and verification", "Source aur verification")}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base font-semibold">{t("Source note", "Source note")}</h2>
                    {isVerified(form.sourceNote) ? (
                      <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">{t("Verified against official notice", "Official notice se verify")}</span>
                    ) : (
                      <span className="rounded-full bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">{t("Not verified yet", "Abhi verify nahi")}</span>
                    )}
                  </div>
                  <textarea
                    value={form.sourceNote}
                    onChange={(e) => patch({ sourceNote: e.target.value })}
                    rows={3}
                    className={inputCls}
                    aria-label={t("Source note", "Source note")}
                    placeholder={t("Where did these numbers come from?", "Ye numbers kahan se aaye?")}
                  />
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      value={noticeRef}
                      onChange={(e) => setNoticeRef(e.target.value)}
                      className={inputCls}
                      aria-label={t("Official notice reference", "Official notice ka reference")}
                      placeholder={t("Notice no. / date / ssc.gov.in link", "Notice no. / date / ssc.gov.in link")}
                    />
                    <button type="button" onClick={markVerified} disabled={!noticeRef.trim()} className="btn btn-outline shrink-0">
                      {t("Mark verified", "Verified likhein")}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "Only press this after you have compared every number above with the official SSC notice. It writes “VERIFIED” + date + your reference at the top of the note.",
                      "Ye tabhi dabayein jab upar ke har number ko official SSC notice se mila liya ho. Ye note ke upar “VERIFIED” + date + aapka reference likh deta hai.",
                    )}
                  </p>
                </section>

                {/* save bar */}
                <div className="card sticky bottom-3 z-10 space-y-2 p-3 sm:p-4">
                  {errors.length > 0 ? (
                    <ul className="list-disc space-y-0.5 pl-5 text-xs text-danger" role="alert">
                      {errors.slice(0, 6).map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                      {errors.length > 6 ? <li>+{errors.length - 6} more</li> : null}
                    </ul>
                  ) : null}
                  {errors.length === 0 && warnings.length > 0 ? (
                    <ul className="list-disc space-y-0.5 pl-5 text-xs text-warning">
                      {warnings.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={save} disabled={saving || errors.length > 0 || (!dirty && !!form.id)} className="btn btn-primary">
                      {saving ? t("Saving…", "Save ho raha…") : form.id ? t("Save changes", "Badlav save karein") : t("Create pattern", "Pattern banayein")}
                    </button>
                    {dirty ? <span className="text-xs text-warning">{t("Unsaved changes", "Save nahi hue")}</span> : null}
                    {form.id ? (
                      <button type="button" onClick={remove} disabled={saving} className="btn btn-ghost ml-auto text-danger">
                        {t("Delete", "Delete")}
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* linked mocks */}
                {form.id ? (
                  <section className="card space-y-4 p-4 sm:p-5" aria-label={t("Linked mocks", "Jude mocks")}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-base font-semibold">{t("Mocks using this pattern", "Is pattern se chalne wale mocks")}</h2>
                      <button type="button" onClick={linkAllPyq} disabled={saving || !form.lockPreviousSections || dirty} className="btn btn-outline btn-sm">
                        {t("Link all auto PYQ mocks", "Saare auto PYQ mocks jodein")}
                      </button>
                    </div>
                    {!form.lockPreviousSections ? (
                      <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
                        {t("Turn on “Strict sectional timers” and save before linking mocks, or linking changes nothing.", "Mocks jodne se pehle “Strict sectional timer” ON karke save karein, warna link ka koi asar nahi.")}
                      </p>
                    ) : null}
                    {dirty ? <p className="text-xs text-muted-foreground">{t("Save your changes first so the checks below use the new numbers.", "Pehle badlav save karein taaki neeche ke checks naye numbers par chalein.")}</p> : null}

                    {healthLoading ? <div className="skeleton h-16" aria-busy="true" /> : null}

                    {health && !healthLoading ? (
                      <>
                        {health.linked.length === 0 ? (
                          <p className="text-sm text-muted-foreground">{t("No mock is linked yet.", "Abhi koi mock juda nahi hai.")}</p>
                        ) : (
                          <ul className="space-y-2">
                            {health.linked.map((r) => (
                              <li key={r.id} className="rounded-lg border border-border p-3">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold">{r.title}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {r.type}
                                      {r.year ? ` · ${r.year}` : ""}
                                      {r.shift ? ` · ${r.shift}` : ""} · {r.isActive ? t("Live", "Live") : t("Draft", "Draft")} · {r.isPremium ? "Premium" : "Free"}
                                    </p>
                                  </div>
                                  <button type="button" onClick={() => link(true, [r.id])} disabled={saving} className="btn btn-outline btn-sm">
                                    {t("Unlink", "Alag karein")}
                                  </button>
                                </div>
                                {r.warning ? (
                                  <p role="alert" className="mt-2 rounded-md bg-danger/10 px-2.5 py-1.5 text-xs font-medium text-danger">
                                    ⚠ {warnText(r)}
                                  </p>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        )}

                        <div>
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold">{t("Other mocks of this exam", "Is exam ke baaki mocks")}</h3>
                            <div className="flex flex-wrap items-center gap-3">
                              <label className="flex items-center gap-1.5 text-xs">
                                <input type="checkbox" checked={pyqOnly} onChange={(e) => setPyqOnly(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                                {t("Only PYQ mocks", "Sirf PYQ mocks")}
                              </label>
                              <button type="button" onClick={() => link(false, Array.from(pick))} disabled={saving || pick.size === 0 || !form.lockPreviousSections || dirty} className="btn btn-primary btn-sm">
                                {t(`Link selected (${pick.size})`, `Chune hue jodein (${pick.size})`)}
                              </button>
                            </div>
                          </div>
                          {health.available.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{t("Nothing else to link.", "Jodne ke liye aur kuch nahi.")}</p>
                          ) : (
                            <ul className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-border p-1.5">
                              {availShown
                                .filter((r) => !pyqOnly || r.id.startsWith("pyq-"))
                                .map((r) => (
                                  <li key={r.id}>
                                    <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted">
                                      <input type="checkbox" checked={pick.has(r.id)} onChange={() => toggle(r.id)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
                                      <span className="min-w-0 text-sm">
                                        <span className="block truncate font-medium">{r.title}</span>
                                        <span className="block text-xs text-muted-foreground">
                                          {r.type}
                                          {r.year ? ` · ${r.year}` : ""}
                                          {r.shift ? ` · ${r.shift}` : ""} · {r.isActive ? t("Live", "Live") : t("Draft", "Draft")}
                                          {r.otherPattern ? ` · ${t("now on", "abhi")}: ${r.otherPattern}` : ""}
                                        </span>
                                      </span>
                                    </label>
                                  </li>
                                ))}
                            </ul>
                          )}
                          {!showAllAvail && health.available.length > 30 ? (
                            <button type="button" onClick={() => setShowAllAvail(true)} className="btn btn-ghost btn-sm mt-2">
                              {t(`Show all ${health.available.length}`, `Saare ${health.available.length} dikhayein`)}
                            </button>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </section>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
