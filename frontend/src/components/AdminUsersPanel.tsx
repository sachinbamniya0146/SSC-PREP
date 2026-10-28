"use client";

/**
 * Admin → Users list (mobile cards + desktop table) and the "Manage user" sheet:
 *   - add / extend subscription, cancel subscription
 *   - suspend (reason is e-mailed to the student) and restore
 *   - permanently delete (shows what will be lost, asks for the exact e-mail, e-mails the student)
 * Everything talks to /admin/users/:id/* (ADMIN only on the server).
 */
import * as React from "react";
import UserAvatar from "@/components/UserAvatar";
import { api } from "@/lib/api";
import { readStoredUser } from "@/lib/permissions";

export interface AdminUserRow {
  id: string;
  email: string;
  fullName: string;
  role: string;
  phone?: string | null;
  avatarUrl?: string | null;
  isEmailVerified: boolean;
  isSuspended?: boolean;
  suspendedAt?: string | null;
  suspendedReason?: string | null;
  createdAt: string;
  subscriptions: { status: string; endsAt: string | null; startsAt?: string; planId: string; plan?: { name: string } | null }[];
  _count: { testAttempts: number; bookmarks: number };
}

interface DeletePreview {
  email: string;
  fullName: string;
  activeSubscriptions: number;
  payments: number;
  paidPayments: number;
  walletBalanceInr: number;
  openWithdrawals: number;
  testAttempts: number;
  blocked: boolean;
  blockedReason: string | null;
  needsAcknowledge: boolean;
}

type Mode = "menu" | "suspend" | "delete" | "grant";
type PlanRow = { id: string; name: string; priceInr: number; durationMonths: number; isActive: boolean };

const ROLE_STYLE: Record<string, string> = {
  ADMIN: "bg-red-500/15 text-red-500",
  MODERATOR: "bg-amber-500/15 text-amber-600",
  STUDENT: "bg-blue-500/15 text-blue-500",
};

function Chip({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}>{children}</span>;
}

function daysLeft(endsAt: string | null) {
  return endsAt ? Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86400000)) : null;
}

function SubLine({ u }: { u: AdminUserRow }) {
  if (u.subscriptions.length === 0) return <span className="text-muted-foreground">Free plan</span>;
  return (
    <>
      {u.subscriptions.map((sub) => {
        const left = daysLeft(sub.endsAt);
        return (
          <div key={sub.planId + (sub.endsAt || "")} className="text-xs font-medium text-emerald-600">
            {sub.plan?.name || "Premium"}
            {sub.endsAt ? ` · until ${new Date(sub.endsAt).toLocaleDateString("en-IN")} (${left} days left)` : ""}
          </div>
        );
      })}
    </>
  );
}

