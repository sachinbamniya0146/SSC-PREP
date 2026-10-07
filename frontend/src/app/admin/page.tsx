"use client";

import UserAvatar from "@/components/UserAvatar";
import * as React from "react";
import { ThemeContext } from "@/components/theme-provider";
import { BackButton } from "@/components/BackButton";
import { Logo } from "@/components/Logo";
import { api, API_BASE, fetchAuth } from "@/lib/api";
import { useAccess } from "@/lib/permissions";
import AdminImageTools from "@/components/AdminImageTools";

interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
  phone?: string | null;
  avatarUrl?: string | null;
  preferredLanguage?: string;
  isEmailVerified: boolean;
  createdAt: string;
  subscriptions: { status: string; endsAt: string | null; planId: string }[];
  _count: { testAttempts: number; bookmarks: number };
}

interface UsersResponse {
  users: User[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// NEW ("admin ko upload ka result behtar dikhna chahiye — kaunsa row fail
// hua, kyun"): matches BankUploadService's enriched UploadResult
// (backend/src/bank/bank-upload.service.ts) — every error/warning now also
// carries a question-text preview, and errors carry a coarse category so
// they can be grouped/summarized instead of shown as one flat list.
type UploadErrorCategory = "MISSING_FIELD" | "INVALID_REFERENCE" | "DUPLICATE" | "FORMAT" | "OTHER" | "MISSING_ANSWER" | "MISSING_SOLUTION";

const CATEGORY_LABEL: Record<UploadErrorCategory, string> = {
  MISSING_FIELD: "❗ Missing Field",
  INVALID_REFERENCE: "🔗 Invalid Reference",
  DUPLICATE: "♻️ Duplicate",
  FORMAT: "✏️ Format",
  OTHER: "❓ Other",
  MISSING_ANSWER: "🔑 Answer Missing",
  MISSING_SOLUTION: "📝 Solution Missing",
};

interface UploadResult {
  success: boolean;
  total: number;
  created: number;
  failed: number;
  errors: { row: number; error: string; category: UploadErrorCategory; questionPreview?: string }[];
  warnings: { row: number; message: string; questionPreview?: string }[];
  // Oct 1 2026 (huge uploads): only the first ~1000 failed rows are listed.
  errorsTruncated?: boolean;
  errorSummary?: Record<string, number>;
  warningsTotal?: number;
  queuedForReview?: number;
  queuedExact?: number;
  reviewAlready?: number;
  unaccounted?: number;
}

interface UploadJobState {
  status: "RUNNING" | "DONE" | "FAILED";
  phase: string;
  processed: number;
  total: number;
  created: number;
  failed: number;
  result?: UploadResult;
  error?: string;
}

const PHASE_LABEL: Record<string, string> = {
  QUEUED: "Queue me",
  PARSING: "File padh rahe hain (reading file)",
  CHECKING: "Rows check ho rahe hain (validating)",
  DUPLICATES: "Duplicate check",
  SAVING: "Database me save ho rahe hain (saving)",
  FINALIZING: "Final steps",
};

interface SubscriptionPlan {
  id: string;
  name: string;
  // FIX: this previously listed fields (`price`, `currency`, `durationDays`,
  // `features`) that don't exist anywhere on the actual Plan model
  // (backend/prisma/schema.prisma) or on what GET /payments/plans /
  // GET /admin/plans actually return. The real fields are priceInr and
  // durationMonths — using the wrong names meant every place this was
  // rendered showed "₹undefined/undefined days", and the old
  // `plan.features.join(...)` call would throw (features was always
  // undefined) the moment the Add Subscription modal opened.
  priceInr: number;
  durationMonths: number;
  isActive: boolean;
}

export default function AdminPage() {
  // Department access: ADMIN sees everything; staff (MODERATOR) only what the
  // admin granted (Questions / Practice / Vocabulary / Support).
  const access = useAccess();
  const { theme, toggleTheme } = React.useContext(ThemeContext);
  const [users, setUsers] = React.useState<User[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [limit] = React.useState(20);
  const [search, setSearch] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [selectedUser, setSelectedUser] = React.useState<User | null>(null);
  const [showSubscriptionModal, setShowSubscriptionModal] = React.useState(false);
  const [showEmailModal, setShowEmailModal] = React.useState(false);
  const [bulkEmail, setBulkEmail] = React.useState("");
  const [bulkPlanId, setBulkPlanId] = React.useState("");
  const [plans, setPlans] = React.useState<SubscriptionPlan[]>([]);
  const [error, setError] = React.useState("");
  const [info, setInfo] = React.useState("");
  // Plan price management — previously the admin panel could only VIEW
  // plans (to assign one to a user), there was no way to actually edit a
  // plan's price or create a new one from the UI, even though the backend
  // (PATCH/POST /admin/plans) already fully supported it.
  const [showPlanModal, setShowPlanModal] = React.useState(false);
  const [editingPlanId, setEditingPlanId] = React.useState<string | null>(null);
  const [planName, setPlanName] = React.useState("");
  const [planPriceInr, setPlanPriceInr] = React.useState("");
  const [planDurationMonths, setPlanDurationMonths] = React.useState("");

  // FIX (Sachin — "chat support ka feature admin ki ID pe show nahi ho
  // raha"): /admin/support-chat (SupportChatController's admin inbox) has
  // always existed and worked end-to-end, but nothing in this nav ever
  // linked to it — an admin had no way to discover the page short of
  // typing the URL by hand, which read exactly like "the feature doesn't
  // work". Adds a real nav link plus a live open-conversation count so an
  // admin sees at a glance that students are waiting.
  const [openChatCount, setOpenChatCount] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    const loadOpenChats = async () => {
      try {
        const r = await fetchAuth(`${API_BASE}/support-chat/admin/inbox?status=OPEN`);
        if (!r.ok || cancelled) return;
        const d = await r.json();
        const list = Array.isArray(d?.conversations) ? d.conversations : Array.isArray(d) ? d : [];
        if (!cancelled) setOpenChatCount(list.length);
      } catch {
        // non-fatal — badge just stays at 0 if this fails
      }
    };
    loadOpenChats();
    const interval = setInterval(loadOpenChats, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Open error-report count for the nav badge. Students' "Report question"
  // submissions were saved correctly but nothing in the admin UI ever showed
  // that a new one had arrived, so admins never noticed them. Same pattern
  // as the support-chat badge above: link + live count, refreshed every 30s.
  const [openReportCount, setOpenReportCount] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    const loadOpenReports = async () => {
      try {
        const r = await fetchAuth(`${API_BASE}/report-error/category-stats`);
        if (!r.ok || cancelled) return;
        const d = await r.json();
        const open = Array.isArray(d?.byCategory)
          ? d.byCategory.reduce((sum: number, c: { open?: number }) => sum + (c.open ?? 0), 0)
          : 0;
        if (!cancelled) setOpenReportCount(open);
      } catch {
        // non-fatal — badge just stays at 0 if this fails
      }
    };
    loadOpenReports();
    const interval = setInterval(loadOpenReports, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Bulk Question Upload — the backend (BankUploadService) always had the
  // Excel/CSV/JSON/Text/Word parsing + duplicate-detection logic, but it was
  // never wired to a controller and this page had zero UI for it, so admins
  // had no working way to add questions in bulk. Fixed on the backend
  // (bank-upload.controller.ts + bank.module.ts) — this is the UI for it.
  const [uploadFormat, setUploadFormat] = React.useState<"excel" | "csv" | "json" | "text" | "word">("excel");
  const [uploadFile, setUploadFile] = React.useState<File | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadResult, setUploadResult] = React.useState<UploadResult | null>(null);
  const [uploadJob, setUploadJob] = React.useState<UploadJobState | null>(null);
  // Oct 2026: reject rows that have no solution (default ON) + "rejected rows" Excel/JSON download
  const [requireSolution, setRequireSolution] = React.useState(true);
  const [rejectedUrl, setRejectedUrl] = React.useState<string | null>(null);
  const [checkOnly, setCheckOnly] = React.useState(false); // dry run: report only, nothing is saved

  // Phase 3 (Sep 2026) — upload history (past QuestionUploadBatch rows).
  type UploadBatchSummary = {
    id: string; adminId: string; sourceType: string; filename: string | null;
    totalRows: number; createdCount: number; failedCount: number; createdAt: string;
    // NEW (Oct 7 2026) — status that survives reloads: RUNNING | DONE | FAILED | INTERRUPTED
    status?: "RUNNING" | "DONE" | "FAILED" | "INTERRUPTED"; queuedCount?: number; skippedCount?: number; pendingRows?: number;
    finishedAt?: string | null; errorMessage?: string | null;
    // NEW (Sep 21 2026) — live/current state of this batch's questions
    remainingCount?: number; liveCount?: number; pendingCount?: number;
    pyqCount?: number; practiceCount?: number; kind?: "empty" | "practice" | "pyq" | "mixed";
  };
  type UploadBatchDetail = UploadBatchSummary & {
    errorsJson: { row: number; error: string; category: UploadErrorCategory; questionPreview?: string }[] | null;
    warningsJson: { row: number; message: string; questionPreview?: string }[] | null;
    breakdown?: {
      subjectId: string; subject: string | null; chapterId: string | null; chapter: string | null;
      topicId: string | null; topic: string | null; subTopicId: string | null; subTopic: string | null;
      live: number; pending: number; total: number;
    }[];
  };
  const [batches, setBatches] = React.useState<UploadBatchSummary[]>([]);
  const [batchesLoading, setBatchesLoading] = React.useState(false);
  const [batchesErr, setBatchesErr] = React.useState("");
  const [expandedBatchId, setExpandedBatchId] = React.useState<string | null>(null);
  const [expandedBatchDetail, setExpandedBatchDetail] = React.useState<UploadBatchDetail | null>(null);
  const [templateDownloading, setTemplateDownloading] = React.useState(false);
  // NEW (this session) — "poora question bank ek click me download" so the
  // admin can see what's already in the bank before adding more. Backend:
  // GET /bank/admin/upload/export (BankUploadService.exportQuestionBank()).
  const [bankExportDownloading, setBankExportDownloading] = React.useState(false);
  // NEW ("chuninda questions ka Excel export jinme Hindi translation ya
  // solution ya answer key missing hai"): GET /bank/admin/upload/export-gaps
  // (BankUploadService.exportQuestionGaps()) — same auth-header-needed blob
  // download as downloadBankExport() above, narrowed to only the rows with
  // a genuine gap instead of the whole bank.
  const [gapsExportDownloading, setGapsExportDownloading] = React.useState(false);
  // REPLACED (Sep 21 2026 — "practice vale questions upload krne ka excel se
  // vo alg hee ek तरफ bda vala button do, chota sa click glti krva dega"):
  // one generic Upload button risked the admin uploading a PYQ paper into
  // Practice (or vice-versa) by forgetting a checkbox. Now there are two
  // large, clearly separated, differently-coloured buttons — no checkbox,
  // no silent default — and the chosen kind is sent to the backend, which
  // also force-blanks year/shift/paperCode for Practice uploads.
  const [isPracticeOnly, setIsPracticeOnly] = React.useState(false); // kept: read by submitUpload for the (still supported) checkbox-free legacy path

  async function loadUsers() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.append("page", String(page));
      params.append("limit", String(limit));
      if (search) params.append("search", search);
      if (roleFilter) params.append("role", roleFilter);
      const data = await api<UsersResponse>(`/admin/users?${params}`);
      setUsers(data.users);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  async function loadPlans() {
    // FIX: was calling /payments/plans, which returns a bare array
    // (Plan[]), while this expected { plans: Plan[] }. That mismatch
    // meant `data.plans` was always undefined, setPlans(undefined) wiped
    // the plans list, and every screen that reads `plans` (price cards,
    // Add Subscription modal, bulk-assign dropdown) rendered empty or
    // crashed. /admin/plans is the correct admin-facing endpoint and
    // already returns the { plans } shape this code expects.
    try {
      const data = await api<{ plans: SubscriptionPlan[] }>("/admin/plans");
      setPlans(data.plans || []);
    } catch (err) {
      console.error("Failed to load plans", err);
      setPlans([]);
    }
  }

  async function cancelSubscription(userId: string) {
    try {
      await api(`/admin/users/${userId}/subscription/cancel`, { method: "POST" });
      setInfo("Subscription cancelled successfully");
      loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel subscription");
    }
  }

  async function addSubscription(userId: string, planId: string) {
    try {
      await api(`/admin/users/${userId}/subscription/add`, {
        method: "POST",
        body: JSON.stringify({ planId }),
      });
      setInfo("Subscription added successfully");
      setShowSubscriptionModal(false);
      loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add subscription");
    }
  }

  async function sendBulkSubscription() {
    if (!bulkEmail || !bulkPlanId) return;
    try {
      await api("/admin/subscriptions/bulk", {
        method: "POST",
        body: JSON.stringify({ emails: bulkEmail.split(",").map(e => e.trim()), planId: bulkPlanId }),
      });
      setInfo("Bulk subscriptions sent successfully");
      setShowEmailModal(false);
      setBulkEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send bulk subscriptions");
    }
  }

  function openCreatePlan() {
    setEditingPlanId(null);
    setPlanName("");
    setPlanPriceInr("");
    setPlanDurationMonths("");
    setShowPlanModal(true);
  }

  function openEditPlan(plan: SubscriptionPlan) {
    setEditingPlanId(plan.id);
    setPlanName(plan.name);
    setPlanPriceInr(String(plan.priceInr));
    setPlanDurationMonths(String(plan.durationMonths));
    setShowPlanModal(true);
  }

  async function savePlan() {
    const priceInr = Number(planPriceInr);
    const durationMonths = Number(planDurationMonths);
    if (!planName.trim() || !priceInr || priceInr <= 0 || !durationMonths || durationMonths <= 0) {
      setError("Enter a plan name, a price above ₹0, and a duration above 0 months");
      return;
    }
    try {
      if (editingPlanId) {
        await api(`/admin/plans/${editingPlanId}`, {
          method: "PATCH",
          body: JSON.stringify({ name: planName.trim(), priceInr, durationMonths }),
        });
        setInfo("Plan updated");
      } else {
        await api("/admin/plans", {
          method: "POST",
          body: JSON.stringify({ name: planName.trim(), priceInr, durationMonths }),
        });
        setInfo("Plan created");
      }
      setShowPlanModal(false);
      loadPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save plan");
    }
  }

  async function deactivatePlan(plan: SubscriptionPlan) {
    if (!confirm(`Deactivate "${plan.name}"? Existing subscribers keep access until it expires; it just stops being offered to new buyers.`)) return;
    try {
      await api(`/admin/plans/${plan.id}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) });
      setInfo("Plan deactivated");
      loadPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deactivate plan");
    }
  }

  // Template downloads need the Authorization header (GET /admin/help/templates/*
  // is ADMIN/MODERATOR-only), so a plain <a href> can't be used — it wouldn't
  // send the bearer token. Fetch as a blob instead and trigger the download.
  async function downloadTemplate(format: "excel" | "csv" | "json" | "text") {
    setTemplateDownloading(true);
    setError("");
    try {
      const res = await fetchAuth(`${API_BASE}/admin/help/templates/${format}`);
      if (!res.ok) throw new Error(`Failed to download template (HTTP ${res.status})`);
      const blob = await res.blob();
      const ext = format === "excel" ? "xlsx" : format;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `question_bulk_upload_template.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download template");
    } finally {
      setTemplateDownloading(false);
    }
  }

  // Full question-bank export — same auth-header-needed reasoning as
  // downloadTemplate() above (GET /bank/admin/upload/export is ADMIN/
  // MODERATOR-only). Defaults to Excel since that's the easiest to skim;
  // admin can re-download as JSON/CSV by editing the format if needed.
  async function downloadBankExport() {
    setBankExportDownloading(true);
    setError("");
    try {
      const res = await fetchAuth(`${API_BASE}/bank/admin/upload/export?format=excel`);
      if (!res.ok) throw new Error(`Failed to export question bank (HTTP ${res.status})`);
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="(.+)"/);
      const filename = match ? match[1] : "question_bank_export.xlsx";
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export question bank");
    } finally {
      setBankExportDownloading(false);
    }
  }

  // NEW — downloads only the questions missing Hindi translation, solution,
  // or answer key (admin's exact ask: "chuninda questions ko excel me pura
  // format me download kar sake"). `type` narrows to one gap kind; omit
  // (default) for all three in one file. Same blob-download pattern as
  // downloadBankExport() above.
  async function downloadGapsExport(type?: "hindi" | "solution" | "answer") {
    setGapsExportDownloading(true);
    setError("");
    try {
      const qs = type ? `?format=excel&type=${type}` : `?format=excel`;
      const res = await fetchAuth(`${API_BASE}/bank/admin/upload/export-gaps${qs}`);
      if (!res.ok) throw new Error(`Failed to export gaps (HTTP ${res.status})`);
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="(.+)"/);
      const filename = match ? match[1] : "question_gaps.xlsx";
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export gaps");
    } finally {
      setGapsExportDownloading(false);
    }
  }

  async function submitUpload(kind: "practice" | "pyq") {
    if (!uploadFile) {
      setError("Pehle koi file select karein (Excel/CSV/JSON/Text/Word)");
      return;
    }
    setUploading(true);
    setError("");
    setUploadResult(null);
    setUploadJob(null);
    setRejectedUrl(null);
    try {
      // JSON (text / SVG-code / image questions) runs as a background job too.
      if (uploadFormat === "json" || (checkOnly && (uploadFormat === "excel" || uploadFormat === "csv"))) {
        await submitJsonJob(kind);
        return;
      }
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("kind", kind);
      formData.append("requireSolution", String(requireSolution));
      if (kind === "practice") formData.append("isPracticeOnly", "true");
      // Oct 1 2026: Excel/CSV run as a BACKGROUND job (any size, even 1 lakh
      // rows) — the request returns at once and we poll for progress, so
      // the browser/Cloudflare never time out on a long import.
      const useAsync = uploadFormat === "excel" || uploadFormat === "csv";
      if (useAsync) formData.append("async", "true");
      const res = await fetchAuth(`${API_BASE}/bank/admin/upload/${uploadFormat}`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error((data as { message?: string } | null)?.message || `Upload failed (HTTP ${res.status})`);
      }

      let finalResult: UploadResult;
      if (useAsync && (data as { async?: boolean } | null)?.async) {
        const jobId = (data as { jobId: string }).jobId;
        setRejectedUrl(`${API_BASE}/bank/admin/upload/jobs/${jobId}/rejected`);
        setUploadJob({ status: "RUNNING", phase: "QUEUED", processed: 0, total: 0, created: 0, failed: 0 });
        finalResult = await pollUploadJob(jobId);
      } else {
        finalResult = data as UploadResult;
      }

      setUploadResult(finalResult);
      loadBatches(); // Phase 3 — refresh history so this upload shows up immediately
      if (finalResult.created > 0) {
        setInfo(`${finalResult.created} ${kind === "practice" ? "Practice" : "PYQ"} question(s) upload ho gaye`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      setUploadJob(null);
    }
  }

  // JSON upload as a background job (images/SVG inside the JSON make it slow, so never one long request).
  async function submitJsonJob(kind: "practice" | "pyq") {
    if (!uploadFile) return;
    const fd = new FormData();
    fd.append("file", uploadFile);
    fd.append("kind", kind);
    fd.append("requireSolution", String(requireSolution));
    fd.append("dryRun", String(checkOnly));
    const res = await fetchAuth(`${API_BASE}/bank/admin/upload/job/start`, { method: "POST", body: fd });
    const started = await res.json().catch(() => null);
    if (!res.ok) throw new Error(started?.message || `Upload failed (HTTP ${res.status})`);
    setUploadJob({ status: "RUNNING", phase: "CHECKING", processed: 0, total: started.total, created: 0, failed: 0 });
    let netFails = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      let j: any = null;
      try {
        const r = await fetchAuth(`${API_BASE}/bank/admin/upload/job/${started.id}`);
        j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.message || `HTTP ${r.status}`);
        netFails = 0;
      } catch {
        if (++netFails >= 20) throw new Error("Progress check fail ho raha hai. Upload server par chal raha hoga — thodi der baad Upload History dekhein.");
        continue;
      }
      setUploadJob({ status: j.status, phase: j.status === "DONE" ? "FINALIZING" : "SAVING", processed: j.processed, total: j.total, created: j.created, failed: j.failed });
      if (j.status === "FAILED") throw new Error(j.fatalError || "Upload fail ho gaya");
      if (j.status === "DONE") {
        if (j.hasRejected) setRejectedUrl(`${API_BASE}/bank/admin/upload/job/${started.id}/rejected`);
        setUploadResult({ success: j.failed === 0, total: j.total, created: j.created, failed: j.failed, errors: j.errors, warnings: j.warnings, queuedForReview: j.queuedForReview, queuedExact: j.queuedExact, reviewAlready: j.reviewAlready, unaccounted: j.unaccounted } as UploadResult);
        loadBatches();
        if (checkOnly) setInfo(`Sirf check hua (kuch save nahi hua): ${j.created} question upload ke liye tayyar, ${j.failed} reject.`);
        else if (j.created > 0) setInfo(`${j.created} ${kind === "practice" ? "Practice" : "PYQ"} question(s) upload ho gaye`);
        return;
      }
    }
  }

  async function downloadRejectedRows() {
    if (!rejectedUrl) return;
    try {
      const r = await fetchAuth(rejectedUrl);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rejected_rows_${new Date().toISOString().slice(0, 10)}.${blob.type.includes("json") ? "json" : "xlsx"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rejected file download nahi hui");
    }
  }

  // Polls the background import every 2 s until it is DONE / FAILED. Network
  // blips are tolerated (up to 30 failed polls in a row) because the import
  // keeps running on the server regardless of this browser tab.
  async function pollUploadJob(jobId: string): Promise<UploadResult> {
    let misses = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const r = await fetchAuth(`${API_BASE}/bank/admin/upload/jobs/${jobId}`);
        const j = (await r.json().catch(() => null)) as (UploadJobState & { message?: string }) | null;
        if (!r.ok) {
          if (r.status === 404 || r.status === 403) throw new Error(j?.message || "Upload job nahi mila — Upload history dekhein.");
          throw new Error(j?.message || `HTTP ${r.status}`);
        }
        misses = 0;
        if (!j) continue;
        setUploadJob(j);
        if (j.status === "DONE" && j.result) return j.result;
        if (j.status === "FAILED") throw new Error(j.error || "Upload fail ho gaya");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (/job nahi mila|Upload fail|Excel|CSV|column|Missing/i.test(msg) || ++misses > 30) throw e;
      }
    }
  }

  // NEW ("admin ko upload ka result behtar dikhna chahiye"): builds a CSV
  // of every failed row (row number, category, question preview, exact
  // error message) client-side from the already-fetched UploadResult —
  // no extra backend call — and downloads it, so the admin can work
  // through fixes in their spreadsheet app instead of scrolling this panel.
  function downloadErrorReport(result: UploadResult) {
    const escapeCsv = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [
      ["Row", "Category", "Question Preview", "Error"].map(escapeCsv).join(","),
      ...result.errors.map((e) =>
        [String(e.row), CATEGORY_LABEL[e.category] ?? e.category, e.questionPreview ?? "", e.error]
          .map(escapeCsv)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `upload_errors_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }

  // ---- Phase 3 (Sep 2026) — upload history ----
  const loadBatches = React.useCallback(async (silent?: boolean) => {
    if (!silent) setBatchesLoading(true);
    setBatchesErr("");
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/upload/batches`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setBatchesErr(d?.message || `HTTP ${r.status}`);
        return;
      }
      setBatches(await r.json());
    } catch (e) {
      setBatchesErr(e instanceof Error ? e.message : "Upload history load nahi hui");
    } finally {
      if (!silent) setBatchesLoading(false);
    }
  }, []);

  async function toggleBatchDetail(id: string) {
    if (expandedBatchId === id) {
      setExpandedBatchId(null);
      setExpandedBatchDetail(null);
      return;
    }
    setExpandedBatchId(id);
    setExpandedBatchDetail(null);
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/upload/batches/${id}`);
      if (r.ok) setExpandedBatchDetail(await r.json());
    } catch {
      /* silent — the row still shows its summary counts either way */
    }
  }

  // NEW (Sep 21 2026) — publish/download/scoped-delete helpers alongside the
  // existing whole-batch delete.
  async function publishBatchHandler(id: string) {
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/upload/batches/${id}/publish`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setBatchesErr(d?.message || `HTTP ${r.status}`);
        return;
      }
      setInfo(`${d.published ?? 0} question(s) publish ho gaye.`);
      await loadBatches();
      if (expandedBatchId === id) toggleBatchDetail(id).then(() => toggleBatchDetail(id));
    } catch (e) {
      setBatchesErr(e instanceof Error ? e.message : "Publish nahi hua");
    }
  }

  async function downloadBatchHandler(id: string, filename: string | null) {
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/upload/batches/${id}/download?format=excel`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setBatchesErr(d?.message || `HTTP ${r.status}`);
        return;
      }
      const blob = await r.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(filename || "upload").replace(/\.[a-z0-9]+$/i, "")}_current.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setBatchesErr(e instanceof Error ? e.message : "Download nahi hua");
    }
  }

  async function deleteBatchScopedHandler(
    batchId: string,
    row: { subjectId: string; chapterId: string | null; topicId: string | null; subTopicId: string | null; total: number },
  ) {
    if (!confirm(`Is hisse ke ${row.total} question(s) PERMANENTLY delete karein?`)) return;
    try {
      const params = new URLSearchParams();
      params.set("subjectId", row.subjectId);
      if (row.chapterId) params.set("chapterId", row.chapterId);
      if (row.topicId) params.set("topicId", row.topicId);
      if (row.subTopicId) params.set("subTopicId", row.subTopicId);
      const r = await fetchAuth(`${API_BASE}/bank/admin/upload/batches/${batchId}/questions?${params}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setBatchesErr(d?.message || `HTTP ${r.status}`);
        return;
      }
      setInfo(`${d.deletedQuestions ?? 0} question(s) delete ho gaye.`);
      await loadBatches();
      setExpandedBatchId(null);
      setExpandedBatchDetail(null);
    } catch (e) {
      setBatchesErr(e instanceof Error ? e.message : "Delete nahi hua");
    }
  }

  async function deleteBatchHandler(id: string, filename: string | null) {
    if (
      !confirm(
        `"${filename || "is upload"}" ke saare questions PERMANENTLY delete ho jayenge. Sirf history record rakhna hai to Cancel karke "Keep Questions" option use karein. Continue?`,
      )
    )
      return;
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/upload/batches/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setBatchesErr(d?.message || `HTTP ${r.status}`);
        return;
      }
      const d = await r.json();
      setInfo(`${d.deletedQuestions ?? 0} question(s) delete ho gaye is upload se.`);
      if (expandedBatchId === id) {
        setExpandedBatchId(null);
        setExpandedBatchDetail(null);
      }
      await loadBatches();
    } catch (e) {
      setBatchesErr(e instanceof Error ? e.message : "Delete nahi hua");
    }
  }

  // Builds either the combined CSV (category=null) or one category's CSV,
  // from a batch's persisted errorsJson — same shape/columns as
  // downloadErrorReport() above so an admin's existing workflow doesn't
  // change, just now works from HISTORY too, not only the just-finished result.
  function downloadBatchErrorReport(
    batch: UploadBatchDetail,
    category: UploadErrorCategory | null,
  ) {
    const errors = (batch.errorsJson || []).filter((e) => !category || e.category === category);
    if (errors.length === 0) return;
    const escapeCsv = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [
      ["Row", "Category", "Question Preview", "Error"].map(escapeCsv).join(","),
      ...errors.map((e) =>
        [String(e.row), CATEGORY_LABEL[e.category] ?? e.category, e.questionPreview ?? "", e.error]
          .map(escapeCsv)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const suffix = category ? `_${category.toLowerCase()}` : "_combined";
    a.download = `upload_errors_${(batch.filename || batch.id).replace(/[^a-z0-9._-]/gi, "_")}${suffix}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }

  React.useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  // Oct 7 2026: while any upload is still saving, refresh the history every 4s so the live counts keep moving
  // (works even after a page reload — the status/counts are stored on the server, not in this tab).
  const anyRunning = batches.some((b) => b.status === "RUNNING");
  React.useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => loadBatches(true), 4000);
    return () => clearInterval(t);
  }, [anyRunning, loadBatches]);

  React.useEffect(() => {
    // /admin/users and /admin/plans are ADMIN-only — staff would just get 403s.
    if (!access.isAdmin) return;
    loadUsers();
    loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, roleFilter, access.isAdmin]);

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      ADMIN: "bg-red-500/20 text-red-400",
      MODERATOR: "bg-amber-500/20 text-amber-400",
      STUDENT: "bg-blue-500/20 text-blue-400",
    };
    return <span className={`badge ${colors[role] || "bg-muted text-muted-foreground"}`}>{role}</span>;
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <BackButton />
            <Logo size={32} withWordmark={false} />
            <span className="text-lg font-bold tracking-tight">
              SSC<span className="text-primary">PrepHub</span> <span className="text-muted-foreground">Admin</span>
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {access.isAdmin && (
              <a href="/admin/staff" className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10">
                👥 Staff Access
              </a>
            )}
            {access.isAdmin && (
              <a href="/admin/notifications" className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">
                🔔 Notifications
              </a>
            )}
            {access.can("SUPPORT") && (
            <a
              href="/admin/support-chat"
              className="relative rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
            >
              💬 Support Chat
              {openChatCount > 0 && (
                <span className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                  {openChatCount > 9 ? "9+" : openChatCount}
                </span>
              )}
            </a>
            )}
            {access.can("SUPPORT") && (
            <a
              href="/admin/error-reports"
              className="relative rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
            >
              🚩 Error Reports
              {openReportCount > 0 && (
                <span className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                  {openReportCount > 9 ? "9+" : openReportCount}
                </span>
              )}
            </a>
            )}
            {access.isAdmin && (
              <a href="/admin/referrals" className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">
                Refer & Earn
              </a>
            )}
            {access.isAdmin && (
              <a href="/admin/api-keys" className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">
                API Keys
              </a>
            )}
            <button onClick={toggleTheme} aria-label="Toggle theme" className="rounded-lg border border-border p-2 text-sm hover:bg-muted">
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">{access.isAdmin ? "User Management" : "Staff Workspace"}</h1>
          {access.isAdmin && (
          <div className="flex gap-2">
            <button onClick={() => setShowEmailModal(true)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
              Bulk Grant Subscription
            </button>
          </div>
          )}
        </div>

        {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">{error}</div>}
        {info && <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">{info}</div>}

        {access.isAdmin && (
        <>
        {/* Plan / Pricing Management — previously missing entirely: the
            admin panel could only display plans to assign to a user, with
            no way to actually change a price or add a new plan. */}
        <div className="mb-6 rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Subscription Plans</h2>
            <button onClick={openCreatePlan} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
              + New Plan
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => (
              <div key={plan.id} className="rounded-lg border border-border bg-background p-3">
                <div className="font-medium">{plan.name}</div>
                <div className="mt-1 text-lg font-bold text-primary">₹{plan.priceInr}</div>
                <div className="text-xs text-muted-foreground">{plan.durationMonths} month{plan.durationMonths === 1 ? "" : "s"}</div>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => openEditPlan(plan)} className="flex-1 rounded-md border border-border px-2 py-1.5 text-xs font-medium hover:bg-muted">Edit</button>
                  <button onClick={() => deactivatePlan(plan)} className="flex-1 rounded-md border border-red-500/30 px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400">Deactivate</button>
                </div>
              </div>
            ))}
            {plans.length === 0 && (
              <p className="text-sm text-muted-foreground">No plans yet — click "+ New Plan" to create one.</p>
            )}
          </div>
        </div>
        </>
        )}

        {!access.loading && access.isStaff && !access.isAdmin && (
          <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
            <p className="font-semibold">Aapka access:</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {access.permissions.length === 0 && (
                <span className="text-muted-foreground">Abhi koi department assign nahi hua hai — admin se contact karein.</span>
              )}
              {access.can("QUESTIONS") && <span className="rounded-full bg-sky-500/15 px-3 py-1 text-xs font-medium text-sky-700 dark:text-sky-400">📘 Questions (PYQ)</span>}
              {access.can("PRACTICE") && <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">📗 Practice Questions</span>}
              {access.can("VOCABULARY") && <a href="/admin/vocab" className="rounded-full bg-purple-500/15 px-3 py-1 text-xs font-medium text-purple-700 hover:bg-purple-500/25 dark:text-purple-400">📖 Vocabulary →</a>}
              {access.can("SUPPORT") && <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">💬 Support & Reports</span>}
            </div>
          </div>
        )}

        {(access.can("QUESTIONS") || access.can("PRACTICE")) && (
        <>
        {/* Bulk Question Upload — was fully built on the backend but never
            wired to a controller/module and had no UI at all. Now working:
            download a template in the format you want, fill it in, upload it. */}
        <div className="mb-6 rounded-xl border border-border bg-card p-5">
          <h2 className="mb-1 font-semibold">Bulk Question Upload</h2>
          {/* NEW (this session) — expanded from one line into a real
              step-by-step guide, per admin request: "kis format me upload
              hoga uska guide bhi, example file bhi available ho". */}
          <div className="mb-3 rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
            <p className="mb-1 font-semibold text-foreground">Kaise upload karein (step-by-step):</p>
            <ol className="list-decimal space-y-1 pl-4">
              <li>Pehle "Download Full Question Bank" se dekh lein ki kaunse questions already maujood hain — dobara wahi type karne ki zaroorat nahi (duplicate apne aap reject ho jaata hai upload ke time).</li>
              <li>Ek format select karke uska Template download karein — Excel template mein ab ek "Reference IDs" sheet bhi hai jisme har exam/subject/chapter/topic ki real ID di hui hai, seedhe copy-paste kar sakte hain.</li>
              <li>Template mein ek hi file mein sab kuch bhar sakte hain — question, options (A–D), correctAnswer, explanation, Hindi translation, year, shift, paperCode — sab columns ek saath.</li>
              <li>Hindi translation (questionTextHindi) zaroor bharein — iske bina question save to hoga lekin students ko dikhega NAHI (bilingual gate), jab tak translation add na ho.</li>
              <li>Year bharne se woh question automatically Year-wise PYQ Test aur sectional practice dono mein count hoga — koi extra step nahi.</li>
              <li>File wapas upload karke format select karke "Upload Questions" dabayein — result mein kitne create hue, kitne fail/duplicate the, sab dikhega.</li>
            </ol>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Pehle format select karke template download karein, usme questions (answer, explanation, Hindi translation sab included) bhar ke wapas upload karein.
          </p>

          {/* SESSION 14 FIX: every row in the upload template needs a
              pre-existing chapterId (BankUploadService.validateReferences()
              rejects unknown ones — it never creates chapters on the fly).
              On a fresh subject with zero chapters there was previously no
              way to get one at all. Point admins at the new panel before
              they hit that wall. */}
          {access.can("QUESTIONS") && (<>
          <a
            href="/admin/chapters"
            className="mb-3 inline-block rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
          >
            🧩 Chapter IDs chahiye upload se pehle? Manage Chapters →
          </a>
          <a
            href="/admin/coverage"
            className="mb-3 ml-2 inline-block rounded-lg border border-danger/40 bg-danger/5 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10"
          >
            🕳️ Kaunse Topic/Sub-Topic mein question missing hai? Coverage / Gap Finder →
          </a>
          <a
            href="/admin/questions/duplicates"
            className="mb-3 ml-2 inline-block rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
          >
            🧬 Duplicate Review — same question ek rakhein ya dono →
          </a>
          <a
            href="/admin/questions/manage"
            className="mb-3 ml-2 inline-block rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
          >
            🗂️ Questions ko chapter/topic/sub-topic me move, publish ya delete karein — Question Manager →
          </a>
          </>)}
          {access.can("VOCABULARY") && (
          <a
            href="/admin/vocab"
            className="mb-3 ml-2 inline-block rounded-lg border border-purple-500/40 bg-purple-500/5 px-3 py-1.5 text-xs font-medium text-purple-600 hover:bg-purple-500/10 dark:text-purple-400"
          >
            📖 Vocabulary words + questions Excel se upload karein — Vocabulary Manage →
          </a>
          )}
          <a
            href="/admin/questions/add"
            className="mb-4 block rounded-xl border-2 border-primary/50 bg-primary/5 p-4 text-center text-sm font-semibold text-primary hover:bg-primary/10"
          >
            ➕ Ek-ek question daalein (PYQ ya Practice) — Hindi box + question/option image + duplicate check →
          </a>
          <form
            className="mb-4 flex gap-2 rounded-xl border border-border bg-card p-3"
            onSubmit={(e) => {
              e.preventDefault();
              const v = String(new FormData(e.currentTarget).get("qno") || "").trim();
              if (v) window.location.href = `/admin/questions/edit?q=${encodeURIComponent(v)}`;
            }}
          >
            <input name="qno" inputMode="search" placeholder="Question number (jaise 1042) — seedha kholkar edit karein" className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            <button type="submit" className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">✏️ Edit</button>
            <a href="/admin/questions/manage" className="hidden shrink-0 rounded-lg border border-border px-3 py-2 text-sm font-semibold sm:block">Sab questions</a>
          </form>
          <AdminImageTools />
          <div className="mb-3 flex flex-wrap gap-2">
            {(["excel", "csv", "json", "text"] as const).map((f) => (
              <button
                key={f}
                onClick={() => downloadTemplate(f)}
                disabled={templateDownloading}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                ⬇️ {f.toUpperCase()} Template
              </button>
            ))}
            <button
              onClick={downloadBankExport}
              disabled={bankExportDownloading}
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-400"
              title="Poora question bank isi upload-format mein download karein — dekhein kya already maujood hai"
            >
              {bankExportDownloading ? "Exporting..." : "Download Full Question Bank"}
            </button>
            <button
              onClick={() => downloadGapsExport()}
              disabled={gapsExportDownloading}
              className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
              title="Sirf vo questions jisme Hindi translation, solution, ya answer key missing hai — PYQ aur Practice dono"
            >
              {gapsExportDownloading ? "Exporting..." : "⬇️ Download Gaps (Missing Hindi/Solution/Answer)"}
            </button>
          </div>
          <p className="mb-3 -mt-1 text-xs text-muted-foreground">
            💡 Bahut saare questions (10,000 se 1 lakh) ke liye <b>CSV</b> sabse tez hai (UTF-8 me save karein). Excel bhi chalega — 25-30 hazaar rows tak.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">File Format</label>
              <select
                value={uploadFormat}
                onChange={(e) => setUploadFormat(e.target.value as typeof uploadFormat)}
                className="rounded-lg border border-border bg-background px-4 py-2 text-sm outline-none focus:border-primary"
              >
                <option value="excel">Excel (.xlsx)</option>
                <option value="csv">CSV (.csv)</option>
                <option value="json">JSON (.json)</option>
                <option value="text">Text (.txt, tab-separated)</option>
                <option value="word">Word (.docx)</option>
              </select>
            </div>
            <div className="flex-1 min-w-[220px]">
              <label className="mb-1.5 block text-sm font-medium">Question File</label>
              <input
                type="file"
                accept=".xlsx,.xls,.csv,.json,.txt,.docx"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* NEW (Sep 21 2026) — two large, unmistakably separate upload buttons
              instead of one button + a checkbox that was easy to forget. */}
          <label className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-muted/20 p-3 text-sm">
            <input type="checkbox" className="mt-1" checked={requireSolution} onChange={(e) => setRequireSolution(e.target.checked)} />
            <span>
              Solution ke bina question upload na ho (missing solution report me aayega)
              <span className="block text-xs text-muted-foreground">Answer key missing, khali option aur duplicate questions hamesha reject hote hain aur report me dikhte hain.</span>
            </span>
          </label>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={checkOnly} onChange={(e) => setCheckOnly(e.target.checked)} />
            Sirf check karo — kuch save mat karo (pehle report dekhne ke liye)
          </label>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <button
              onClick={() => submitUpload("practice")}
              disabled={uploading || !uploadFile || !access.can("PRACTICE")}
              title={access.can("PRACTICE") ? undefined : "Aapko Practice upload ka access nahi hai"}
              className="flex flex-col items-center gap-1 rounded-xl border-2 border-emerald-500 bg-emerald-500/10 px-4 py-5 text-center font-semibold text-emerald-700 transition hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-400"
            >
              <span className="text-lg">📗 Upload PRACTICE Questions</span>
              <span className="text-xs font-normal opacity-80">
                Year/shift/paper-code ignored even if sheet has them. Sirf Practice screens (chapter/topic/sub-topic) me dikhenge — Year-wise PYQ test me NAHI.
              </span>
            </button>
            <button
              onClick={() => submitUpload("pyq")}
              disabled={uploading || !uploadFile || !access.can("QUESTIONS")}
              title={access.can("QUESTIONS") ? undefined : "Aapko PYQ upload ka access nahi hai"}
              className="flex flex-col items-center gap-1 rounded-xl border-2 border-sky-500 bg-sky-500/10 px-4 py-5 text-center font-semibold text-sky-700 transition hover:bg-sky-500/20 disabled:opacity-50 dark:text-sky-400"
            >
              <span className="text-lg">📘 Upload PYQ Questions</span>
              <span className="text-xs font-normal opacity-80">
                Har row me 'year' zaroori hai. Yahi questions Year-wise PYQ Test aur chapter-wise PYQ me dikhenge — Practice screens me NAHI.
              </span>
            </button>
          </div>
          {uploading && !uploadJob && <p className="mt-2 text-sm text-muted-foreground">Uploading file...</p>}
          {uploadJob && (
            <div className="mt-3 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
              <p className="font-semibold">⏳ {PHASE_LABEL[uploadJob.phase] ?? uploadJob.phase}</p>
              {uploadJob.total > 0 && (
                <>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, Math.round((uploadJob.processed / uploadJob.total) * 100))}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {uploadJob.processed.toLocaleString()} / {uploadJob.total.toLocaleString()} rows
                    {uploadJob.phase === "SAVING" ? ` · saved ${uploadJob.created.toLocaleString()} · failed ${uploadJob.failed.toLocaleString()}` : ""}
                  </p>
                </>
              )}
              <p className="mt-1 text-xs text-muted-foreground">Badi file me kuch minute lag sakte hain — ye page khula rakhein. Server par import chalta rahega. / Large files take a few minutes; keep this page open.</p>
            </div>
          )}

          {uploadResult && (
            <div className="mt-4 rounded-lg border border-border bg-background p-3 text-sm">
              <div className="flex flex-wrap items-center gap-4">
                <span>Total: <strong>{uploadResult.total}</strong></span>
                <span className="text-emerald-600 dark:text-emerald-400">Created: <strong>{uploadResult.created}</strong></span>
                <span className="text-red-600 dark:text-red-400">Failed: <strong>{uploadResult.failed}</strong></span>
                {(uploadResult.reviewAlready ?? 0) > 0 && (
                  <span className="text-xs text-muted-foreground" title="Pehle se Duplicate Review me the ya aap pehle 'purana rakho' decide kar chuke the">+{uploadResult.reviewAlready} pehle se review me / skip</span>
                )}
                {(uploadResult.unaccounted ?? 0) > 0 && (
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">⚠️ {uploadResult.unaccounted} rows ka hisaab nahi mila</span>
                )}
                {(uploadResult.queuedForReview ?? 0) > 0 && (
                  <a href="/admin/questions/duplicates" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
                    🧬 {uploadResult.queuedForReview} duplicate Review me gaye{(uploadResult.queuedExact ?? 0) > 0 ? ` (${uploadResult.queuedExact} exact same)` : ""} — purana / naya / dono chunne ke liye kholein →
                  </a>
                )}
                {uploadResult.errorsTruncated && (
                  <span className="w-full text-xs text-amber-600">
                    ⚠️ Total {uploadResult.failed.toLocaleString()} rows fail hui — yahan sirf pehli {uploadResult.errors.length.toLocaleString()} dikh rahi hain. Pehle inhe theek karke dobara upload karein. / Only the first {uploadResult.errors.length.toLocaleString()} failures are listed.
                  </span>
                )}
                {/* NEW: one-click download of the full error report as CSV
                    — row, category, question preview, exact error message
                    — so the admin can open it next to their spreadsheet
                    and fix every failed row without scrolling this panel. */}
                {rejectedUrl && uploadResult.errors.length > 0 && (
                  <button
                    onClick={downloadRejectedRows}
                    className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400"
                  >
                    📄 Rejected rows file (fix karke dobara upload)
                  </button>
                )}
                {uploadResult.errors.length > 0 && (
                  <button
                    onClick={() => downloadErrorReport(uploadResult)}
                    className="ml-auto rounded-md border border-border px-3 py-1 text-xs font-semibold hover:bg-muted"
                  >
                    📥 Download Error Report (CSV)
                  </button>
                )}
              </div>

              {/* NEW: category breakdown — "38 Missing Field, 12 Duplicate,
                  4 Invalid Reference" at a glance, computed from the same
                  errors array rendered below (no separate backend call). */}
              {uploadResult.errors.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {(Object.entries(
                    // Oct 1 2026: prefer the server's exact per-category totals — the
                    // errors list itself is capped at the first ~1000 rows.
                    uploadResult.errorSummary ??
                      uploadResult.errors.reduce((acc: Record<string, number>, e) => {
                        acc[e.category] = (acc[e.category] || 0) + 1;
                        return acc;
                      }, {}),
                  ) as [UploadErrorCategory, number][]).map(([cat, count]) => (
                    <span key={cat} className="rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400">
                      {CATEGORY_LABEL[cat] ?? cat}: {count}
                    </span>
                  ))}
                </div>
              )}

              {uploadResult.errors.length > 0 && (
                <div className="mt-2">
                  <div className="mb-1 text-xs font-semibold text-red-500">Errors:</div>
                  <ul className="max-h-60 space-y-1.5 overflow-y-auto text-xs text-muted-foreground">
                    {uploadResult.errors.map((e, i) => (
                      <li key={i} className="rounded border border-red-500/20 bg-red-500/5 p-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-foreground">Row {e.row}</span>
                          <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                            {CATEGORY_LABEL[e.category] ?? e.category}
                          </span>
                        </div>
                        {e.questionPreview && (
                          <div className="mt-0.5 italic text-foreground/80">"{e.questionPreview}"</div>
                        )}
                        <div className="mt-0.5">{e.error}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {uploadResult.warnings.length > 0 && (
                <div className="mt-2">
                  <div className="mb-1 text-xs font-semibold text-amber-500">Warnings:</div>
                  <ul className="max-h-40 space-y-1.5 overflow-y-auto text-xs text-muted-foreground">
                    {uploadResult.warnings.map((w, i) => (
                      <li key={i} className="rounded border border-amber-500/20 bg-amber-500/5 p-1.5">
                        <span className="font-semibold text-foreground">Row {w.row}</span>
                        {w.questionPreview && <span className="italic"> — "{w.questionPreview}"</span>}
                        <div className="mt-0.5">{w.message}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Phase 3 (Sep 2026) — Upload History: persisted record of every
            past Excel/CSV/Text/JSON/Word question upload, with per-batch
            error report download (combined + per-category) and delete. */}
        <div className="mb-6 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">📜 Upload History</h2>
            <button
              onClick={() => loadBatches()}
              disabled={batchesLoading}
              className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
            >
              {batchesLoading ? "Loading..." : "🔄 Refresh"}
            </button>
          </div>
          {batchesErr && <p className="mt-2 text-sm text-danger">{batchesErr}</p>}
          {!batchesErr && !batchesLoading && batches.length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">Abhi tak koi upload record nahi hai.</p>
          )}
          {batches.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Kab</th>
                    <th className="px-3 py-2">File</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Upload hue</th>
                    <th className="px-3 py-2 text-right">Failed</th>
                    <th className="px-3 py-2 text-right">Duplicate review</th>
                    <th className="px-3 py-2">Ab Live/Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <React.Fragment key={b.id}>
                      <tr className="border-b border-border last:border-0">
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                          {new Date(b.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="max-w-[260px] break-words px-3 py-2 font-medium" title={b.filename ?? ""}>{b.filename || "—"}</td>
                        <td className="px-3 py-2 text-xs">{b.sourceType}</td>
                        <td className="px-3 py-2 text-xs">
                          {(b.status ?? "DONE") === "RUNNING" ? (
                            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 font-semibold text-sky-600 dark:text-sky-400" title="Upload abhi chal raha hai — page band karne par bhi server par chalta rahega">
                              ⏳ Chal raha hai {b.totalRows > 0 ? `${Math.min(100, Math.round(((b.createdCount + b.failedCount + (b.queuedCount ?? 0)) / b.totalRows) * 100))}%` : ""}
                            </span>
                          ) : b.status === "FAILED" ? (
                            <span className="rounded-full bg-red-500/15 px-2 py-0.5 font-semibold text-red-600" title={b.errorMessage ?? ""}>❌ Fail</span>
                          ) : b.status === "INTERRUPTED" ? (
                            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-400" title="Server restart ya error ki wajah se beech me ruk gaya. Jo questions save ho chuke wo Upload hue me hain; baaki ki file dobara upload karein (duplicate apne aap review me chale jayenge).">⚠️ Beech me ruka{(b.pendingRows ?? 0) > 0 ? ` (${b.pendingRows} baaki)` : ""}</span>
                          ) : (
                            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-600 dark:text-emerald-400">✅ Poora</span>
                          )}
                          {(b.status ?? "DONE") === "DONE" && (b.pendingRows ?? 0) > 0 && (
                            <span className="mt-1 block text-[10px] font-medium text-amber-700 dark:text-amber-400" title="Total = Upload hue + Failed + Duplicate review + Skip hona chahiye. Is file ke itne rows ka hisaab nahi mila — file dobara upload karke dekhein.">
                              ⚠️ {b.pendingRows} rows ka hisaab nahi mila
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">{b.totalRows}</td>
                        <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400">{b.createdCount}</td>
                        <td className="px-3 py-2 text-right text-red-600 dark:text-red-400">{b.failedCount}</td>
                        <td className="px-3 py-2 text-right">
                          {(b.queuedCount ?? 0) > 0 ? (
                            <a href={`/admin/questions/duplicates?batch=${b.id}`} className="font-semibold text-amber-700 underline dark:text-amber-400" title="Ye same question pehle se the — purana / naya / dono chunein">{b.queuedCount} →</a>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                          {(b.skippedCount ?? 0) > 0 && (
                            <span className="block text-[10px] text-muted-foreground" title="Ye duplicate pehle se review list me the ya aap pehle 'purana rakho' decide kar chuke the">+{b.skippedCount} pehle se</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {b.kind && (
                            <span
                              className={`mr-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                b.kind === "pyq"
                                  ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                                  : b.kind === "practice"
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : b.kind === "mixed"
                                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {b.kind.toUpperCase()}
                            </span>
                          )}
                          <span className="text-emerald-600 dark:text-emerald-400">{b.liveCount ?? 0} live</span>
                          {" / "}
                          <span className="text-amber-600 dark:text-amber-400">{b.pendingCount ?? 0} pending</span>
                        </td>
                      </tr>
                      <tr className="border-b border-border last:border-0">
                        <td colSpan={10} className="px-3 pb-3 pt-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => toggleBatchDetail(b.id)}
                              className="whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                            >
                              {expandedBatchId === b.id ? "▴ Details band karein" : "📋 Details / errors dekhein"}
                            </button>
                            <a
                              href={`/admin/questions/manage?batch=${b.id}`}
                              className="whitespace-nowrap rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10"
                              title="Is upload ke saare questions dekhein, search karein aur ek-ek ko edit karein"
                            >
                              ✏️ Questions dekhein / edit
                            </a>
                            {(b.pendingCount ?? 0) > 0 && (
                              <button
                                onClick={() => publishBatchHandler(b.id)}
                                className="whitespace-nowrap rounded-lg border border-emerald-500/40 px-3 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
                                title="Is batch ke sabhi pending questions ko ek click me publish (live) karein"
                              >
                                ✅ Publish All ({b.pendingCount})
                              </button>
                            )}
                            <button
                              onClick={() => downloadBatchHandler(b.id, b.filename)}
                              className="whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                              title="Is batch ke abhi maujood questions Excel me download karein"
                            >
                              ⬇️ Download
                            </button>
                            <button
                              onClick={() => deleteBatchHandler(b.id, b.filename)}
                              className="whitespace-nowrap rounded-lg border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10"
                            >
                              🗑️ Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedBatchId === b.id && (
                        <tr className="border-b border-border last:border-0 bg-muted/20">
                          <td colSpan={10} className="px-3 py-3">
                            {!expandedBatchDetail ? (
                              <p className="text-xs text-muted-foreground">Loading...</p>
                            ) : (
                              <>
                                {(expandedBatchDetail.breakdown?.length ?? 0) > 0 && (
                                  <div className="mb-3">
                                    <p className="mb-1 text-xs font-semibold text-foreground">
                                      Chapter / Topic / Sub-topic wise (delete sirf isi hisse ke questions):
                                    </p>
                                    <div className="max-h-48 space-y-1 overflow-y-auto">
                                      {expandedBatchDetail.breakdown!.map((row, i) => (
                                        <div key={i} className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1 text-xs">
                                          <span className="truncate">
                                            {row.subject} {row.chapter ? `› ${row.chapter}` : ""} {row.topic ? `› ${row.topic}` : ""} {row.subTopic ? `› ${row.subTopic}` : ""}
                                            {" — "}
                                            <span className="text-emerald-600 dark:text-emerald-400">{row.live} live</span>
                                            {", "}
                                            <span className="text-amber-600 dark:text-amber-400">{row.pending} pending</span>
                                          </span>
                                          <button
                                            onClick={() => deleteBatchScopedHandler(b.id, row)}
                                            className="shrink-0 rounded border border-danger/30 px-1.5 py-0.5 text-[10px] text-danger hover:bg-danger/10"
                                          >
                                            Delete this
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                            {(expandedBatchDetail.errorsJson?.length ?? 0) === 0 ? (
                              <p className="text-xs text-muted-foreground">Is upload me koi error nahi tha.</p>
                            ) : (
                              <div>
                                <div className="mb-2 flex flex-wrap gap-2">
                                  <button
                                    onClick={() => downloadBatchErrorReport(expandedBatchDetail, null)}
                                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                                  >
                                    📥 Combined Error Report
                                  </button>
                                  {(Object.keys(CATEGORY_LABEL) as UploadErrorCategory[])
                                    .filter((cat) => expandedBatchDetail.errorsJson!.some((e) => e.category === cat))
                                    .map((cat) => (
                                      <button
                                        key={cat}
                                        onClick={() => downloadBatchErrorReport(expandedBatchDetail, cat)}
                                        className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted"
                                      >
                                        📥 {CATEGORY_LABEL[cat]} only
                                      </button>
                                    ))}
                                </div>
                                <ul className="max-h-60 space-y-1.5 overflow-y-auto text-xs text-muted-foreground">
                                  {expandedBatchDetail.errorsJson!.map((e, i) => (
                                    <li key={i} className="rounded border border-red-500/20 bg-red-500/5 p-1.5">
                                      <div className="flex items-center gap-1.5">
                                        <span className="font-semibold text-foreground">Row {e.row}</span>
                                        <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                                          {CATEGORY_LABEL[e.category] ?? e.category}
                                        </span>
                                      </div>
                                      {e.questionPreview && (
                                        <div className="mt-0.5 italic text-foreground/80">&quot;{e.questionPreview}&quot;</div>
                                      )}
                                      <div className="mt-0.5">{e.error}</div>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                              </>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </>
        )}

        {access.isAdmin && (
        <>
        {/* Filters */}
        <div className="mb-4 flex flex-wrap gap-4 rounded-xl border border-border bg-card p-4">
          <div className="flex-1 min-w-[200px]">
            <label className="mb-1.5 block text-sm font-medium">Search (email/name)</label>
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search users..."
              className="w-full rounded-lg border border-border bg-background px-4 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="flex-1 min-w-[150px]">
            <label className="mb-1.5 block text-sm font-medium">Role Filter</label>
            <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }} className="w-full rounded-lg border border-border bg-background px-4 py-2 text-sm outline-none focus:border-primary">
              <option value="">All Roles</option>
              <option value="STUDENT">Student</option>
              <option value="ADMIN">Admin</option>
              <option value="MODERATOR">Moderator</option>
            </select>
          </div>
        </div>

        {/* Users Table */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">User</th>
                  <th className="px-4 py-3 text-left font-medium">Role</th>
                  <th className="px-4 py-3 text-left font-medium">Phone</th>
                  <th className="px-4 py-3 text-left font-medium">Email Verified</th>
                  <th className="px-4 py-3 text-left font-medium">Tests Taken</th>
                  <th className="px-4 py-3 text-left font-medium">Bookmarks</th>
                  <th className="px-4 py-3 text-left font-medium">Subscription</th>
                  <th className="px-4 py-3 text-left font-medium">Joined</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">No users found</td></tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.id} className="border-t border-border hover:bg-muted/50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <UserAvatar name={u.fullName} email={u.email} src={u.avatarUrl} size={36} />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{u.fullName}</div>
                            <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">{roleBadge(u.role)}</td>
                      <td className="px-4 py-3 text-sm">{u.phone || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-4 py-3">
                        {u.isEmailVerified ? "✅ Verified" : <span className="text-amber-500">⏳ Pending</span>}
                      </td>
                      <td className="px-4 py-3">{u._count.testAttempts}</td>
                      <td className="px-4 py-3">{u._count.bookmarks}</td>
                      <td className="px-4 py-3">
                        {u.subscriptions.length > 0 ? (
                          u.subscriptions.map((s) => (
                            <div key={s.planId} className="text-xs">
                              <span className={s.status === "ACTIVE" ? "text-emerald-500" : "text-muted-foreground"}>
                                {s.status === "ACTIVE" ? "✅" : "❌"} {s.planId} {s.endsAt ? `until ${new Date(s.endsAt).toLocaleDateString()}` : ""}
                              </span>
                            </div>
                          ))
                        ) : (
                          <span className="text-muted-foreground">Free</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setSelectedUser(u)} className="rounded border border-border px-2 py-1 text-xs hover:bg-muted">View</button>
                          {u.subscriptions.some(s => s.status === "ACTIVE") ? (
                            <button onClick={() => cancelSubscription(u.id)} className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-600 hover:bg-red-500/20">Cancel Sub</button>
                          ) : (
                            <button onClick={() => { setSelectedUser(u); setShowSubscriptionModal(true); }} className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-600 hover:bg-emerald-500/20">Add Sub</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-border flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Page {page} of {Math.ceil(total / limit)} — {total} total users</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="rounded border border-border px-3 py-1 text-sm disabled:opacity-50">Prev</button>
              <button onClick={() => setPage(p => Math.min(Math.ceil(total / limit), p + 1))} disabled={page === Math.ceil(total / limit)} className="rounded border border-border px-3 py-1 text-sm disabled:opacity-50">Next</button>
            </div>
          </div>
        </div>
        </>
        )}
      </main>

      {/* Add/Edit Plan Modal */}
      {showPlanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
            <h2 className="text-xl font-bold">{editingPlanId ? "Edit Plan" : "New Plan"}</h2>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Plan Name</label>
                <input
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  placeholder="e.g. Super Pass (6 Months)"
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Price (₹)</label>
                <input
                  type="number"
                  min="1"
                  value={planPriceInr}
                  onChange={(e) => setPlanPriceInr(e.target.value)}
                  placeholder="499"
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Duration (months)</label>
                <input
                  type="number"
                  min="1"
                  value={planDurationMonths}
                  onChange={(e) => setPlanDurationMonths(e.target.value)}
                  placeholder="6"
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                />
              </div>
            </div>
            <div className="mt-6 flex gap-2">
              <button onClick={savePlan} className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
                {editingPlanId ? "Save Changes" : "Create Plan"}
              </button>
              <button onClick={() => setShowPlanModal(false)} className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm hover:bg-muted">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Subscription Modal */}
      {showSubscriptionModal && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
            <h2 className="text-xl font-bold">Add Subscription for {selectedUser.fullName}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{selectedUser.email}</p>
            <div className="mt-4 space-y-3 max-h-60 overflow-y-auto">
              {plans.filter(p => p.isActive).map((plan) => (
                <button
                  key={plan.id}
                  onClick={() => addSubscription(selectedUser.id, plan.id)}
                  className="w-full text-left rounded-lg border border-border bg-background p-3 hover:border-primary hover:bg-primary/5 transition"
                >
                  <div className="font-medium">{plan.name} — ₹{plan.priceInr}/{plan.durationMonths} mo</div>
                </button>
              ))}
            </div>
            <button onClick={() => { setShowSubscriptionModal(false); setSelectedUser(null); }} className="mt-4 w-full rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted">Cancel</button>
          </div>
        </div>
      )}

      {/* Bulk Email Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
            <h2 className="text-xl font-bold">📧 Bulk Grant Subscription</h2>
            <p className="mt-1 text-sm text-muted-foreground">Enter emails (comma-separated) and select a plan</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Emails</label>
                <textarea
                  value={bulkEmail}
                  onChange={(e) => setBulkEmail(e.target.value)}
                  placeholder="user1@example.com, user2@example.com"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Plan</label>
                <select value={bulkPlanId} onChange={(e) => setBulkPlanId(e.target.value)} className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary">
                  <option value="">Select Plan</option>
                  {plans.filter(p => p.isActive).map((plan) => (
                    <option key={plan.id} value={plan.id}>{plan.name} — ₹{plan.priceInr}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-6 flex gap-2">
              <button onClick={sendBulkSubscription} disabled={!bulkEmail || !bulkPlanId} className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">Grant Subscriptions</button>
              <button onClick={() => { setShowEmailModal(false); setBulkEmail(""); setBulkPlanId(""); }} className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm hover:bg-muted">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
