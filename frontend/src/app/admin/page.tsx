"use client";

import * as React from "react";
import { ThemeContext } from "@/components/theme-provider";
import { api } from "@/lib/api";

interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
  phone?: string | null;
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
    try {
      const data = await api<{ plans: SubscriptionPlan[] }>("/payments/plans");
      setPlans(data.plans);
    } catch (err) {
      console.error("Failed to load plans", err);
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

  React.useEffect(() => {
    loadUsers();
    loadPlans();
  }, [page, search, roleFilter]);

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
          <span className="text-lg font-bold">
            SSC<span className="text-primary">PrepHub</span> Admin
          </span>
          <div className="flex items-center gap-3 text-sm">
            <button onClick={toggleTheme} aria-label="Toggle theme" className="rounded-lg border border-border p-2 text-sm">
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">👥 User Management</h1>
          <div className="flex gap-2">
            <button onClick={() => setShowEmailModal(true)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
              📧 Bulk Grant Subscription
            </button>
          </div>
        </div>

        {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">{error}</div>}
        {info && <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">{info}</div>}

        {/* Plan / Pricing Management — previously missing entirely: the
            admin panel could only display plans to assign to a user, with
            no way to actually change a price or add a new plan. */}
        <div className="mb-6 rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">💰 Subscription Plans</h2>
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
                        <div className="font-medium">{u.fullName}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
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
