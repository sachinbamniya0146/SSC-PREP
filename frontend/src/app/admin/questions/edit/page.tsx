"use client";

// Open / check / edit ONE question (NEW — Oct 3 2026)
//
//  * Search by the question's unique number (Q#) — e.g. 1042 — or paste its id.
//  * The student's "Report error" screen links here (?q=1042), so a reported question opens in one tap.
//  * Everything can be changed: text, Hindi, options, answer, question image, SOLUTION image
//    (optional), exam / year / shift / DATE (type it or pick from the calendar), syllabus place.
//  * English -> Hindi button (free AI models, admin key pool).
//  * After saving, students who reported this question get a thank-you ("problem theek ho gayi").
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { API_BASE, fetchAuth } from "@/lib/api";
import DateField from "@/components/DateField";
import { normalizeShift } from "@/lib/shift";

type TaxSubTopic = { id: string; name: string };
type TaxTopic = { id: string; name: string; subTopics: TaxSubTopic[] };
type TaxChapter = { id: string; name: string; topics: TaxTopic[] };
type TaxSubject = { id: string; name: string; chapters: TaxChapter[] };
type Exam = { id: string; name: string };
type Opt = { text: string; textHi: string; imageUrl: string };
type Report = { id: string; description: string; category: string; status: string; createdAt: string; user?: { fullName?: string; email?: string } };

const KEYS = ["A", "B", "C", "D"] as const;
const inp = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
const lbl = "mb-1 block text-xs font-semibold text-muted-foreground";

function ImageField({ label, url, onChange, onError }: { label: string; url: string; onChange: (u: string) => void; onError: (m: string) => void }) {
  const [busy, setBusy] = React.useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      onError("Image 5 MB se badi hai — chhoti image chunein. / Image is over 5 MB.");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetchAuth(`${API_BASE}/bank/admin/upload/question-image`, { method: "POST", body: fd });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.message || `Image upload failed (HTTP ${r.status})`);
      onChange(d.url);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Image upload failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2">
      {url ? (
        <div className="flex items-start gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={label} className="max-h-32 max-w-[60%] rounded border border-border bg-white object-contain" />
          <button type="button" onClick={() => onChange("")} className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-600">✕ Hatayein</button>
        </div>
      ) : (
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:border-primary">
          {busy ? "Uploading…" : `🖼️ ${label} (image)`}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" disabled={busy} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
      )}
    </div>
  );
}



function EditInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [authChecked, setAuthChecked] = React.useState(false);
  const [exams, setExams] = React.useState<Exam[]>([]);
  const [tax, setTax] = React.useState<TaxSubject[]>([]);

  const [search, setSearch] = React.useState(sp.get("q") || sp.get("id") || "");
  const [loading, setLoading] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [id, setId] = React.useState("");
  const [qNo, setQNo] = React.useState<number | null>(null);
  const [status, setStatus] = React.useState("live");
  const [meta, setMeta] = React.useState<{ batch?: { filename?: string; createdAt?: string } | null; versions: number; updatedAt?: string; reports: Report[] }>({ versions: 0, reports: [] });

  const [examId, setExamId] = React.useState("");
  const [subjectId, setSubjectId] = React.useState("");
  const [chapterId, setChapterId] = React.useState("");
  const [topicId, setTopicId] = React.useState("");
  const [subTopicId, setSubTopicId] = React.useState("");
  const [year, setYear] = React.useState("");
  const [shift, setShift] = React.useState("");
  const [examDate, setExamDate] = React.useState("");
  const [paperCode, setPaperCode] = React.useState("");
  const [questionText, setQuestionText] = React.useState("");
  const [questionTextHindi, setQuestionTextHindi] = React.useState("");
  const [questionImageUrl, setQuestionImageUrl] = React.useState("");
  const [options, setOptions] = React.useState<Opt[]>(KEYS.map(() => ({ text: "", textHi: "", imageUrl: "" })));
  const [correct, setCorrect] = React.useState("");
  const [explanation, setExplanation] = React.useState("");
  const [explanationHindi, setExplanationHindi] = React.useState("");
  const [solutionImageUrl, setSolutionImageUrl] = React.useState("");
  const [marks, setMarks] = React.useState("");
  const [negativeMarks, setNegativeMarks] = React.useState("");
  const [difficulty, setDifficulty] = React.useState("MEDIUM");

  const [busy, setBusy] = React.useState(false);
  const [translating, setTranslating] = React.useState(false);
  const [error, setError] = React.useState("");
  const [ok, setOk] = React.useState<string[] | null>(null);
  const [thank, setThank] = React.useState(true);
  const [dupInfo, setDupInfo] = React.useState<{ questionNo: number; id: string } | null>(null);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem("ssc_user");
      const user = raw ? JSON.parse(raw) : null;
      if (!(user?.role === "ADMIN" || user?.role === "MODERATOR")) {
        router.replace("/dashboard");
        return;
      }
    } catch {
      router.replace("/dashboard");
      return;
    }
    setAuthChecked(true);
    (async () => {
      try {
        const [e, t] = await Promise.all([fetchAuth(`${API_BASE}/bank/meta`), fetchAuth(`${API_BASE}/bank/admin/taxonomy/tree`)]);
        if (e.ok) setExams(((await e.json()) as { exams?: Exam[] })?.exams ?? []);
        if (t.ok) setTax(await t.json());
      } catch {
        setError("Exam / syllabus list load nahi hui — page refresh karein.");
      }
    })();
  }, [router]);

  const load = React.useCallback(async (key: string) => {
    const k = key.trim();
    if (!k) return;
    setLoading(true);
    setError("");
    setOk(null);
    setDupInfo(null);
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/manage/question/${encodeURIComponent(k)}`);
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.message || `Question nahi mila (HTTP ${r.status})`);
      setId(d.id);
      setQNo(d.questionNo);
      setStatus(d.status === "pending" ? "pending" : d.status === "hidden" ? "hidden" : "live");
      setMeta({ batch: d.batch, versions: d.versionsCount ?? 0, updatedAt: d.updatedAt, reports: d.reports ?? [] });
      setExamId(d.examId || "");
      setSubjectId(d.subjectId || "");
      setChapterId(d.chapterId || "");
      setTopicId(d.topicId || "");
      setSubTopicId(d.subTopicId || "");
      setYear(d.year != null ? String(d.year) : "");
      setShift(d.shift || "");
      setExamDate(d.examDate || "");
      setPaperCode(d.paperCode || "");
      setQuestionText(d.questionText || "");
      setQuestionTextHindi(d.questionTextHindi || "");
      setQuestionImageUrl(d.questionImageUrl || "");
      const byKey = new Map<string, any>((d.options || []).map((o: any) => [o.key, o]));
      setOptions(KEYS.map((kk) => ({ text: byKey.get(kk)?.text || "", textHi: byKey.get(kk)?.textHi || "", imageUrl: byKey.get(kk)?.imageUrl || "" })));
      setCorrect(d.correctAnswer || "");
      setExplanation(d.explanation || "");
      setExplanationHindi(d.explanationHindi || "");
      setSolutionImageUrl(d.solutionImageUrl || "");
      setMarks(d.marks != null ? String(d.marks) : "");
      setNegativeMarks(d.negativeMarks != null ? String(d.negativeMarks) : "");
      setDifficulty(d.difficulty || "MEDIUM");
      const open = (d.reports ?? []).filter((x: Report) => x.status === "OPEN" || x.status === "REVIEWING" || x.status === "CONFIRMED").length;
      setThank(open > 0);
      setLoaded(true);
      router.replace(`/admin/questions/edit?q=${d.questionNo}`, { scroll: false });
    } catch (e) {
      setLoaded(false);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [router]);

  React.useEffect(() => {
    if (authChecked && (sp.get("q") || sp.get("id"))) void load(sp.get("q") || sp.get("id") || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked]);

  const subject = tax.find((s) => s.id === subjectId);
  const chapter = subject?.chapters.find((c) => c.id === chapterId);
  const topic = chapter?.topics.find((t) => t.id === topicId);
  const setOpt = (i: number, patch: Partial<Opt>) => setOptions((o) => o.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const translate = async () => {
    if (!questionText.trim() && !options.some((o) => o.text.trim())) {
      setError("Pehle English question / options likhein, phir translate karein.");
      return;
    }
    const hasHindi = questionTextHindi.trim() || options.some((o) => o.textHi.trim());
    if (hasHindi && !window.confirm("Hindi text pehle se bhara hai. Naye translation se badal dein?")) return;
    setTranslating(true);
    setError("");
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/manage/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionText, explanation, options: KEYS.map((k, i) => ({ key: k, text: options[i].text })) }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.message || `Translate fail (HTTP ${r.status})`);
      if (d.questionTextHindi) setQuestionTextHindi(d.questionTextHindi);
      setOptions((o) => o.map((x, i) => ({ ...x, textHi: d.options?.[KEYS[i]] || x.textHi })));
      if (d.explanationHindi) setExplanationHindi(d.explanationHindi);
      setOk([`Hindi translation bhar diya gaya (${d.model || "free model"}). Ek baar padhkar check kar lein, phir Save karein.`]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTranslating(false);
    }
  };

  const save = async (allowDuplicate = false) => {
    setBusy(true);
    setError("");
    setOk(null);
    setDupInfo(null);
    try {
      const body = {
        status,
        examId,
        subjectId,
        chapterId,
        topicId: topicId || "",
        subTopicId: subTopicId || "",
        year,
        shift,
        examDate,
        paperCode,
        questionText,
        questionTextHindi,
        questionImageUrl,
        options: KEYS.map((k, i) => ({ key: k, text: options[i].text, textHi: options[i].textHi, imageUrl: options[i].imageUrl })),
        correctAnswer: correct,
        explanation,
        explanationHindi,
        solutionImageUrl,
        marks: marks || undefined,
        negativeMarks: negativeMarks || undefined,
        difficulty,
        allowDuplicate,
        reason: "Admin edit (edit page)",
      };
      const r = await fetchAuth(`${API_BASE}/bank/admin/manage/question/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => null);
      if (r.status === 409 && d?.code === "DUPLICATE") {
        setDupInfo(d.existing);
        throw new Error(d.message);
      }
      if (!r.ok) throw new Error(Array.isArray(d?.message) ? d.message.join(", ") : d?.message || `Save fail (HTTP ${r.status})`);
      const msgs = [`✅ Q#${d.questionNo} save ho gaya.`, ...(d.autoPublished ? ["Question ab students ko live dikhega."] : []), ...(d.warnings || []).map((w: string) => `⚠️ ${w}`)];
      if (thank) {
        const t = await fetchAuth(`${API_BASE}/report-error/question/${id}/fixed`, { method: "POST" });
        const td = await t.json().catch(() => null);
        if (t.ok && td?.thanked > 0) msgs.push(`🙏 ${td.thanked} student ko thank-you message chala gaya.`);
      }
      setOk(msgs);
      await load(String(d.questionNo));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError((e as Error).message);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setBusy(false);
    }
  };

  if (!authChecked) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;

  const openReports = meta.reports.filter((r) => r.status === "OPEN" || r.status === "REVIEWING");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 px-3 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <a href="/admin/questions/manage" className="shrink-0 text-sm font-semibold">←</a>
          <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); void load(search); }}>
            <input className={inp} inputMode="search" placeholder="Question number (jaise 1042) ya id" value={search} onChange={(e) => setSearch(e.target.value)} />
            <button type="submit" disabled={loading} className="shrink-0 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">{loading ? "…" : "Kholein"}</button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-3 py-5 pb-28">
        {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600">{error}</div>}
        {dupInfo && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p>Aisa hi question Q#{dupInfo.questionNo} me pehle se hai.</p>
            <div className="mt-2 flex gap-2">
              <a className="rounded border border-border px-3 py-1.5 text-xs font-semibold" href={`/admin/questions/edit?q=${dupInfo.questionNo}`}>Q#{dupInfo.questionNo} kholein</a>
              <button className="rounded bg-amber-600 px-3 py-1.5 text-xs font-bold text-white" onClick={() => void save(true)}>Fir bhi save karein</button>
            </div>
          </div>
        )}
        {ok && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
            {ok.map((m, i) => <p key={i} className={i ? "mt-1 text-xs" : "font-semibold text-emerald-700 dark:text-emerald-400"}>{m}</p>)}
          </div>
        )}

        {!loaded && !loading && !error && <p className="py-16 text-center text-sm text-muted-foreground">Upar question number likhkar “Kholein” dabayein.<br />Student ke report se seedha yahan aa sakte hain.</p>}

        {loaded && (
          <>
            <section className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-lg font-extrabold">Q#{qNo}</p>
                  <p className="text-xs text-muted-foreground">{meta.batch?.filename ? `Upload: ${meta.batch.filename} · ` : ""}{meta.versions} purane version{meta.updatedAt ? ` · last edit ${new Date(meta.updatedAt).toLocaleString()}` : ""}</p>
                </div>
                <div className="flex gap-2">
                  <button disabled={!qNo || qNo <= 1} onClick={() => qNo && void load(String(qNo - 1))} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:opacity-40">← Q#{qNo ? qNo - 1 : ""}</button>
                  <button disabled={!qNo} onClick={() => qNo && void load(String(qNo + 1))} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:opacity-40">Q#{qNo ? qNo + 1 : ""} →</button>
                </div>
              </div>
              <div className="mt-3">
                <label className={lbl}>Students ko dikhe?</label>
                <select className={inp} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="live">✅ Live (students ko dikhega)</option>
                  <option value="pending">⏳ Pending (Hindi / review baaki)</option>
                  <option value="hidden">🚫 Hidden (chhupa hua)</option>
                </select>
              </div>
            </section>

            {meta.reports.length > 0 && (
              <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
                <h2 className="mb-2 text-sm font-bold">🚩 Students ke reports ({meta.reports.length})</h2>
                <ul className="space-y-2">
                  {meta.reports.map((r) => (
                    <li key={r.id} className="rounded-lg border border-border bg-background p-2 text-xs">
                      <p className="font-semibold">{r.category} · {r.status}</p>
                      <p className="mt-0.5 whitespace-pre-wrap">{r.description}</p>
                      <p className="mt-1 text-muted-foreground">{r.user?.fullName || r.user?.email || "student"} · {new Date(r.createdAt).toLocaleDateString()}</p>
                    </li>
                  ))}
                </ul>
                <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={thank} onChange={(e) => setThank(e.target.checked)} />
                  <span>Save ke baad reporting students ko <b>thank-you</b> bhejein (“aapki bataayi problem theek ho gayi”) aur reports band karein{openReports.length ? ` (${openReports.length} khule)` : ""}.</span>
                </label>
              </section>
            )}

            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-bold">1. Kahan hai</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className={lbl}>Exam</label>
                  <select className={inp} value={examId} onChange={(e) => setExamId(e.target.value)}>
                    <option value="">— exam —</option>
                    {exams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select></div>
                <div><label className={lbl}>Subject *</label>
                  <select className={inp} value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setChapterId(""); setTopicId(""); setSubTopicId(""); }}>
                    <option value="">— subject —</option>
                    {tax.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select></div>
                <div><label className={lbl}>Chapter *</label>
                  <select className={inp} value={chapterId} disabled={!subject} onChange={(e) => { setChapterId(e.target.value); setTopicId(""); setSubTopicId(""); }}>
                    <option value="">— chapter —</option>
                    {subject?.chapters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></div>
                <div><label className={lbl}>Topic</label>
                  <select className={inp} value={topicId} disabled={!chapter} onChange={(e) => { setTopicId(e.target.value); setSubTopicId(""); }}>
                    <option value="">— topic —</option>
                    {chapter?.topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select></div>
                <div className="sm:col-span-2"><label className={lbl}>Sub-topic</label>
                  <select className={inp} value={subTopicId} disabled={!topic} onChange={(e) => setSubTopicId(e.target.value)}>
                    <option value="">— sub-topic —</option>
                    {topic?.subTopics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select></div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div><label className={lbl}>Year (PYQ ke liye)</label>
                  <input className={inp} inputMode="numeric" placeholder="2024" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} /></div>
                <div><label className={lbl}>Shift</label>
                  <input className={inp} list="edit-shift-list" placeholder="Shift 1 / morning / evening" value={shift} onChange={(e) => setShift(e.target.value)} onBlur={() => setShift((v) => normalizeShift(v) ?? "")} />
                  <p className="mt-1 text-[11px] text-muted-foreground">Morning / subah = Shift 1 · Afternoon / dopahar = Shift 2 · Evening / shaam = Shift 3 (apne aap badal jayega)</p>
                  <datalist id="edit-shift-list">{["Shift 1", "Shift 2", "Shift 3", "Shift 4"].map((s) => <option key={s} value={s} />)}</datalist></div>
                <div><label className={lbl}>Exam date (likhein ya 📅)</label>
                  <DateField className={inp} value={examDate} onChange={setExamDate} /></div>
                <div className="sm:col-span-3"><label className={lbl}>Paper code (khaali = date + shift se ban jayega)</label>
                  <input className={inp} value={paperCode} onChange={(e) => setPaperCode(e.target.value)} /></div>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold">2. Question</h2>
                <button type="button" onClick={translate} disabled={translating} className="rounded-lg border border-primary px-3 py-1.5 text-xs font-bold text-primary disabled:opacity-50">{translating ? "Translate ho raha…" : "🇮🇳 English → Hindi"}</button>
              </div>
              <label className={lbl}>Question (English)</label>
              <textarea className={inp} rows={3} value={questionText} onChange={(e) => setQuestionText(e.target.value)} />
              <p className="mt-1 text-[11px] text-muted-foreground">Power ke liye <b>2^2</b> likhein — save par apne aap <b>2²</b> ban jayega (x^-1 → x⁻¹, H_2O → H₂O).</p>
              <label className={`${lbl} mt-3`}>Question (Hindi)</label>
              <textarea className={inp} rows={3} value={questionTextHindi} onChange={(e) => setQuestionTextHindi(e.target.value)} />
              <label className={`${lbl} mt-3`}>Question image (optional)</label>
              <ImageField label="Question image" url={questionImageUrl} onChange={setQuestionImageUrl} onError={setError} />
            </section>

            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-bold">3. Options aur sahi answer</h2>
              <div className="space-y-4">
                {KEYS.map((k, i) => (
                  <div key={k} className={`rounded-lg border p-3 ${correct === k ? "border-emerald-500 bg-emerald-500/5" : "border-border"}`}>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-bold">Option {k}</span>
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold"><input type="radio" name="correct" checked={correct === k} onChange={() => setCorrect(k)} /> Sahi answer</label>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input className={inp} placeholder="English" value={options[i].text} onChange={(e) => setOpt(i, { text: e.target.value })} />
                      <input className={inp} placeholder="Hindi" value={options[i].textHi} onChange={(e) => setOpt(i, { textHi: e.target.value })} />
                    </div>
                    <ImageField label={`Option ${k} image`} url={options[i].imageUrl} onChange={(u) => setOpt(i, { imageUrl: u })} onError={setError} />
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-bold">4. Solution (optional)</h2>
              <label className={lbl}>Explanation (English)</label>
              <textarea className={inp} rows={3} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
              <label className={`${lbl} mt-3`}>Explanation (Hindi)</label>
              <textarea className={inp} rows={3} value={explanationHindi} onChange={(e) => setExplanationHindi(e.target.value)} />
              <label className={`${lbl} mt-3`}>Solution image (optional — students ko solution me dikhegi)</label>
              <ImageField label="Solution image" url={solutionImageUrl} onChange={setSolutionImageUrl} onError={setError} />
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div><label className={lbl}>Marks</label><input className={inp} inputMode="decimal" value={marks} onChange={(e) => setMarks(e.target.value)} /></div>
                <div><label className={lbl}>Negative marks</label><input className={inp} inputMode="decimal" value={negativeMarks} onChange={(e) => setNegativeMarks(e.target.value)} /></div>
                <div><label className={lbl}>Difficulty</label>
                  <select className={inp} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}><option>EASY</option><option>MEDIUM</option><option>HARD</option></select></div>
              </div>
            </section>

            <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-3 backdrop-blur" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
              <div className="mx-auto flex max-w-3xl gap-2">
                <a href="/admin/questions/manage" className="flex-1 rounded-lg border border-border px-3 py-3 text-center text-sm font-semibold">Wapas</a>
                <button type="button" onClick={() => void save(false)} disabled={busy} className="flex-[2] rounded-lg bg-primary px-3 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50">{busy ? "Save ho raha…" : "💾 Save changes"}</button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default function EditQuestionPage() {
  return (
    <React.Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}>
      <EditInner />
    </React.Suspense>
  );
}
