"use client";

import * as React from "react";
import { api, API_BASE, fetchAuth } from "@/lib/api";
import { useAccess } from "@/lib/permissions";
import AdminImageTools from "@/components/AdminImageTools";
import { isoToDmy } from "@/lib/exam-date";

interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
  phone?: string | null;
  avatarUrl?: string | null;
  preferredLanguage?: string;
  isEmailVerified: boolean;
  isSuspended?: boolean;
  suspendedAt?: string | null;
  suspendedReason?: string | null;
  createdAt: string;
  subscriptions: { status: string; endsAt: string | null; startsAt?: string; planId: string; plan?: { name: string } | null }[];
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
  // Oct 14 2026: `field` = problem column, `fix` = how to correct it, `file` = which file (multi-file upload)
  errors: { row: number; error: string; category: UploadErrorCategory; questionPreview?: string; field?: string; fix?: string; file?: string }[];
  warnings: { row: number; message: string; questionPreview?: string; file?: string }[];
  uploadBatchId?: string;
  // Oct 1 2026 (huge uploads): only the first ~1000 failed rows are listed.
  errorsTruncated?: boolean;
  errorSummary?: Record<string, number>;
  warningsTotal?: number;
  queuedForReview?: number;
  queuedExact?: number;
  reviewAlready?: number;
  unaccounted?: number;
  // Oct 15 2026 (Task B): rows with an `id` UPDATE that question; check-only runs show a row-by-row preview
  updated?: number;
  unchanged?: number;
  preview?: Array<{ row: number; action: "NEW" | "UPDATE" | "SAME"; changes?: string[]; text?: string }>;
  // 26 Oct 2026: date-wise + tier-wise PYQ papers this file feeds / rows that join none
  papers?: Array<{ key: string; examId: string; examTier: string; tierPaper: string; examDate: string; shift: string | null; rows: number }>;
  pending?: Array<{ row: number; reason: string; message: string }>;
  pendingTotal?: number;
  // 29 Oct 2026 (S37): one Excel = PYQ rows + practice rows
  pyqRows?: number;
  practiceRows?: number;
  pyqWithoutQuestionNo?: number;
  practicePlan?: PracticePlanRow[];
  practicePlanTruncated?: boolean;
  unknownExams?: Array<{ value: string; rows: number[]; count: number }>;
  hindiMissingRows?: number[];
}

interface PracticePlanRow {
  subject?: string;
  chapterId?: string;
  subjectId?: string;
  topicId?: string;
  subTopicId?: string;
  chapter: string;
  topic: string;
  subTopic: string;
  count: number;
  existing: number;
  after: number;
  target: number;
  missing: number;
  topicNew: boolean;
  subTopicNew: boolean;
}

type UploadKind = "practice" | "pyq" | "mixed";

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
  QUEUED: "In queue",
  PARSING: "Reading the file",
  CHECKING: "Validating the rows",
  DUPLICATES: "Duplicate check",
  SAVING: "Saving to the database",
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

