"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BackButton } from "@/components/BackButton";
import { Logo } from "@/components/Logo";
import { api } from "@/lib/api";
import {
  ALL_PERMISSIONS,
  PERMISSION_INFO,
  StaffPermission,
  useAccess,
} from "@/lib/permissions";

interface StaffMember {
  id: string;
  email: string;
  fullName: string;
  permissions: StaffPermission[];
  createdAt: string;
  uploads: number;
}
interface StaffList {
  staff: StaffMember[];
  admins: { id: string; email: string; fullName: string }[];
}
interface LookupUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  permissions: StaffPermission[];
}

function PermissionPicker({
  value,
  onChange,
}: {
  value: StaffPermission[];
  onChange: (v: StaffPermission[]) => void;
}) {
  const toggle = (p: StaffPermission) =>
    onChange(value.includes(p) ? value.filter((x) => x !== p) : [...value, p]);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {ALL_PERMISSIONS.map((p) => {
        const info = PERMISSION_INFO[p];
        const on = value.includes(p);
        return (
          <label
            key={p}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition ${
              on ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
            }`}
          >
            <input
              type="checkbox"
              checked={on}
              onChange={() => toggle(p)}
              className="mt-1 h-4 w-4"
            />
            <span>
              <span className="font-semibold">
                {info.emoji} {info.label}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{info.desc}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

export default function StaffAccessPage() {
  const router = useRouter();
  const access = useAccess();

  const [data, setData] = React.useState<StaffList | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [info, setInfo] = React.useState("");

  // add-staff form
  const [email, setEmail] = React.useState("");
  const [found, setFound] = React.useState<LookupUser | null>(null);
  const [newPerms, setNewPerms] = React.useState<StaffPermission[]>([]);
  const [busy, setBusy] = React.useState(false);

  // inline edit
  const [editId, setEditId] = React.useState<string | null>(null);
  const [editPerms, setEditPerms] = React.useState<StaffPermission[]>([]);

  React.useEffect(() => {
    if (!access.loading && !access.isAdmin) router.replace("/dashboard");
  }, [access.loading, access.isAdmin, router]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<StaffList>("/admin/staff"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Staff list load nahi hui");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (access.isAdmin) load();
  }, [access.isAdmin, load]);

  const flash = (msg: string) => {
    setInfo(msg);
    setTimeout(() => setInfo(""), 4000);
  };

  async function checkEmail() {
    setError("");
    setFound(null);
    if (!email.trim()) return;
    setBusy(true);
    try {
      const u = await api<LookupUser>(`/admin/staff/lookup?email=${encodeURIComponent(email.trim())}`);
      setFound(u);
      if (u.role === "MODERATOR") setNewPerms(u.permissions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setBusy(false);
    }
  }

  async function grant() {
    if (!found) return;
    if (newPerms.length === 0) {
      setError("Kam se kam ek department select karein");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/admin/staff", {
        method: "POST",
        body: JSON.stringify({ email: found.email, permissions: newPerms }),
      });
      flash(`${found.email} ko access mil gaya`);
      setEmail("");
      setFound(null);
      setNewPerms([]);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Access dene me error");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    if (editPerms.length === 0) {
      setError("Kam se kam ek department rakhein — ya poora access hata dein (Remove).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/admin/staff/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ permissions: editPerms }),
      });
      setEditId(null);
      flash("Access update ho gaya");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(m: StaffMember) {
    if (!window.confirm(`${m.email} ka staff access poori tarah hata dein? Ye wapas normal student ban jayega.`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/admin/staff/${m.id}`, { method: "DELETE" });
      flash(`${m.email} ka access hata diya`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  if (access.loading || !access.isAdmin) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-4">
          <BackButton />
          <Logo size={32} withWordmark={false} />
          <span className="text-lg font-bold tracking-tight">Staff Access</span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <p className="mb-4 text-sm text-muted-foreground">
          Kisi bhi registered student ki email daal kar use department-wise access dein. Har department alag hai —
          Questions wala Vocabulary nahi dekh sakta, aur Vocabulary wala questions upload nahi kar sakta. Change kuch
          seconds me apply ho jaata hai.
        </p>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">{error}</div>
        )}
        {info && (
          <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">{info}</div>
        )}

        {/* Add staff */}
        <section className="mb-6 rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 font-semibold">➕ Naya staff / access change</h2>
          <div className="flex flex-wrap gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setFound(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") checkEmail(); }}
              placeholder="student@gmail.com"
              className="min-w-[220px] flex-1 rounded-lg border border-border bg-background px-4 py-2 text-sm outline-none focus:border-primary"
            />
            <button
              onClick={checkEmail}
              disabled={busy || !email.trim()}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              Check
            </button>
          </div>

          {found && (
            <div className="mt-4 space-y-3">
              <div className="rounded-lg border border-border bg-background p-3 text-sm">
                <div className="font-semibold">{found.fullName}</div>
                <div className="text-xs text-muted-foreground">
                  {found.email} · abhi: {found.role}
                </div>
                {found.role === "ADMIN" && (
                  <div className="mt-1 text-xs text-red-500">Ye ADMIN hai — iska access yahan se change nahi hota.</div>
                )}
              </div>
              {found.role !== "ADMIN" && (
                <>
                  <PermissionPicker value={newPerms} onChange={setNewPerms} />
                  <button
                    onClick={grant}
                    disabled={busy || newPerms.length === 0}
                    className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {found.role === "MODERATOR" ? "Access update karein" : "Access dein"}
                  </button>
                </>
              )}
            </div>
          )}
        </section>

        {/* Current staff */}
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 font-semibold">👥 Current staff {data ? `(${data.staff.length})` : ""}</h2>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && data && data.staff.length === 0 && (
            <p className="text-sm text-muted-foreground">Abhi koi staff member nahi hai.</p>
          )}
          <ul className="space-y-3">
            {data?.staff.map((m) => (
              <li key={m.id} className="rounded-lg border border-border bg-background p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{m.fullName}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.email} · {m.uploads} upload{m.uploads === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        if (editId === m.id) setEditId(null);
                        else { setEditId(m.id); setEditPerms(m.permissions); }
                      }}
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                    >
                      {editId === m.id ? "Cancel" : "Edit"}
                    </button>
                    <button
                      onClick={() => revoke(m)}
                      disabled={busy}
                      className="rounded-md border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {editId === m.id ? (
                  <div className="mt-3 space-y-3">
                    <PermissionPicker value={editPerms} onChange={setEditPerms} />
                    <button
                      onClick={() => saveEdit(m.id)}
                      disabled={busy}
                      className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.permissions.length === 0 && (
                      <span className="text-xs text-muted-foreground">Koi department nahi</span>
                    )}
                    {m.permissions.map((p) => (
                      <span key={p} className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                        {PERMISSION_INFO[p].emoji} {PERMISSION_INFO[p].label}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {data && data.admins.length > 0 && (
            <div className="mt-5 border-t border-border pt-3 text-xs text-muted-foreground">
              Admins (full access): {data.admins.map((a) => a.email).join(", ")}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
