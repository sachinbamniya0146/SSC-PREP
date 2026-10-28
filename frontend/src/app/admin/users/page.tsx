"use client";

// Admin → Users: one screen only for controlling students
// (search, filter, subscription, suspend / restore, permanent delete).
import * as React from "react";
import { BackButton } from "@/components/BackButton";
import { Logo } from "@/components/Logo";
import AdminUsersPanel, { AdminUserRow } from "@/components/AdminUsersPanel";
import { api } from "@/lib/api";
import { useAccess } from "@/lib/permissions";

const LIMIT = 20;

export default function AdminUsersPage() {
  const access = useAccess();
  const [users, setUsers] = React.useState<AdminUserRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [role, setRole] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [info, setInfo] = React.useState("");

  React.useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (debounced) q.append("search", debounced);
      if (role) q.append("role", role);
      if (status) q.append("status", status);
      const d = await api<{ users: AdminUserRow[]; total: number }>(`/admin/users?${q}`);
      setUsers(d.users);
      setTotal(d.total);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load users");
    } finally {
      setLoading(false);
    }
  }, [page, debounced, role, status]);

  React.useEffect(() => {
    if (access.loading || !access.isAdmin) return;
    void load();
  }, [load, access.loading, access.isAdmin]);

  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const field = "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary";

  if (!access.loading && !access.isAdmin) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Only admins can manage users.</div>;
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-lg">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <BackButton />
          <Logo size={28} withWordmark={false} />
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight">Users</h1>
          <a href="/admin" className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">Admin home</a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5">
        {error && <div role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600">{error}</div>}
        {info && <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600">{info}</div>}

        <div className="mb-4 grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[1fr_160px_160px]">
          <div>
            <label htmlFor="u-search" className="mb-1.5 block text-sm font-medium">Search (email / name)</label>
            <input id="u-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users…" className={field} />
          </div>
          <div>
            <label htmlFor="u-role" className="mb-1.5 block text-sm font-medium">Role</label>
            <select id="u-role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} className={field}>
              <option value="">All roles</option>
              <option value="STUDENT">Student</option>
              <option value="MODERATOR">Moderator</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>
          <div>
            <label htmlFor="u-status" className="mb-1.5 block text-sm font-medium">Status</label>
            <select id="u-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={field}>
              <option value="">All accounts</option>
              <option value="suspended">Suspended only</option>
              <option value="active">Active only</option>
            </select>
          </div>
        </div>

        {loading && users.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">Loading users…</div>
        ) : (
          <AdminUsersPanel users={users} onChanged={load} onInfo={setInfo} onError={setError} />
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <span className="text-sm text-muted-foreground">Page {page} of {pages} · {total} users</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="min-h-[40px] rounded-lg border border-border px-4 text-sm disabled:opacity-40">Prev</button>
            <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} className="min-h-[40px] rounded-lg border border-border px-4 text-sm disabled:opacity-40">Next</button>
          </div>
        </div>
      </main>
    </div>
  );
}
