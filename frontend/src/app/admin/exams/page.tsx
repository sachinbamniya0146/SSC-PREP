"use client";

// Exam Management panel — admin UI for GET/POST/PATCH /admin/exams
// (backend/src/admin/admin.controller.ts listExams()/createExam()/updateExam()).
//
// ROOT-CAUSE FIX: the Exam model (id/name/slug/code/isActive) is the anchor
// every other piece of content depends on — the dashboard's "Choose Your
// Exam" list (bank.service.ts meta()), sectional/mock tests
// (tests.service.ts sectionalExamForFamily(), which throws "Exam not set
// up for X yet" if the slug is missing), and the bulk-upload template's
// examId column are all downstream of rows in this table. There was no
// endpoint or page anywhere to create one — cgl/chsl/mts/cpo could only
// ever have been inserted by hand directly in the database. If any of
// those 4 rows is missing, misspelled, or inactive on the live DB, the
// dashboard exam list goes empty and sectional/mock tests refuse to start,
// with no way to fix it except direct DB access. This page closes that gap
// so a new exam is a normal in-app action, not a database operation.

import * as React from "react";
import { useRouter } from "next/navigation";
import { API_BASE, fetchAuth } from "@/lib/api";

type AdminExam = {
  id: string;
  name: string;
  slug: string;
  code: string;
  isActive: boolean;
  _count?: { questions: number };
};

export default function ExamManagementPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = React.useState(false);

  const [exams, setExams] = React.useState<AdminExam[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [listErr, setListErr] = React.useState("");

  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [code, setCode] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [createMsg, setCreateMsg] = React.useState("");
  const [createErr, setCreateErr] = React.useState("");

  const [savingId, setSavingId] = React.useState<string>("");

  // Tracks the last auto-computed slug/code so onNameChange() only
  // overwrites slug/code while they still match its own previous guess —
  // the moment an admin hand-edits either field, autofill stops touching it.
  const slugGuessCache = React.useRef("");
  const codeGuessCache = React.useRef("");

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem("ssc_user");
      const user = raw ? JSON.parse(raw) : null;
      const isAdmin = user?.role === "ADMIN" || user?.role === "MODERATOR";
      if (!isAdmin) {
        router.replace("/dashboard");
        return;
      }
    } catch {
      router.replace("/dashboard");
      return;
    }
    setAuthChecked(true);
  }, [router]);

  const loadExams = React.useCallback(async () => {
    setLoading(true);
    setListErr("");
    try {
      const r = await fetchAuth(`${API_BASE}/admin/exams`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setListErr(d?.message || `HTTP ${r.status}`);
        return;
      }
      const data: AdminExam[] = await r.json();
      setExams(data);
    } catch (e) {
      setListErr(e instanceof Error ? e.message : "Exams load nahi hue");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (authChecked) loadExams();
  }, [authChecked, loadExams]);

  // Auto-fill slug/code from name so the common case (typing "SSC CHSL")
  // needs no extra thought, but both stay editable for exceptions.
  function onNameChange(v: string) {
    setName(v);
    const words = v.trim().split(/\s+/).filter(Boolean);
    const guessCode = words.map((w) => w[0]).join("").toUpperCase();
    const guessSlug = v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    setSlug((prev) => (prev === "" || prev === slugGuessCache.current ? guessSlug : prev));
    setCode((prev) => (prev === "" || prev === codeGuessCache.current ? guessCode : prev));
    slugGuessCache.current = guessSlug;
    codeGuessCache.current = guessCode;
  }

  async function createExam() {
    const trimmedName = name.trim();
    const trimmedSlug = slug.trim().toLowerCase();
    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedName || !trimmedSlug || !trimmedCode) {
      setCreateErr("Name, slug, aur code teeno chahiye");
      return;
    }
    setCreating(true);
    setCreateErr("");
    setCreateMsg("");
    try {
      const r = await fetchAuth(`${API_BASE}/admin/exams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, slug: trimmedSlug, code: trimmedCode }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setCreateErr(d?.message || `HTTP ${r.status}`);
        return;
      }
      setName("");
      setSlug("");
      setCode("");
      slugGuessCache.current = "";
      codeGuessCache.current = "";
      setCreateMsg(`"${d.name}" ban gaya (slug: ${d.slug}). Ab isme ExamPattern aur questions add kar sakte hain.`);
      await loadExams();
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : "Exam create nahi hua");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(exam: AdminExam) {
    setSavingId(exam.id);
    try {
      const r = await fetchAuth(`${API_BASE}/admin/exams/${exam.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !exam.isActive }),
      });
      if (r.ok) await loadExams();
    } finally {
      setSavingId("");
    }
  }

  async function copyId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCreateMsg("Exam ID copy ho gaya.");
    } catch {
      // Clipboard API can be unavailable — ID is still visible for manual copy.
    }
  }

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Checking access...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">
            ← <span className="text-primary">SSC</span>PrepHub
          </a>
          <span className="text-sm text-muted-foreground">🎓 Exam Management</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold">🎓 Exam Management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Naya exam (jaise SSC CGL, SSC CHSL) yahan banayein. Ye exam tabhi dashboard ki &quot;Choose Your
          Exam&quot; list mein aur sectional/mock tests mein dikhega jab isme kam se kam 10 approved
          bilingual questions ho jayenge.
        </p>

        {/* ---- Create form ---- */}
        <div className="mt-6 rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold">➕ Naya Exam Banayein</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Name *</label>
              <input
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="SSC CGL"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Slug * (URL-safe, lowercase)</label>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="cgl"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Code * (short, uppercase)</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="CGL"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Note: sectional test flow abhi sirf <code>cgl</code>, <code>chsl</code>, <code>mts</code>,{" "}
            <code>cpo</code> slugs ko pehchanta hai — koi aur slug banayenge to uska sectional exam kaam
            nahi karega jab tak backend mein woh family bhi add na ki jaaye (mock/PYQ/question-bank sab
            slugs ke saath already kaam karte hain).
          </p>
          <button
            onClick={createExam}
            disabled={creating}
            className="btn mt-4 bg-primary px-5 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {creating ? "Ban raha hai..." : "Exam Banayein"}
          </button>
          {createErr && (
            <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{createErr}</p>
          )}
          {createMsg && (
            <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
              {createMsg}
            </p>
          )}
        </div>

        {/* ---- Existing exams ---- */}
        <div className="mt-8">
          <h2 className="font-semibold">📋 Existing Exams</h2>
          {listErr && (
            <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{listErr}</p>
          )}
          {loading ? (
            <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
          ) : exams.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              Koi exam nahi mila — is DB mein abhi koi Exam row nahi hai. Yahi wajah hai ki dashboard par
              &quot;Choose Your Exam&quot; khaali dikh raha hai. Upar se pehle exam banayein.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {exams.map((e) => (
                <div
                  key={e.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{e.name}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{e.code}</span>
                      {!e.isActive && (
                        <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs text-danger">Inactive</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      slug: <code>{e.slug}</code> · {e._count?.questions ?? 0} questions total
                    </p>
                    <button
                      onClick={() => copyId(e.id)}
                      className="mt-1 text-xs font-mono text-primary underline"
                      title="Click to copy — use this as examId in the bulk upload sheet"
                    >
                      {e.id}
                    </button>
                  </div>
                  <button
                    onClick={() => toggleActive(e)}
                    disabled={savingId === e.id}
                    className="btn btn-outline px-4 py-2 text-sm disabled:opacity-50"
                  >
                    {savingId === e.id ? "..." : e.isActive ? "Deactivate" : "Activate"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