export default function AdminUsersPanel({
  users,
  onChanged,
  onInfo,
  onError,
}: {
  users: AdminUserRow[];
  onChanged: () => void;
  onInfo: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [currentUserId, setCurrentUserId] = React.useState<string | undefined>(undefined);
  React.useEffect(() => setCurrentUserId(readStoredUser()?.id), []);
  const [target, setTarget] = React.useState<AdminUserRow | null>(null);
  const [mode, setMode] = React.useState<Mode>("menu");
  const [busy, setBusy] = React.useState(false);
  const [localErr, setLocalErr] = React.useState("");

  const [reason, setReason] = React.useState("");
  const [notify, setNotify] = React.useState(true);

  const [preview, setPreview] = React.useState<DeletePreview | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [confirmEmail, setConfirmEmail] = React.useState("");
  const [ack, setAck] = React.useState(false);

  const [plans, setPlans] = React.useState<PlanRow[] | null>(null);
  const [grantUnit, setGrantUnit] = React.useState<"plan" | "days" | "months">("plan");
  const [grantAmount, setGrantAmount] = React.useState("");

  async function startGrant() {
    setMode("grant");
    setLocalErr("");
    setGrantUnit("plan");
    setGrantAmount("");
    if (plans) return;
    try {
      const d = await api<{ plans: PlanRow[] }>("/admin/plans");
      setPlans(d.plans || []);
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : "Could not load the plans");
      setPlans([]);
    }
  }
  function grantWith(planId: string) {
    if (!target) return;
    const n = Number(grantAmount);
    if (grantUnit !== "plan" && (!Number.isInteger(n) || n < 1)) {
      setLocalErr("Custom duration must be a whole number (1 or more).");
      return;
    }
    const extra = grantUnit === "days" ? { days: n } : grantUnit === "months" ? { months: n } : {};
    void run(`/admin/users/${target.id}/subscription/add`, { planId, ...extra }, () => `Subscription updated for ${target.fullName}.`);
  }

  function open(u: AdminUserRow) {
    setTarget(u);
    setMode("menu");
    setLocalErr("");
    setReason("");
    setNotify(true);
    setPreview(null);
    setConfirmEmail("");
    setAck(false);
  }
  function close() {
    if (busy) return;
    setTarget(null);
  }

  React.useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setTarget(null);
    };
    window.addEventListener("keydown", onKey);
    window.scrollTo({ top: 0 });
    return () => window.removeEventListener("keydown", onKey);
  }, [target, busy]);

  async function startDelete() {
    if (!target) return;
    setMode("delete");
    setLocalErr("");
    setPreview(null);
    setPreviewLoading(true);
    try {
      setPreview(await api<DeletePreview>(`/admin/users/${target.id}/delete-preview`));
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : "Could not load the account summary");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function run(path: string, body: Record<string, unknown>, done: (r: { emailSent: boolean }) => string) {
    setBusy(true);
    setLocalErr("");
    try {
      const r = await api<{ ok: boolean; emailSent: boolean }>(path, { method: "POST", body: JSON.stringify(body) });
      onError("");
      onInfo(done(r));
      setTarget(null);
      onChanged();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const mailNote = (r: { emailSent: boolean }) =>
    !notify ? "" : r.emailSent ? " Email sent to the student." : " The email could not be sent (SMTP is not configured or failed).";

  const isSelf = !!target && target.id === currentUserId;
  const isAdminTarget = target?.role === "ADMIN";
  const protectedAccount = isSelf || isAdminTarget;

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary";
  const btnBase = "inline-flex min-h-[44px] items-center justify-center rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <>
      {!target && (<>
      {/* ---------- Mobile: cards ---------- */}
      <div className="space-y-3 md:hidden">
        {users.length === 0 && <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">No users found</div>}
        {users.map((u) => (
          <div key={u.id} className={`rounded-xl border bg-card p-4 ${u.isSuspended ? "border-red-500/40" : "border-border"}`}>
            <div className="flex items-start gap-3">
              <UserAvatar name={u.fullName} email={u.email} src={u.avatarUrl} size={44} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{u.fullName}</div>
                <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Chip className={ROLE_STYLE[u.role] || "bg-muted text-muted-foreground"}>{u.role}</Chip>
                  {u.isSuspended && <Chip className="bg-red-500/15 text-red-500">Suspended</Chip>}
                  {u.isEmailVerified ? <Chip className="bg-emerald-500/15 text-emerald-600">Verified</Chip> : <Chip className="bg-amber-500/15 text-amber-600">Email pending</Chip>}
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-muted/50 py-2"><div className="text-base font-bold">{u._count.testAttempts}</div><div className="text-muted-foreground">Tests</div></div>
              <div className="rounded-lg bg-muted/50 py-2"><div className="text-base font-bold">{u._count.bookmarks}</div><div className="text-muted-foreground">Bookmarks</div></div>
              <div className="rounded-lg bg-muted/50 py-2"><div className="text-base font-bold">{new Date(u.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</div><div className="text-muted-foreground">Joined</div></div>
            </div>
            <div className="mt-2 text-sm"><SubLine u={u} /></div>
            {u.phone && <div className="mt-1 text-xs text-muted-foreground">Phone: {u.phone}</div>}
            <button onClick={() => open(u)} className={`${btnBase} mt-3 w-full border border-border bg-background hover:bg-muted`}>Manage user</button>
          </div>
        ))}
      </div>

      {/* ---------- Desktop: table ---------- */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">User</th>
              <th className="px-4 py-3 text-left font-medium">Role</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Phone</th>
              <th className="px-4 py-3 text-left font-medium">Tests</th>
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
                <tr key={u.id} className={`border-t border-border hover:bg-muted/50 ${u.isSuspended ? "bg-red-500/5" : ""}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <UserAvatar name={u.fullName} email={u.email} src={u.avatarUrl} size={36} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{u.fullName}</div>
                        <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3"><Chip className={ROLE_STYLE[u.role] || "bg-muted text-muted-foreground"}>{u.role}</Chip></td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-1">
                      {u.isSuspended ? <Chip className="bg-red-500/15 text-red-500">Suspended</Chip> : <Chip className="bg-emerald-500/15 text-emerald-600">Active</Chip>}
                      {!u.isEmailVerified && <span className="text-xs text-amber-600">Email not verified</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">{u.phone || <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-3">{u._count.testAttempts}</td>
                  <td className="px-4 py-3">{u._count.bookmarks}</td>
                  <td className="px-4 py-3"><SubLine u={u} /></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(u.createdAt).toLocaleDateString("en-IN")}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => open(u)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">Manage</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      </>)}

      {/* ---------- Manage view (inline, replaces the list — no pop-up) ---------- */}
      {target && (
        <div className="mx-auto w-full max-w-xl">
          <button onClick={close} className="mb-3 inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-border px-3 text-sm hover:bg-muted">← All users</button>
          <div
            role="region"
            aria-label={`Manage ${target.fullName}`}
            className="rounded-2xl border border-border bg-card p-5 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <UserAvatar name={target.fullName} email={target.email} src={target.avatarUrl} size={44} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{target.fullName}</div>
                <div className="truncate text-xs text-muted-foreground">{target.email}</div>
              </div>
              <button onClick={close} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-full text-xl text-muted-foreground hover:bg-muted">×</button>
            </div>

            {localErr && <div role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">{localErr}</div>}

            {mode === "menu" && (
              <div className="mt-4 space-y-2">
                {target.isSuspended && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm">
                    <div className="font-semibold text-red-600">This account is suspended</div>
                    {target.suspendedAt && <div className="text-xs text-muted-foreground">Since {new Date(target.suspendedAt).toLocaleString("en-IN")}</div>}
                    {target.suspendedReason && <div className="mt-1 whitespace-pre-wrap">{target.suspendedReason}</div>}
                  </div>
                )}
                <button onClick={startGrant} className={`${btnBase} w-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20`}>
                  {target.subscriptions.length > 0 ? "Extend subscription" : "Add subscription"}
                </button>
                {target.subscriptions.length > 0 && (
                  <button onClick={() => { if (confirm(`Cancel ${target.fullName}'s subscription? Remaining days will be lost.`)) void run(`/admin/users/${target.id}/subscription/cancel`, {}, () => "Subscription cancelled."); }} className={`${btnBase} w-full border border-border hover:bg-muted`}>Cancel subscription</button>
                )}

                {protectedAccount ? (
                  <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                    {isSelf ? "This is your own account, so it cannot be suspended or deleted." : "Admin accounts cannot be suspended or deleted. Change the role first."}
                  </p>
                ) : (
                  <>
                    {target.isSuspended ? (
                      <button
                        disabled={busy}
                        onClick={() => run(`/admin/users/${target.id}/unsuspend`, { notify }, (r) => `${target.fullName} is active again.${mailNote(r)}`)}
                        className={`${btnBase} w-full bg-emerald-600 text-white hover:bg-emerald-700`}
                      >
                        {busy ? "Restoring…" : "Restore account"}
                      </button>
                    ) : (
                      <button onClick={() => { setMode("suspend"); setLocalErr(""); }} className={`${btnBase} w-full border border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20`}>Suspend account…</button>
                    )}
                    {target.isSuspended && (
                      <label className="flex min-h-[44px] cursor-pointer items-center gap-3 px-1 text-sm">
                        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-5 w-5 accent-[hsl(var(--primary))]" />
                        Email the student that the account is restored
                      </label>
                    )}
                    <button onClick={startDelete} className={`${btnBase} w-full border border-red-500/40 bg-red-500/10 text-red-600 hover:bg-red-500/20`}>Delete permanently…</button>
                  </>
                )}
              </div>
            )}

            {mode === "grant" && (
              <div className="mt-4 space-y-3">
                <h3 className="text-base font-bold">{target.subscriptions.length > 0 ? "Extend" : "Add"} subscription</h3>
                <div className="rounded-lg border border-border bg-background p-3 text-sm">
                  <label className="mb-1.5 block font-medium">Duration</label>
                  <div className="flex gap-2">
                    <select value={grantUnit} onChange={(e) => setGrantUnit(e.target.value as "plan" | "days" | "months")} className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
                      <option value="plan">Plan&apos;s own duration</option>
                      <option value="days">Custom — days</option>
                      <option value="months">Custom — months</option>
                    </select>
                    {grantUnit !== "plan" && (
                      <input type="number" min="1" value={grantAmount} onChange={(e) => setGrantAmount(e.target.value)} placeholder={grantUnit === "days" ? "e.g. 10" : "e.g. 2"} className="w-24 rounded-lg border border-border bg-card px-3 py-2 text-sm" />
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Remaining days are kept — new time is added after the current expiry.</p>
                </div>
                <p className="text-sm font-medium">Choose a plan to grant</p>
                {plans === null && <p className="text-sm text-muted-foreground">Loading plans…</p>}
                {plans && plans.filter((x) => x.isActive).length === 0 && <p className="text-sm text-muted-foreground">No active plans.</p>}
                <div className="space-y-2">
                  {(plans || []).filter((x) => x.isActive).map((pl) => (
                    <button key={pl.id} disabled={busy} onClick={() => grantWith(pl.id)} className="w-full rounded-lg border border-border bg-background p-3 text-left text-sm font-medium hover:border-primary hover:bg-primary/5 disabled:opacity-50">
                      {pl.name} — ₹{pl.priceInr}/{pl.durationMonths} mo
                    </button>
                  ))}
                </div>
                <button disabled={busy} onClick={() => { setMode("menu"); setLocalErr(""); }} className={`${btnBase} w-full border border-border hover:bg-muted`}>Back</button>
              </div>
            )}

            {mode === "suspend" && (
              <div className="mt-4 space-y-3">
                <h3 className="text-base font-bold">Suspend this account</h3>
                <p className="text-sm text-muted-foreground">The student is signed out on every device and cannot log in. Their data is kept, and you can restore the account at any time.</p>
                <div>
                  <label htmlFor="sus-reason" className="mb-1.5 block text-sm font-medium">Reason (shown to the student in the email)</label>
                  <textarea id="sus-reason" rows={4} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Sharing the account with other people is against our terms." className={inputCls} />
                  <div className="mt-1 text-right text-xs text-muted-foreground">{reason.trim().length}/500</div>
                </div>
                <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm">
                  <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-5 w-5 accent-[hsl(var(--primary))]" />
                  Send an email to {target.email}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button disabled={busy} onClick={() => { setMode("menu"); setLocalErr(""); }} className={`${btnBase} border border-border hover:bg-muted`}>Back</button>
                  <button
                    disabled={busy || reason.trim().length < 5}
                    onClick={() => run(`/admin/users/${target.id}/suspend`, { reason: reason.trim(), notify }, (r) => `${target.fullName} is suspended.${mailNote(r)}`)}
                    className={`${btnBase} bg-amber-600 text-white hover:bg-amber-700`}
                  >
                    {busy ? "Suspending…" : "Suspend"}
                  </button>
                </div>
              </div>
            )}

            {mode === "delete" && (
              <div className="mt-4 space-y-3">
                <h3 className="text-base font-bold text-red-600">Delete this account permanently</h3>
                {previewLoading && <p className="text-sm text-muted-foreground">Checking what will be removed…</p>}
                {preview && (
                  <>
                    <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm">
                      <p className="font-medium">This cannot be undone. The following will be removed:</p>
                      <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-muted-foreground">
                        <li>Profile, sessions, bookmarks, notes and progress</li>
                        <li>{preview.testAttempts} test attempt(s) with all answers</li>
                        <li>{preview.activeSubscriptions} active subscription(s)</li>
                        {preview.walletBalanceInr > 0 && <li>Referral wallet balance of ₹{preview.walletBalanceInr.toFixed(2)}</li>}
                      </ul>
                      <p className="mt-2 text-xs text-muted-foreground">{preview.payments} payment record(s) are kept for accounting, detached from the profile.</p>
                    </div>
                    {preview.blocked ? (
                      <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">{preview.blockedReason}</div>
                    ) : (
                      <>
                        {preview.needsAcknowledge && (
                          <label className="flex cursor-pointer items-start gap-3 text-sm">
                            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]" />
                            I understand the active subscription / wallet balance will be lost.
                          </label>
                        )}
                        <div>
                          <label htmlFor="del-reason" className="mb-1.5 block text-sm font-medium">Reason (optional, included in the email)</label>
                          <textarea id="del-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
                        </div>
                        <div>
                          <label htmlFor="del-email" className="mb-1.5 block text-sm font-medium">Type <span className="font-mono">{target.email}</span> to confirm</label>
                          <input id="del-email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} className={inputCls} />
                        </div>
                        <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm">
                          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-5 w-5 accent-[hsl(var(--primary))]" />
                          Send a confirmation email to the student
                        </label>
                      </>
                    )}
                  </>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button disabled={busy} onClick={() => { setMode("menu"); setLocalErr(""); }} className={`${btnBase} border border-border hover:bg-muted`}>Back</button>
                  <button
                    disabled={
                      busy || !preview || preview.blocked ||
                      confirmEmail.trim().toLowerCase() !== target.email.toLowerCase() ||
                      (preview.needsAcknowledge && !ack)
                    }
                    onClick={() => run(`/admin/users/${target.id}/delete`, { confirmEmail: confirmEmail.trim(), reason: reason.trim(), notify, acknowledge: ack }, (r) => `${target.fullName}'s account was deleted permanently.${mailNote(r)}`)}
                    className={`${btnBase} bg-red-600 text-white hover:bg-red-700`}
                  >
                    {busy ? "Deleting…" : "Delete forever"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