export default function AdminUploadsPage() {
  // Department access: ADMIN sees everything; staff (MODERATOR) only what the
  // admin granted (Questions / Practice / Vocabulary / Support).
  const access = useAccess();
  const [users, setUsers] = React.useState<User[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [limit] = React.useState(20);
  const [search, setSearch] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [selectedUser, setSelectedUser] = React.useState<User | null>(null);
  const [showSubscriptionModal, setShowSubscriptionModal] = React.useState(false);
  const [showEmailModal, setShowEmailModal] = React.useState(false);
  const [bulkEmail, setBulkEmail] = React.useState("");
  const [bulkPlanId, setBulkPlanId] = React.useState("");
  // Optional custom duration for admin grants ("" = use the plan's own length).
  const [grantUnit, setGrantUnit] = React.useState<"plan" | "days" | "months">("plan");
  const [grantAmount, setGrantAmount] = React.useState("");
  const [grantBusy, setGrantBusy] = React.useState(false);
  const [bulkResult, setBulkResult] = React.useState<{ total: number; granted: number; failed: number; results: { email: string; success: boolean; reason?: string }[] } | null>(null);
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
  // Bulk Question Upload — the backend (BankUploadService) always had the
  // Excel/CSV/JSON/Text/Word parsing + duplicate-detection logic, but it was
  // never wired to a controller and this page had zero UI for it, so admins
  // had no working way to add questions in bulk. Fixed on the backend
  // (bank-upload.controller.ts + bank.module.ts) — this is the UI for it.
  const [uploadFormat, setUploadFormat] = React.useState<"excel" | "csv" | "json" | "text" | "word">("excel");
  // Oct 14 2026: many files at once (PYQ Excel etc.) — uploaded one after another so duplicates between files are caught too.
  const [uploadFiles, setUploadFiles] = React.useState<File[]>([]);
  const uploadFile: File | null = uploadFiles[0] ?? null;
  const [fileStatuses, setFileStatuses] = React.useState<{ name: string; state: "wait" | "run" | "done" | "fail"; text?: string }[]>([]);
  const [rejectedList, setRejectedList] = React.useState<{ name: string; url: string }[]>([]);
  // after upload: every duplicate -> keep the NEW (latest) one, then publish — no clicking per question
  const [autoLatest, setAutoLatest] = React.useState(true);
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
    errorsJson: { row: number; error: string; category: UploadErrorCategory; questionPreview?: string; field?: string; fix?: string }[] | null;
    warningsJson: { row: number; message: string; questionPreview?: string }[] | null;
    breakdown?: {
      subjectId: string; subject: string | null; chapterId: string | null; chapter: string | null;
      topicId: string | null; topic: string | null; subTopicId: string | null; subTopic: string | null;
      live: number; pending: number; total: number;
    }[];
  };
  const [batches, setBatches] = React.useState<UploadBatchSummary[]>([]);
  // Oct 14 2026: select uploads (or all) -> Publish / Unpublish (undo a mistaken publish) in one click
  const [selectedBatchIds, setSelectedBatchIds] = React.useState<Set<string>>(new Set());
  const [bulkBatchBusy, setBulkBatchBusy] = React.useState(false);
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
      if (statusFilter) params.append("status", statusFilter);
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

  function durationPayload(): { months?: number; days?: number } {
    if (grantUnit === "plan") return {};
    const n = Number(grantAmount);
    if (!Number.isInteger(n) || n < 1) throw new Error("Custom duration must be a whole number (1 or more)");
    return grantUnit === "days" ? { days: n } : { months: n };
  }

  async function addSubscription(userId: string, planId: string) {
    if (grantBusy) return;
    setError("");
    setGrantBusy(true);
    try {
      const res = await api<{ extended: boolean; endsAt: string }>(`/admin/users/${userId}/subscription/add`, {
        method: "POST",
        body: JSON.stringify({ planId, ...durationPayload() }),
      });
      setInfo(
        `${res.extended ? "Subscription extended" : "Subscription added"} — valid until ${new Date(res.endsAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`,
      );
      setShowSubscriptionModal(false);
      setSelectedUser(null);
      setGrantUnit("plan");
      setGrantAmount("");
      loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add subscription");
    } finally {
      setGrantBusy(false);
    }
  }

  async function sendBulkSubscription() {
    if (!bulkEmail.trim() || !bulkPlanId || grantBusy) return;
    setError("");
    setGrantBusy(true);
    try {
      const res = await api<NonNullable<typeof bulkResult>>("/admin/subscriptions/bulk", {
        method: "POST",
        body: JSON.stringify({ emails: bulkEmail, planId: bulkPlanId, ...durationPayload() }),
      });
      setBulkResult(res);
      setInfo(`Bulk grant done: ${res.granted} granted, ${res.failed} failed`);
      loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send bulk subscriptions");
    } finally {
      setGrantBusy(false);
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

  // Oct 15 2026 (Task B): practice-question Excel template with dropdowns + Hinglish hints + examples
  async function downloadPracticeTemplate() {
    setTemplateDownloading(true);
    setError("");
    try {
      const res = await fetchAuth(`${API_BASE}/bank/admin/upload/template/practice`);
      if (!res.ok) throw new Error(`Template download fail (HTTP ${res.status})`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "practice-questions-template.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Template download fail");
    } finally {
      setTemplateDownloading(false);
    }
  }

  // S37: ONE Excel for PYQ + practice (34 columns, dropdowns, Reference IDs of every exam / chapter / topic / sub-topic)
  async function downloadMixedTemplate() {
    setTemplateDownloading(true);
    setError("");
    try {
      const res = await fetchAuth(`${API_BASE}/bank/admin/upload/template/pyq-practice`);
      if (!res.ok) throw new Error(`Template download fail (HTTP ${res.status})`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pyq-practice-template.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Template download fail");
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

  // Which backend route a file goes to — decided from its extension so a mixed selection (xlsx + csv) just works.
  function formatForFile(f: File): "excel" | "csv" | "json" | "text" | "word" {
    const n = f.name.toLowerCase();
    if (/\.(xlsx|xls)$/.test(n)) return "excel";
    if (/\.csv$/.test(n)) return "csv";
    if (/\.json$/.test(n)) return "json";
    if (/\.txt$/.test(n)) return "text";
    if (/\.docx$/.test(n)) return "word";
    return uploadFormat;
  }

  // Uploads ONE file and returns its result (+ rejected-rows url). Throws with the real server message on failure.
  async function uploadOneFile(file: File, kind: UploadKind): Promise<{ result: UploadResult; rejectedUrl: string | null }> {
    const fmt = formatForFile(file);
    // JSON (text / SVG-code / image questions) runs as a background job too.
    if (fmt === "json" || (checkOnly && (fmt === "excel" || fmt === "csv"))) {
      return submitJsonJob(kind, file);
    }
    const formData = new FormData();
    formData.append("file", file);
    formData.append("kind", kind);
    formData.append("requireSolution", String(requireSolution));
    if (kind === "practice") formData.append("isPracticeOnly", "true");
    // mixed: no flag - every row decides for itself (year / exam date = PYQ, none = practice)
    // Oct 1 2026: Excel/CSV run as a BACKGROUND job (any size, even 1 lakh
    // rows) — the request returns at once and we poll for progress, so
    // the browser/Cloudflare never time out on a long import.
    const useAsync = fmt === "excel" || fmt === "csv";
    if (useAsync) formData.append("async", "true");
    const res = await fetchAuth(`${API_BASE}/bank/admin/upload/${fmt}`, { method: "POST", body: formData });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const m = (data as { message?: string | string[] } | null)?.message;
      throw new Error((Array.isArray(m) ? m.join("; ") : m) || `Upload failed (HTTP ${res.status})`);
    }
    if (useAsync && (data as { viaJobService?: boolean } | null)?.viaJobService) {
      // sheet with an `id` column: handled by the job service (updates by ID)
      setUploadJob({ status: "RUNNING", phase: "CHECKING", processed: 0, total: 0, created: 0, failed: 0 });
      return pollJobService((data as { jobId: string }).jobId, 0);
    }
    if (useAsync && (data as { async?: boolean } | null)?.async) {
      const jobId = (data as { jobId: string }).jobId;
      setUploadJob({ status: "RUNNING", phase: "QUEUED", processed: 0, total: 0, created: 0, failed: 0 });
      const result = await pollUploadJob(jobId);
      return { result: { ...result, uploadBatchId: result.uploadBatchId ?? jobId }, rejectedUrl: `${API_BASE}/bank/admin/upload/jobs/${jobId}/rejected` };
    }
    return { result: data as UploadResult, rejectedUrl: null };
  }

  // One file or many: files go one after another (a later file sees the questions of the earlier ones, so duplicates
  // between files are found too). One bad file never stops the others.
  async function submitUpload(kind: UploadKind) {
    if (uploadFiles.length === 0) {
      setError("Please select a file first (Excel / CSV / JSON / Text / Word)");
      return;
    }
    const files = uploadFiles.slice();
    setUploading(true);
    setError("");
    setInfo("");
    setUploadResult(null);
    setUploadJob(null);
    setRejectedUrl(null);
    setRejectedList([]);
    const statuses = files.map((f) => ({ name: f.name, state: "wait" as "wait" | "run" | "done" | "fail", text: "" }));
    setFileStatuses(statuses.slice());
    const setSt = (i: number, state: "wait" | "run" | "done" | "fail", text = "") => {
      statuses[i] = { ...statuses[i], state, text };
      setFileStatuses(statuses.slice());
    };
    const merged: UploadResult = { success: true, total: 0, created: 0, failed: 0, errors: [], warnings: [], errorSummary: {}, queuedForReview: 0, queuedExact: 0, reviewAlready: 0, unaccounted: 0 };
    const rejects: { name: string; url: string }[] = [];
    const batchIds: string[] = [];
    const multi = files.length > 1;
    let failedFiles = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setSt(i, "run", "running…");
        setUploadJob(null);
        try {
          const { result, rejectedUrl: rj } = await uploadOneFile(file, kind);
          merged.total += result.total ?? 0;
          merged.created += result.created ?? 0;
          merged.failed += result.failed ?? 0;
          merged.queuedForReview = (merged.queuedForReview ?? 0) + (result.queuedForReview ?? 0);
          merged.updated = (merged.updated ?? 0) + (result.updated ?? 0);
          merged.unchanged = (merged.unchanged ?? 0) + (result.unchanged ?? 0);
          merged.pyqRows = (merged.pyqRows ?? 0) + (result.pyqRows ?? 0);
          merged.practiceRows = (merged.practiceRows ?? 0) + (result.practiceRows ?? 0);
          merged.pyqWithoutQuestionNo = (merged.pyqWithoutQuestionNo ?? 0) + (result.pyqWithoutQuestionNo ?? 0);
          if (result.papers?.length) merged.papers = [...(merged.papers ?? []), ...result.papers];
          if (result.pending?.length) merged.pending = [...(merged.pending ?? []), ...result.pending].slice(0, 200);
          merged.pendingTotal = (merged.pendingTotal ?? 0) + (result.pendingTotal ?? 0);
          if (result.practicePlan?.length) merged.practicePlan = [...(merged.practicePlan ?? []), ...result.practicePlan];
          if (result.practicePlanTruncated) merged.practicePlanTruncated = true;
          if (result.unknownExams?.length) merged.unknownExams = [...(merged.unknownExams ?? []), ...result.unknownExams];
          if (result.hindiMissingRows?.length) merged.hindiMissingRows = [...(merged.hindiMissingRows ?? []), ...result.hindiMissingRows];
          if (result.preview?.length) merged.preview = [...(merged.preview ?? []), ...result.preview].slice(0, 300);
          merged.queuedExact = (merged.queuedExact ?? 0) + (result.queuedExact ?? 0);
          merged.reviewAlready = (merged.reviewAlready ?? 0) + (result.reviewAlready ?? 0);
          merged.unaccounted = (merged.unaccounted ?? 0) + (result.unaccounted ?? 0);
          if (result.errorsTruncated) merged.errorsTruncated = true;
          for (const [k, v] of Object.entries(result.errorSummary ?? {})) merged.errorSummary![k] = (merged.errorSummary![k] ?? 0) + v;
          if (!result.errorSummary) for (const e of result.errors ?? []) merged.errorSummary![e.category] = (merged.errorSummary![e.category] ?? 0) + 1;
          for (const e of result.errors ?? []) merged.errors.push(multi ? { ...e, file: file.name } : e);
          for (const w of result.warnings ?? []) merged.warnings.push(multi ? { ...w, file: file.name } : w);
          if (rj && (result.errors?.length ?? 0) > 0) rejects.push({ name: file.name, url: rj });
          if (result.uploadBatchId && !checkOnly) batchIds.push(result.uploadBatchId);
          setSt(i, "done", `${result.created ?? 0} upload · ${result.failed ?? 0} fail · ${result.queuedForReview ?? 0} duplicate review me`);
        } catch (err) {
          failedFiles++;
          const msg = err instanceof Error ? err.message : "Upload failed";
          merged.errors.push({ row: 0, error: msg, category: "OTHER", questionPreview: `(whole file: ${file.name})`, field: "file", fix: "Check the file format, header row and size, then upload only this file again.", file: file.name });
          merged.errorSummary!.OTHER = (merged.errorSummary!.OTHER ?? 0) + 1;
          setSt(i, "fail", msg);
        }
      }
      merged.success = merged.failed === 0 && failedFiles === 0;
      setUploadResult(merged);
      setRejectedList(rejects);
      if (rejects.length === 1) setRejectedUrl(rejects[0].url);
      loadBatches(); // Phase 3 — refresh history so this upload shows up immediately
      if (merged.created > 0) {
        setInfo(`${merged.created} ${kind === "practice" ? "Practice" : kind === "mixed" ? "PYQ + Practice" : "PYQ"} question(s) uploaded${multi ? ` (${files.length - failedFiles}/${files.length} files)` : ""}`);
      }
      if (failedFiles > 0) setError(`${failedFiles} file(s) failed — see the file-wise reason and error list below.`);
      // one click: every duplicate -> keep the NEW one, then publish everything of these uploads
      if (autoLatest && !checkOnly && batchIds.length > 0 && ((merged.queuedForReview ?? 0) > 0 || merged.created > 0)) {
        await latestAndPublish(batchIds);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      setUploadJob(null);
    }
  }

  // Duplicates of these uploads: keep the NEW (latest) question, hide the old one, publish — then publish the rest of the batch.
  async function latestAndPublish(batchIds: string[]) {
    let kept = 0;
    let failed = 0;
    let published = 0;
    let firstErr = "";
    try {
      for (const batchId of batchIds) {
        const skipIds: string[] = [];
        for (let round = 0; round < 500; round++) {
          setInfo(`Keeping the newer question in duplicates… ${kept} done`);
          const r = await fetchAuth(`${API_BASE}/bank/admin/duplicates/bulk-resolve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "KEEP_NEW", confirm: true, batchId, publish: true, skipIds }),
          });
          const d = await r.json().catch(() => null);
          if (!r.ok) throw new Error(Array.isArray(d?.message) ? d.message.join("; ") : d?.message || `HTTP ${r.status}`);
          kept += d.done ?? 0;
          failed += d.failed ?? 0;
          if (!firstErr && d.errors?.[0]?.error) firstErr = d.errors[0].error;
          if (Array.isArray(d.failedIds)) skipIds.push(...d.failedIds);
          if (!d.remaining || (d.done ?? 0) === 0) break;
        }
        const pr = await fetchAuth(`${API_BASE}/bank/admin/upload/batches/${batchId}/publish`, { method: "POST" });
        const pd = await pr.json().catch(() => ({}));
        if (pr.ok) published += pd.published ?? 0;
      }
      setInfo(`✅ Kept the newer question in ${kept} duplicate(s); published ${published} other pending question(s)${failed ? ` · ⚠️ ${failed} duplicate(s) failed (${firstErr})` : ""}.`);
    } catch (e) {
      setError(`Auto keep-newer / publish stopped: ${e instanceof Error ? e.message : "error"}. You can finish the rest in one click from the Duplicate Review page.`);
    } finally {
      loadBatches();
    }
  }

  // JSON upload as a background job (images/SVG inside the JSON make it slow, so never one long request).
  async function submitJsonJob(kind: UploadKind, file: File): Promise<{ result: UploadResult; rejectedUrl: string | null }> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    fd.append("requireSolution", String(requireSolution));
    fd.append("dryRun", String(checkOnly));
    const res = await fetchAuth(`${API_BASE}/bank/admin/upload/job/start`, { method: "POST", body: fd });
    const started = await res.json().catch(() => null);
    if (!res.ok) throw new Error(started?.message || `Upload failed (HTTP ${res.status})`);
    return pollJobService(started.id, started.total);
  }

  async function pollJobService(jobId: string, total: number): Promise<{ result: UploadResult; rejectedUrl: string | null }> {
    const started = { id: jobId, total };
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
        if (++netFails >= 20) throw new Error("Progress check is failing. The upload is probably still running on the server — check Upload History in a few minutes.");
        continue;
      }
      setUploadJob({ status: j.status, phase: j.status === "DONE" ? "FINALIZING" : "SAVING", processed: j.processed, total: j.total, created: j.created, failed: j.failed });
      if (j.status === "FAILED") throw new Error(j.fatalError || "Upload failed");
      if (j.status === "DONE") {
        const result = { success: j.failed === 0, total: j.total, created: j.created, failed: j.failed, errors: j.errors ?? [], warnings: j.warnings ?? [], queuedForReview: j.queuedForReview, queuedExact: j.queuedExact, reviewAlready: j.reviewAlready, unaccounted: j.unaccounted, uploadBatchId: j.uploadBatchId, updated: j.updated, unchanged: j.unchanged, preview: j.preview, papers: j.papers, pending: j.pending, pendingTotal: j.pendingTotal, pyqRows: j.pyqRows, practiceRows: j.practiceRows, pyqWithoutQuestionNo: j.pyqWithoutQuestionNo, practicePlan: j.practicePlan, practicePlanTruncated: j.practicePlanTruncated, unknownExams: j.unknownExams, hindiMissingRows: j.hindiMissingRows } as UploadResult;
        if (checkOnly) setInfo(`Check only (nothing was saved): ${j.created} new, ${j.updated ?? 0} would be updated, ${j.unchanged ?? 0} unchanged, ${j.failed} rejected.`);
        return { result, rejectedUrl: j.hasRejected ? `${API_BASE}/bank/admin/upload/job/${started.id}/rejected` : null };
      }
    }
  }

  async function downloadRejectedRows(urlArg?: string, nameArg?: string) {
    const target = urlArg ?? rejectedUrl;
    if (!target) return;
    try {
      const r = await fetchAuth(target);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rejected_${(nameArg ?? "rows").replace(/\.[a-z0-9]+$/i, "")}_${new Date().toISOString().slice(0, 10)}.${blob.type.includes("json") ? "json" : "xlsx"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download the rejected rows file");
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
          if (r.status === 404 || r.status === 403) throw new Error(j?.message || "Upload job not found — check Upload History.");
          throw new Error(j?.message || `HTTP ${r.status}`);
        }
        misses = 0;
        if (!j) continue;
        setUploadJob(j);
        if (j.status === "DONE" && j.result) return j.result;
        if (j.status === "FAILED") throw new Error(j.error || "Upload failed");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (/job not found|job nahi mila|Upload fail|Excel|CSV|column|Missing/i.test(msg) || ++misses > 30) throw e;
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
      ["File", "Row", "Category", "Problem Column", "Question Preview", "Error", "How to fix"].map(escapeCsv).join(","),
      ...result.errors.map((e) =>
        [e.file ?? "", String(e.row), CATEGORY_LABEL[e.category] ?? e.category, e.field ?? "", e.questionPreview ?? "", e.error, e.fix ?? ""]
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
      setBatchesErr(e instanceof Error ? e.message : "Could not load Upload History");
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
      setInfo(`${d.published ?? 0} question(s) published.`);
      await loadBatches();
      if (expandedBatchId === id) toggleBatchDetail(id).then(() => toggleBatchDetail(id));
    } catch (e) {
      setBatchesErr(e instanceof Error ? e.message : "Could not publish");
    }
  }

  async function bulkBatchAction(action: "publish" | "unpublish") {
    const ids = Array.from(selectedBatchIds);
    if (ids.length === 0) return;
    const msg =
      action === "publish"
        ? `Publish (make live) all pending questions of ${ids.length} upload(s)?`
        : `Unpublish all live questions of ${ids.length} upload(s)? Students will stop seeing them (nothing is deleted; you can publish again).`;
    if (!confirm(msg)) return;
    setBulkBatchBusy(true);
    setBatchesErr("");
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/upload/batches-bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setBatchesErr(Array.isArray(d?.message) ? d.message.join("; ") : d?.message || `HTTP ${r.status}`);
        return;
      }
      setInfo(`${d.questions ?? 0} question(s) ${action === "publish" ? "published" : "unpublished"} (${d.done}/${d.uploads} uploads)${d.failed ? ` · ${d.failed} failed: ${d.errors?.[0]?.error ?? ""}` : ""}.`);
      setSelectedBatchIds(new Set());
      await loadBatches();
    } catch (e) {
      setBatchesErr(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBulkBatchBusy(false);
    }
  }

  async function unpublishBatchHandler(id: string) {
    if (!confirm("Unpublish the live questions of this upload? (students stop seeing them; nothing is deleted)")) return;
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/upload/batches/${id}/unpublish`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setBatchesErr(d?.message || `HTTP ${r.status}`);
        return;
      }
      setInfo(`${d.unpublished ?? 0} question(s) unpublished.`);
      await loadBatches();
    } catch (e) {
      setBatchesErr(e instanceof Error ? e.message : "Could not unpublish");
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
      setBatchesErr(e instanceof Error ? e.message : "Could not download");
    }
  }

  async function deleteBatchScopedHandler(
    batchId: string,
    row: { subjectId: string; chapterId: string | null; topicId: string | null; subTopicId: string | null; total: number },
  ) {
    if (!confirm(`PERMANENTLY delete ${row.total} question(s) from this part?`)) return;
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
      setInfo(`${d.deletedQuestions ?? 0} question(s) deleted.`);
      await loadBatches();
      setExpandedBatchId(null);
      setExpandedBatchDetail(null);
    } catch (e) {
      setBatchesErr(e instanceof Error ? e.message : "Could not delete");
    }
  }

  async function deleteBatchHandler(id: string, filename: string | null) {
    if (
      !confirm(
        `All questions of "${filename || "this upload"}" will be PERMANENTLY deleted. If you only want to keep the history record, press Cancel and use the "Keep Questions" option. Continue?`,
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
      setInfo(`${d.deletedQuestions ?? 0} question(s) deleted from this upload.`);
      if (expandedBatchId === id) {
        setExpandedBatchId(null);
        setExpandedBatchDetail(null);
      }
      await loadBatches();
    } catch (e) {
      setBatchesErr(e instanceof Error ? e.message : "Could not delete");
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
      ["Row", "Category", "Problem Column", "Question Preview", "Error", "How to fix"].map(escapeCsv).join(","),
      ...errors.map((e) =>
        [String(e.row), CATEGORY_LABEL[e.category] ?? e.category, e.field ?? "", e.questionPreview ?? "", e.error, e.fix ?? ""]
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
    loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, roleFilter, statusFilter, access.isAdmin]);

  return (
    <div className="min-h-screen bg-background">

      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">{access.isAdmin ? "Plans & Bulk Upload" : "Staff Workspace"}</h1>
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
            <p className="font-semibold">Your access:</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {access.permissions.length === 0 && (
                <span className="text-muted-foreground">No department is assigned to you yet — please contact the admin.</span>
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
            <p className="mb-1 font-semibold text-foreground">How to upload (step by step):</p>
            <ol className="list-decimal space-y-1 pl-4">
              <li>First use "Download Full Question Bank" to see which questions already exist, so you do not type them again (duplicates are rejected automatically during upload).</li>
              <li>Select a format and download its template. The Excel template also has a "Reference IDs" sheet with the real ID of every exam / subject / chapter / topic that you can copy and paste.</li>
              <li>You can fill everything in one file — question, options (A–D), correctAnswer, explanation, Hindi translation, year, shift and paperCode, all in the same columns.</li>
              <li>Always fill the Hindi translation (questionTextHindi). Without it the question is saved but students will NOT see it (bilingual gate) until a translation is added.</li>
              <li>Once a year is filled in, the question automatically counts in both the Year-wise PYQ Test and sectional practice — no extra step.</li>
              <li>Select the format, choose your file and press "Upload Questions". The result shows how many were created, failed or were duplicates.</li>
            </ol>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Select a format, download the template, fill in your questions (answer, explanation and Hindi translation included) and upload it back.
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
            🧩 Need chapter IDs before uploading? Manage Chapters →
          </a>
          <a
            href="/admin/coverage"
            className="mb-3 ml-2 inline-block rounded-lg border border-danger/40 bg-danger/5 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10"
          >
            🕳️ Which topic / sub-topic has no questions? Coverage / Gap Finder →
          </a>
          <a
            href="/admin/questions/duplicates"
            className="mb-3 ml-2 inline-block rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
          >
            🧬 Duplicate Review — keep one of the same question, or both →
          </a>
          <a
            href="/admin/questions/manage"
            className="mb-3 ml-2 inline-block rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
          >
            🗂️ Move questions between chapters / topics / sub-topics, publish or delete them — Question Manager →
          </a>
          {access.isAdmin && (
          <a
            href="/admin/pyq-dates"
            className="mb-3 ml-2 inline-block rounded-lg border border-blue-500/40 bg-blue-500/5 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-500/10 dark:text-blue-400"
          >
            📅 PYQ ki exam date + Tier 1/2 khud daalein — Date Mapping →
          </a>
          )}
          {access.isAdmin && (
          <a
            href="/admin/pyq-papers"
            className="mb-3 ml-2 inline-block rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
          >
            🗓️ Date-wise + tier-wise PYQ papers — progress, rebuild, publish now →
          </a>
          )}
          {access.isAdmin && (
          <a
            href="/admin/patterns"
            className="mb-3 ml-2 inline-block rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
          >
            ⏱️ Exam Patterns — sections, strict sectional timer, mocks se link →
          </a>
          )}
          <a
            href="/admin/pyq-export"
            className="mb-3 ml-2 inline-block rounded-lg border border-teal-500/40 bg-teal-500/5 px-3 py-1.5 text-xs font-medium text-teal-600 hover:bg-teal-500/10 dark:text-teal-400"
          >
            📥 PYQ chapter-wise / subject-wise / exam-wise Excel download →
          </a>
          </>)}
          {access.can("VOCABULARY") && (
          <a
            href="/admin/vocab"
            className="mb-3 ml-2 inline-block rounded-lg border border-purple-500/40 bg-purple-500/5 px-3 py-1.5 text-xs font-medium text-purple-600 hover:bg-purple-500/10 dark:text-purple-400"
          >
            📖 Upload vocabulary words + questions from Excel — Manage Vocabulary →
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
            <input name="qno" inputMode="search" placeholder="Question number (e.g. 1042) — opens it directly for editing" className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" />
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
              onClick={downloadPracticeTemplate}
              disabled={templateDownloading}
              className="rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-semibold hover:bg-primary/20 disabled:opacity-50"
              title="Practice-question Excel with dropdowns, hints and examples"
            >
              ⭐ Practice Excel Template (dropdown)
            </button>
            <button
              onClick={downloadMixedTemplate}
              disabled={templateDownloading}
              className="rounded-lg border border-violet-500/50 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold hover:bg-violet-500/20 disabled:opacity-50"
              title="One Excel for date-wise PYQ rows AND practice rows (34 columns, dropdowns, examples)"
            >
              🧩 PYQ + Practice Excel Template (ek file)
            </button>
            <button
              onClick={downloadBankExport}
              disabled={bankExportDownloading}
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-400"
              title="Download the whole question bank in this upload format — see what already exists"
            >
              {bankExportDownloading ? "Exporting..." : "Download Full Question Bank"}
            </button>
            <button
              onClick={() => downloadGapsExport()}
              disabled={gapsExportDownloading}
              className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
              title="Only questions whose Hindi translation, solution or answer key is missing — both PYQ and Practice"
            >
              {gapsExportDownloading ? "Exporting..." : "⬇️ Download Gaps (Missing Hindi/Solution/Answer)"}
            </button>
          </div>
          <p className="mb-3 -mt-1 text-xs text-muted-foreground">
            💡 For a very large number of questions (10,000 to 100,000) <b>CSV</b> is the fastest (save as UTF-8). Excel also works up to about 25,000–30,000 rows.
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
              <label className="mb-1.5 block text-sm font-medium">Question file(s) — you can choose one or several files at once</label>
              <input
                type="file"
                multiple
                accept=".xlsx,.xls,.csv,.json,.txt,.docx"
                onChange={(e) => { setUploadFiles(Array.from(e.target.files ?? [])); setFileStatuses([]); }}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
              {uploadFiles.length > 1 && (
                <p className="mt-1 text-xs text-muted-foreground">{uploadFiles.length} files selected — they are uploaded one after another (each file's format is detected from its extension).</p>
              )}
            </div>
          </div>

          {/* NEW (Sep 21 2026) — two large, unmistakably separate upload buttons
              instead of one button + a checkbox that was easy to forget. */}
          <label className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-muted/20 p-3 text-sm">
            <input type="checkbox" className="mt-1" checked={requireSolution} onChange={(e) => setRequireSolution(e.target.checked)} />
            <span>
              Do not upload questions without a solution (they appear in the report as "missing solution")
              <span className="block text-xs text-muted-foreground">Questions with a missing answer key, an empty option, or duplicates are always rejected and shown in the report.</span>
            </span>
          </label>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={checkOnly} onChange={(e) => setCheckOnly(e.target.checked)} />
            Check only — do not save anything (to see the report first)
          </label>
          <label className="mt-2 flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
            <input type="checkbox" className="mt-1" checked={autoLatest} onChange={(e) => setAutoLatest(e.target.checked)} />
            <span>
              ⚡ After upload, automatically <b>keep the newer question</b> in duplicates (the old one is hidden) and <b>Publish</b> everything
              <span className="block text-xs text-muted-foreground">If you turn this off, duplicates go to Duplicate Review, where "keep all newer + publish" is also one click.</span>
            </span>
          </label>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <button
              onClick={() => submitUpload("mixed")}
              disabled={uploading || !uploadFile || !access.can("QUESTIONS") || !access.can("PRACTICE")}
              title={access.can("QUESTIONS") && access.can("PRACTICE") ? undefined : "Needs both PYQ and Practice upload access"}
              className="flex flex-col items-center gap-1 rounded-xl border-2 border-violet-500 bg-violet-500/10 px-4 py-5 text-center font-semibold text-violet-700 transition hover:bg-violet-500/20 disabled:opacity-50 sm:col-span-2 dark:text-violet-400"
            >
              <span className="text-lg">🧩 Upload PYQ + PRACTICE (ek Excel)</span>
              <span className="text-xs font-normal opacity-80">
                Row me year / examDate hai to PYQ (date-wise mock me judega), nahi hai to Practice. Practice row ka shift / date / questionNo apne aap hat jata hai. Pehle &quot;Check only&quot; se plan dekhein.
              </span>
            </button>
            <button
              onClick={() => submitUpload("practice")}
              disabled={uploading || !uploadFile || !access.can("PRACTICE")}
              title={access.can("PRACTICE") ? undefined : "You do not have access to Practice upload"}
              className="flex flex-col items-center gap-1 rounded-xl border-2 border-emerald-500 bg-emerald-500/10 px-4 py-5 text-center font-semibold text-emerald-700 transition hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-400"
            >
              <span className="text-lg">📗 Upload PRACTICE Questions</span>
              <span className="text-xs font-normal opacity-80">
                Year/shift/paper-code ignored even if sheet has them. They appear only on Practice screens (chapter / topic / sub-topic) — NOT in the Year-wise PYQ test.
              </span>
            </button>
            <button
              onClick={() => submitUpload("pyq")}
              disabled={uploading || !uploadFile || !access.can("QUESTIONS")}
              title={access.can("QUESTIONS") ? undefined : "You do not have access to PYQ upload"}
              className="flex flex-col items-center gap-1 rounded-xl border-2 border-sky-500 bg-sky-500/10 px-4 py-5 text-center font-semibold text-sky-700 transition hover:bg-sky-500/20 disabled:opacity-50 dark:text-sky-400"
            >
              <span className="text-lg">📘 Upload PYQ Questions</span>
              <span className="text-xs font-normal opacity-80">
                Every row needs a 'year'. These questions appear in the Year-wise PYQ Test and chapter-wise PYQ — NOT on Practice screens.
              </span>
            </button>
          </div>
          {uploading && !uploadJob && <p className="mt-2 text-sm text-muted-foreground">Uploading file...</p>}
          {fileStatuses.length > 1 && (
            <ul className="mt-3 space-y-1 rounded-lg border border-border bg-background p-3 text-xs">
              {fileStatuses.map((f, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <span>{f.state === "done" ? "✅" : f.state === "fail" ? "❌" : f.state === "run" ? "⏳" : "🕒"}</span>
                  <span className="font-medium">{f.name}</span>
                  {f.text && <span className={f.state === "fail" ? "text-red-600" : "text-muted-foreground"}>{f.text}</span>}
                </li>
              ))}
            </ul>
          )}
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
              <p className="mt-1 text-xs text-muted-foreground">Large files take a few minutes — keep this page open. The import keeps running on the server.</p>
            </div>
          )}

          {uploadResult && (
            <div className="mt-4 rounded-lg border border-border bg-background p-3 text-sm">
              <div className="flex flex-wrap items-center gap-4">
                <span>Total: <strong>{uploadResult.total}</strong></span>
                <span className="text-emerald-600 dark:text-emerald-400">Created: <strong>{uploadResult.created}</strong></span>
                {(uploadResult.updated ?? 0) > 0 && <span className="text-sky-600 dark:text-sky-400">{checkOnly ? "Update hongi" : "Updated"}: <strong>{uploadResult.updated}</strong></span>}
                {(uploadResult.unchanged ?? 0) > 0 && <span className="text-muted-foreground">Jaisi thi waisi: <strong>{uploadResult.unchanged}</strong></span>}
                <span className="text-red-600 dark:text-red-400">Failed: <strong>{uploadResult.failed}</strong></span>
                {uploadResult.uploadBatchId && !checkOnly && (
                  <a href="/admin/questions/manage" className="rounded-lg border border-border px-2 py-1 text-xs font-semibold hover:bg-muted">📋 View questions</a>
                )}
                {(uploadResult.reviewAlready ?? 0) > 0 && (
                  <span className="text-xs text-muted-foreground" title="Already in Duplicate Review, or you had already decided to keep the old one">+{uploadResult.reviewAlready} already in review / skipped</span>
                )}
                {((uploadResult.pyqRows ?? 0) > 0 || (uploadResult.practiceRows ?? 0) > 0) && (
                  <div className="w-full rounded-lg border border-violet-500/30 bg-violet-500/5 p-2 text-xs">
                    <p className="font-semibold text-violet-700 dark:text-violet-400">
                      🧩 PYQ rows: {uploadResult.pyqRows ?? 0} · Practice rows: {uploadResult.practiceRows ?? 0}
                      {(uploadResult.pyqWithoutQuestionNo ?? 0) > 0 ? ` · ${uploadResult.pyqWithoutQuestionNo} PYQ row(s) without questionNo (upload order)` : ""}
                    </p>
                  </div>
                )}
                {(uploadResult.unknownExams?.length ?? 0) > 0 && (
                  <div className="w-full rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-800 dark:text-red-300">
                    <p className="font-semibold">❌ Ye exam database me nahi hai — pehle banayein:</p>
                    <ul className="mt-1 space-y-0.5">
                      {uploadResult.unknownExams!.map((u, i) => (
                        <li key={i}>{u.value ? <code>{u.value}</code> : "(examId khali)"} — {u.count} row(s), pehli row {u.rows[0]}</li>
                      ))}
                    </ul>
                    <a href="/admin/exams" className="mt-1 inline-block text-primary underline">Admin → Exams (Add common exams button) →</a>
                  </div>
                )}
                {(uploadResult.hindiMissingRows?.length ?? 0) > 0 && (
                  <div className="w-full rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
                    ⚠️ {uploadResult.hindiMissingRows!.length} row(s) me Hindi question nahi hai — students ko tab tak nahi dikhenge (rows: {uploadResult.hindiMissingRows!.slice(0, 15).join(", ")}{uploadResult.hindiMissingRows!.length > 15 ? " …" : ""}).
                  </div>
                )}
                {(uploadResult.practicePlan?.length ?? 0) > 0 && (
                  <details className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs" open>
                    <summary className="cursor-pointer font-semibold text-emerald-700 dark:text-emerald-400">📚 Practice plan — har topic / sub-topic me kitne ({uploadResult.practicePlan![0].target} ka target)</summary>
                    <div className="mt-2 overflow-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="text-muted-foreground"><th className="pr-2">Chapter</th><th className="pr-2">Topic</th><th className="pr-2">Sub-topic</th><th className="pr-2">File me</th><th className="pr-2">Pehle se</th><th className="pr-2">Baad me</th><th className="pr-2">Kam</th><th></th></tr>
                        </thead>
                        <tbody>
                          {uploadResult.practicePlan!.map((p, i) => (
                            <tr key={i} className="border-t border-border/50">
                              <td className="pr-2">{p.chapter}</td>
                              <td className="pr-2">{p.topic || "—"}{p.topicNew ? " 🆕" : ""}</td>
                              <td className="pr-2">{p.subTopic || "—"}{p.subTopicNew ? " 🆕" : ""}</td>
                              <td className="pr-2">{p.count}</td>
                              <td className="pr-2">{p.existing}</td>
                              <td className="pr-2 font-semibold">{p.after}</td>
                              <td className={`pr-2 ${p.missing > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-600"}`}>{p.missing > 0 ? p.missing : "✓"}</td>
                              <td>
                                {p.chapterId && (
                                  <a
                                    href={`/admin/questions/manage?${new URLSearchParams({ ...(p.subjectId ? { subject: p.subjectId } : {}), chapter: p.chapterId, ...(p.topicId ? { topic: p.topicId } : {}), ...(p.subTopicId ? { subtopic: p.subTopicId } : {}) }).toString()}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-primary underline"
                                  >
                                    👁 pehle se
                                  </a>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {uploadResult.practicePlanTruncated && <p className="mt-1 text-muted-foreground">Sirf pehli rows dikhayi gayi hain.</p>}
                    </div>
                  </details>
                )}
                {(uploadResult.papers?.length ?? 0) > 0 && (
                  <div className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs">
                    <p className="font-semibold text-emerald-700 dark:text-emerald-400">🗓️ Ye file {uploadResult.papers!.length} real paper me judegi:</p>
                    <ul className="mt-1 space-y-0.5">
                      {uploadResult.papers!.slice(0, 30).map((p) => (
                        <li key={p.key}>{isoToDmy(p.examDate)} · {p.examTier === "TIER_2" ? "Tier 2" : "Tier 1"}{p.tierPaper !== "PAPER_1" ? ` · ${p.tierPaper.replace("PAPER_", "Paper ")}` : ""}{p.shift ? ` · ${p.shift}` : ""} — <strong>{p.rows}</strong> rows</li>
                      ))}
                    </ul>
                    <a href="/admin/pyq-papers" className="mt-1 inline-block text-primary underline">View paper progress →</a>
                  </div>
                )}
                {(uploadResult.pendingTotal ?? 0) > 0 && (
                  <div className="w-full rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
                    <p className="font-semibold">⚠️ {uploadResult.pendingTotal} row(s) will not be added to any date-wise mock (fix the tier / date):</p>
                    <ul className="mt-1 max-h-32 space-y-0.5 overflow-auto">
                      {(uploadResult.pending ?? []).slice(0, 30).map((p, i) => <li key={i}>Row {p.row}: {p.message.split(" / ")[0]}</li>)}
                    </ul>
                  </div>
                )}
                {(uploadResult.unaccounted ?? 0) > 0 && (
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">⚠️ {uploadResult.unaccounted} row(s) unaccounted for</span>
                )}
                {(uploadResult.queuedForReview ?? 0) > 0 && (
                  <a href="/admin/questions/duplicates" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
                    🧬 {uploadResult.queuedForReview} duplicate(s) sent to Review{(uploadResult.queuedExact ?? 0) > 0 ? ` (${uploadResult.queuedExact} exact same)` : ""} — open to keep the old, the new, or both →
                  </a>
                )}
                {(uploadResult.preview?.length ?? 0) > 0 && (
                  <details className="w-full rounded-lg border border-border p-2 text-xs" open={checkOnly}>
                    <summary className="cursor-pointer font-semibold">👁 Preview — what will happen row by row (first {uploadResult.preview!.length})</summary>
                    <div className="mt-2 max-h-64 overflow-auto">
                      {uploadResult.preview!.map((p) => (
                        <div key={`${p.action}-${p.row}`} className="border-b border-border/50 py-1">
                          <span className={p.action === "NEW" ? "text-emerald-600" : p.action === "UPDATE" ? "text-sky-600" : "text-muted-foreground"}>
                            {p.action === "NEW" ? "➕ Naya" : p.action === "UPDATE" ? "✏️ Update" : "＝ Same"}
                          </span>{" "}
                          row {p.row}{p.changes?.length ? ` · badlega: ${p.changes.join(", ")}` : ""}{p.text ? ` · ${p.text}` : ""}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {uploadResult.errorsTruncated && (
                  <span className="w-full text-xs text-amber-600">
                    ⚠️ Total {uploadResult.failed.toLocaleString()} rows failed — only the first {uploadResult.errors.length.toLocaleString()} are listed here. Fix these first and upload again.
                  </span>
                )}
                {/* NEW: one-click download of the full error report as CSV
                    — row, category, question preview, exact error message
                    — so the admin can open it next to their spreadsheet
                    and fix every failed row without scrolling this panel. */}
                {rejectedList.length > 1 && rejectedList.map((r) => (
                  <button
                    key={r.url}
                    onClick={() => downloadRejectedRows(r.url, r.name)}
                    className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400"
                  >
                    📄 Rejected: {r.name}
                  </button>
                ))}
                {rejectedUrl && rejectedList.length <= 1 && uploadResult.errors.length > 0 && (
                  <button
                    onClick={() => downloadRejectedRows()}
                    className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400"
                  >
                    📄 Rejected rows file (fix and upload again)
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
                          {e.file && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground">📄 {e.file}</span>}
                          <span className="font-semibold text-foreground">{e.row > 0 ? `Row ${e.row}` : "Whole file"}</span>
                          <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                            {CATEGORY_LABEL[e.category] ?? e.category}
                          </span>
                          {e.field && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">Column: {e.field}</span>}
                        </div>
                        {e.questionPreview && (
                          <div className="mt-0.5 italic text-foreground/80">"{e.questionPreview}"</div>
                        )}
                        <div className="mt-0.5">❌ {e.error}</div>
                        {e.fix && <div className="mt-0.5 text-emerald-700 dark:text-emerald-400">🛠️ How to fix: {e.fix}</div>}
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
                        {w.file && <span className="mr-1 rounded bg-muted px-1.5 py-0.5 text-[10px]">📄 {w.file}</span>}
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
            <p className="mt-2 text-sm text-muted-foreground">No uploads yet.</p>
          )}
          {batches.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2 text-xs">
              <label className="flex items-center gap-1 font-semibold">
                <input
                  type="checkbox"
                  checked={batches.length > 0 && batches.every((b) => selectedBatchIds.has(b.id))}
                  onChange={(e) => setSelectedBatchIds(e.target.checked ? new Set(batches.map((b) => b.id)) : new Set())}
                />
                Select all ({batches.length})
              </label>
              <span className="text-muted-foreground">{selectedBatchIds.size} selected</span>
              <div className="ml-auto flex flex-wrap gap-1.5">
                <button
                  disabled={bulkBatchBusy || selectedBatchIds.size === 0}
                  onClick={() => bulkBatchAction("publish")}
                  className="rounded border border-emerald-500/50 bg-emerald-500/10 px-2 py-1 font-semibold text-emerald-700 disabled:opacity-40 dark:text-emerald-400"
                >
                  ✅ Selected: Publish
                </button>
                <button
                  disabled={bulkBatchBusy || selectedBatchIds.size === 0}
                  onClick={() => bulkBatchAction("unpublish")}
                  className="rounded border border-amber-500/50 bg-amber-500/10 px-2 py-1 font-semibold text-amber-700 disabled:opacity-40 dark:text-amber-400"
                  title="Published by mistake? Move back to Pending (students will not see them)"
                >
                  ↩️ Selected: Unpublish (undo)
                </button>
              </div>
            </div>
          )}
          {batches.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2"></th>
                    <th className="px-3 py-2">Kab</th>
                    <th className="px-3 py-2">File</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Uploaded</th>
                    <th className="px-3 py-2 text-right">Failed</th>
                    <th className="px-3 py-2 text-right">Duplicate review</th>
                    <th className="px-3 py-2">Ab Live/Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <React.Fragment key={b.id}>
                      <tr className="border-b border-border last:border-0">
                        <td className="px-2 py-2">
                          <input
                            type="checkbox"
                            checked={selectedBatchIds.has(b.id)}
                            onChange={() => setSelectedBatchIds((prev) => { const n = new Set(prev); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n; })}
                          />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                          {new Date(b.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="max-w-[260px] break-words px-3 py-2 font-medium" title={b.filename ?? ""}>{b.filename || "—"}</td>
                        <td className="px-3 py-2 text-xs">{b.sourceType}</td>
                        <td className="px-3 py-2 text-xs">
                          {(b.status ?? "DONE") === "RUNNING" ? (
                            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 font-semibold text-sky-600 dark:text-sky-400" title="Upload is running — it continues on the server even if you close this page">
                              ⏳ Running {b.totalRows > 0 ? `${Math.min(100, Math.round(((b.createdCount + b.failedCount + (b.queuedCount ?? 0)) / b.totalRows) * 100))}%` : ""}
                            </span>
                          ) : b.status === "FAILED" ? (
                            <span className="rounded-full bg-red-500/15 px-2 py-0.5 font-semibold text-red-600" title={b.errorMessage ?? ""}>❌ Fail</span>
                          ) : b.status === "INTERRUPTED" ? (
                            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-400" title="Stopped midway because of a server restart or an error. Questions already saved are counted under Uploaded; upload the file again for the rest (duplicates automatically go to review).">⚠️ Stopped midway{(b.pendingRows ?? 0) > 0 ? ` (${b.pendingRows} left)` : ""}</span>
                          ) : (
                            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-600 dark:text-emerald-400">✅ Complete</span>
                          )}
                          {(b.status ?? "DONE") === "DONE" && (b.pendingRows ?? 0) > 0 && (
                            <span className="mt-1 block text-[10px] font-medium text-amber-700 dark:text-amber-400" title="Total should equal Uploaded + Failed + Duplicate review + Skipped. Some rows of this file are unaccounted for — try uploading the file again.">
                              ⚠️ {b.pendingRows} row(s) unaccounted for
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">{b.totalRows}</td>
                        <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400">{b.createdCount}</td>
                        <td className="px-3 py-2 text-right text-red-600 dark:text-red-400">{b.failedCount}</td>
                        <td className="px-3 py-2 text-right">
                          {(b.queuedCount ?? 0) > 0 ? (
                            <a href={`/admin/questions/duplicates?batch=${b.id}`} className="font-semibold text-amber-700 underline dark:text-amber-400" title="These questions already existed — choose the old, the new, or both">{b.queuedCount} →</a>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                          {(b.skippedCount ?? 0) > 0 && (
                            <span className="block text-[10px] text-muted-foreground" title="These duplicates were already in the review list, or you had already decided to keep the old one">+{b.skippedCount} already handled</span>
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
                        <td colSpan={11} className="px-3 pb-3 pt-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => toggleBatchDetail(b.id)}
                              className="whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                            >
                              {expandedBatchId === b.id ? "▴ Hide details" : "📋 View details / errors"}
                            </button>
                            <a
                              href={`/admin/questions/manage?batch=${b.id}`}
                              className="whitespace-nowrap rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10"
                              title="View all questions of this upload, search them and edit them one by one"
                            >
                              ✏️ View / edit questions
                            </a>
                            {(b.pendingCount ?? 0) > 0 && (
                              <button
                                onClick={() => publishBatchHandler(b.id)}
                                className="whitespace-nowrap rounded-lg border border-emerald-500/40 px-3 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
                                title="Publish (make live) all pending questions of this batch in one click"
                              >
                                ✅ Publish All ({b.pendingCount})
                              </button>
                            )}
                            {(b.liveCount ?? 0) > 0 && (
                              <button
                                onClick={() => unpublishBatchHandler(b.id)}
                                className="whitespace-nowrap rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                                title="Published by mistake? Move this upload's live questions back to Pending (hidden)"
                              >
                                ↩️ Unpublish ({b.liveCount})
                              </button>
                            )}
                            <button
                              onClick={() => downloadBatchHandler(b.id, b.filename)}
                              className="whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                              title="Download the questions currently in this batch as Excel"
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
                          <td colSpan={11} className="px-3 py-3">
                            {!expandedBatchDetail ? (
                              <p className="text-xs text-muted-foreground">Loading...</p>
                            ) : (
                              <>
                                {(expandedBatchDetail.breakdown?.length ?? 0) > 0 && (
                                  <div className="mb-3">
                                    <p className="mb-1 text-xs font-semibold text-foreground">
                                      Chapter / topic / sub-topic wise (deletes only the questions of that part):
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
                              <p className="text-xs text-muted-foreground">This upload had no errors.</p>
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
                                        {e.field && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">Column: {e.field}</span>}
                                      </div>
                                      {e.questionPreview && (
                                        <div className="mt-0.5 italic text-foreground/80">&quot;{e.questionPreview}&quot;</div>
                                      )}
                                      <div className="mt-0.5">❌ {e.error}</div>
                                      {e.fix && <div className="mt-0.5 text-emerald-700 dark:text-emerald-400">🛠️ How to fix: {e.fix}</div>}
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
            <h2 className="text-xl font-bold">{selectedUser.subscriptions.length > 0 ? "Extend" : "Add"} Subscription — {selectedUser.fullName}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{selectedUser.email}</p>
            {selectedUser.subscriptions[0]?.endsAt && (
              <p className="mt-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600">
                Current: {selectedUser.subscriptions[0].plan?.name || "Premium"} until {new Date(selectedUser.subscriptions[0].endsAt!).toLocaleDateString("en-IN")}
              </p>
            )}
            <div className="mt-4 rounded-lg border border-border bg-background p-3 text-sm">
              <label className="mb-1.5 block font-medium">Duration</label>
              <div className="flex gap-2">
                <select value={grantUnit} onChange={(e) => setGrantUnit(e.target.value as any)} className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
                  <option value="plan">Plan&apos;s own duration</option>
                  <option value="days">Custom — days</option>
                  <option value="months">Custom — months</option>
                </select>
                {grantUnit !== "plan" && (
                  <input type="number" min="1" value={grantAmount} onChange={(e) => setGrantAmount(e.target.value)} placeholder={grantUnit === "days" ? "e.g. 10" : "e.g. 3"} className="w-28 rounded-lg border border-border bg-card px-3 py-2 text-sm" />
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Remaining days are kept — new time is added after the current expiry.</p>
            </div>
            <p className="mt-4 text-sm font-medium">Choose a plan to grant</p>
            <div className="mt-2 space-y-2 max-h-60 overflow-y-auto">
              {plans.filter(p => p.isActive).length === 0 && <p className="text-sm text-muted-foreground">No active plans. Create one from the plan prices section.</p>}
              {plans.filter(p => p.isActive).map((plan) => (
                <button
                  key={plan.id}
                  disabled={grantBusy}
                  onClick={() => addSubscription(selectedUser.id, plan.id)}
                  className="w-full text-left rounded-lg border border-border bg-background p-3 hover:border-primary hover:bg-primary/5 transition disabled:opacity-50"
                >
                  <div className="font-medium">{plan.name} — ₹{plan.priceInr}/{plan.durationMonths} mo</div>
                </button>
              ))}
            </div>
            <button onClick={() => { setShowSubscriptionModal(false); setSelectedUser(null); setGrantUnit("plan"); setGrantAmount(""); }} className="mt-4 w-full rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted">Cancel</button>
          </div>
        </div>
      )}

      {/* Bulk Email Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
            <h2 className="text-xl font-bold">📧 Bulk Grant Subscription</h2>
            <p className="mt-1 text-sm text-muted-foreground">Enter emails (comma, space or new-line separated) and select a plan</p>
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
                        <div className="mt-3 rounded-lg border border-border bg-background p-3 text-sm">
              <label className="mb-1.5 block font-medium">Duration</label>
              <div className="flex gap-2">
                <select value={grantUnit} onChange={(e) => setGrantUnit(e.target.value as any)} className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
                  <option value="plan">Plan&apos;s own duration</option>
                  <option value="days">Custom — days</option>
                  <option value="months">Custom — months</option>
                </select>
                {grantUnit !== "plan" && (
                  <input type="number" min="1" value={grantAmount} onChange={(e) => setGrantAmount(e.target.value)} placeholder={grantUnit === "days" ? "e.g. 10" : "e.g. 3"} className="w-28 rounded-lg border border-border bg-card px-3 py-2 text-sm" />
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Remaining days are kept — new time is added after the current expiry.</p>
            </div>
            {bulkResult && (
              <div className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-border bg-background p-3 text-xs">
                <p className="mb-1 font-semibold">{bulkResult.granted} granted · {bulkResult.failed} failed</p>
                {bulkResult.results.filter((r) => !r.success).map((r) => (
                  <p key={r.email} className="text-red-600">❌ {r.email} — {r.reason}</p>
                ))}
                {bulkResult.failed === 0 && <p className="text-emerald-600">All users updated.</p>}
              </div>
            )}
            <div className="mt-6 flex gap-2">
              <button onClick={sendBulkSubscription} disabled={!bulkEmail.trim() || !bulkPlanId || grantBusy} className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{grantBusy ? "Granting…" : "Grant Subscriptions"}</button>
              <button onClick={() => { setShowEmailModal(false); setBulkEmail(""); setBulkPlanId(""); setBulkResult(null); setGrantUnit("plan"); setGrantAmount(""); }} className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm hover:bg-muted">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
