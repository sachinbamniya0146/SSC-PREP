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
  price: number;
  currency: string;
  durationDays: number;
  features: string[];
  isActive: boolean;
  code?: string;
  description?: string;
}

interface AdminGrantRequest {
  months?: number;
  days?: number;
}

interface BulkGrantRequest {
  emails: string[];
  months?: number;
  days?: number;
}

interface SupportTicket {
  id: string;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  user: { id: string; email: string; fullName: string; role: string; phone?: string | null };
}

interface SupportTicketsResponse {
  tickets: SupportTicket[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
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
  const [showGrantPremiumModal, setShowGrantPremiumModal] = React.useState(false);
  const [showEmailModal, setShowEmailModal] = React.useState(false);
  const [showBulkPremiumModal, setShowBulkPremiumModal] = React.useState(false);
  const [bulkEmail, setBulkEmail] = React.useState("");
  const [bulkMonths, setBulkMonths] = React.useState("");
  const [bulkDays, setBulkDays] = React.useState("");
  const [grantMonths, setGrantMonths] = React.useState("");
  const [grantDays, setGrantDays] = React.useState("");
  const [bulkPlanId, setBulkPlanId] = React.useState("");
  const [plans, setPlans] = React.useState<SubscriptionPlan[]>([]);
  const [error, setError] = React.useState("");
  const [info, setInfo] = React.useState("");
  // Support tickets
  const [showSupportModal, setShowSupportModal] = React.useState(false);
  const [supportTickets, setSupportTickets] = React.useState<SupportTicket[]>([]);
  const [supportTotal, setSupportTotal] = React.useState(0);
  const [supportPage, setSupportPage] = React.useState(1);
  const [supportLimit] = React.useState(20);
  const [supportStatus, setSupportStatus] = React.useState("");
  const [supportCategory, setSupportCategory] = React.useState("");
  const [supportPriority, setSupportPriority] = React.useState("");
  const [supportSearch, setSupportSearch] = React.useState("");
  const [selectedTicket, setSelectedTicket] = React.useState<SupportTicket | null>(null);
  const [replyText, setReplyText] = React.useState("");
  const [supportLoading, setSupportLoading] = React.useState(false);

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

  async function grantPremium(userId: string, months?: number, days?: number) {
    try {
      await api(`/admin/users/${userId}/grant-premium`, {
        method: "POST",
        body: JSON.stringify({ months, days }),
      });
      setInfo("Premium granted successfully");
      loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to grant premium");
    }
  }

  async function revokePremium(userId: string) {
    try {
      await api(`/admin/users/${userId}/revoke-premium`, {
        method: "POST",
      });
      setInfo("Premium revoked successfully");
      loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke premium");
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

  async function sendBulkPremium() {
    if (!bulkEmail) return;
    const months = bulkMonths ? Number(bulkMonths) : undefined;
    const days = bulkDays ? Number(bulkDays) : undefined;
    try {
      await api("/admin/bulk/grant-premium", {
        method: "POST",
        body: JSON.stringify({ emails: bulkEmail.split(",").map(e => e.trim()), months, days }),
      });
      setInfo("Bulk premium granted successfully");
      setShowBulkPremiumModal(false);
      setBulkEmail("");
      setBulkMonths("");
      setBulkDays("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to grant bulk premium");
    }
  }

  // Support ticket functions
  async function loadSupportTickets() {
    setSupportLoading(true);
    try {
      const params = new URLSearchParams();
      params.append("page", String(supportPage));
      params.append("limit", String(supportLimit));
      if (supportStatus) params.append("status", supportStatus);
      if (supportCategory) params.append("category", supportCategory);
      if (supportPriority) params.append("priority", supportPriority);
      if (supportSearch) params.append("search", supportSearch);
      const data = await api<SupportTicketsResponse>(`/admin/support-tickets?${params}`);
      setSupportTickets(data.tickets);
      setSupportTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load support tickets");
    } finally {
      setSupportLoading(false);
    }
  }

  async function updateTicketStatus(ticketId: string, status: string) {
    try {
      await api(`/admin/support-tickets/${ticketId}`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
      setInfo("Ticket status updated");
      loadSupportTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update ticket");
    }
  }

  async function replyToTicket(ticketId: string) {
    if (!replyText.trim()) return;
    try {
      await api(`/admin/support-tickets/${ticketId}/reply`, {
        method: "POST",
        body: JSON.stringify({ message: replyText }),
      });
      setInfo("Reply sent successfully");
      setReplyText("");
      loadSupportTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reply");
    }
  }

  React.useEffect(() => {
    loadUsers();
    loadPlans();
  }, [page, search, roleFilter]);

  React.useEffect(() => {
    loadSupportTickets();
  }, [supportPage, supportStatus, supportCategory, supportPriority, supportSearch]);

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      ADMIN: "bg-red-500/20 text-red-400",
      MODERATOR: "bg-amber-500/20 text-amber-400",
      STUDENT: "bg-blue-500/20 text-blue-400",
    };
    const colorClass = colors[role] || "bg-muted text-muted-foreground";
    return <span className={"badge " + colorClass}>{role}</span>;
  };

  const statusColors: Record<string, string> = {
    OPEN: "bg-blue-500/20 text-blue-400",
    IN_PROGRESS: "bg-amber-500/20 text-amber-400",
    RESOLVED: "bg-emerald-500/20 text-emerald-400",
    CLOSED: "bg-muted text-muted-foreground",
  };

  const priorityColors: Record<string, string> = {
    LOW: "bg-blue-500/20 text-blue-400",
    MEDIUM: "bg-amber-500/20 text-amber-400",
    HIGH: "bg-orange-500/20 text-orange-400",
    URGENT: "bg-red-500/20 text-red-400",
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
            <button onClick={() => setShowSupportModal(true)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
              🎫 Support Tickets
            </button>
            <button onClick={() => setShowEmailModal(true)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
              📧 Bulk Grant Subscription
            </button>
            <button onClick={() => setShowBulkPremiumModal(true)} className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
              🎁 Bulk Grant Premium
            </button>
          </div>
        </div>

        {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">{error}</div>}
        {info && <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">{info}</div>}

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
                          {u.role !== 'ADMIN' ? (
                            <>
                              {u.subscriptions.some(s => s.status === "ACTIVE") ? (
                                <button onClick={() => revokePremium(u.id)} className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-600 hover:bg-red-500/20">Revoke Premium</button>
                              ) : (
                                <button onClick={() => { setSelectedUser(u); setShowGrantPremiumModal(true); }} className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-600 hover:bg-emerald-500/20">Grant Premium</button>
                              )}
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">Admin</span>
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
                  <div className="font-medium">{plan.name} — ₹{plan.price}/{plan.durationDays} days</div>
                  <div className="text-xs text-muted-foreground">{plan.features.join(" · ")}</div>
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
                    <option key={plan.id} value={plan.id}>{plan.name} — ₹{plan.price}</option>
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

      {/* Grant Premium Modal */}
      {showGrantPremiumModal && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
            <h2 className="text-xl font-bold">Grant Premium to {selectedUser.fullName}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{selectedUser.email}</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Duration (months)</label>
                <input
                  type="number"
                  value={grantMonths}
                  onChange={(e) => setGrantMonths(e.target.value)}
                  placeholder="e.g., 12"
                  min="1"
                  max="120"
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Or Duration (days)</label>
                <input
                  type="number"
                  value={grantDays}
                  onChange={(e) => setGrantDays(e.target.value)}
                  placeholder="e.g., 30"
                  min="1"
                  max="3650"
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                />
              </div>
              <p className="text-xs text-muted-foreground">Leave both empty for 1 year default</p>
            </div>
            <div className="mt-6 flex gap-2">
              <button onClick={() => { grantPremium(selectedUser.id, grantMonths ? Number(grantMonths) : undefined, grantDays ? Number(grantDays) : undefined); setShowGrantPremiumModal(false); setGrantMonths(""); setGrantDays(""); }} className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90">Grant Premium</button>
              <button onClick={() => { setShowGrantPremiumModal(false); setSelectedUser(null); setGrantMonths(""); setGrantDays(""); }} className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm hover:bg-muted">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Premium Modal */}
      {showBulkPremiumModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
            <h2 className="text-xl font-bold">📧 Bulk Grant Premium</h2>
            <p className="mt-1 text-sm text-muted-foreground">Enter emails (comma-separated) and duration</p>
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
                <label className="mb-1.5 block text-sm font-medium">Duration (months)</label>
                <input
                  type="number"
                  value={bulkMonths}
                  onChange={(e) => setBulkMonths(e.target.value)}
                  placeholder="e.g., 12"
                  min="1"
                  max="120"
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Or Duration (days)</label>
                <input
                  type="number"
                  value={bulkDays}
                  onChange={(e) => setBulkDays(e.target.value)}
                  placeholder="e.g., 30"
                  min="1"
                  max="3650"
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                />
              </div>
              <p className="text-xs text-muted-foreground">Leave both empty for 1 year default</p>
            </div>
            <div className="mt-6 flex gap-2">
              <button onClick={sendBulkPremium} disabled={!bulkEmail} className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">Grant Premium</button>
              <button onClick={() => { setShowBulkPremiumModal(false); setBulkEmail(""); setBulkMonths(""); setBulkDays(""); }} className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm hover:bg-muted">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Support Tickets Modal */}
      {showSupportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-5xl rounded-2xl border border-border bg-card p-6 shadow-xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">🎫 Support Tickets</h2>
              <button onClick={() => setShowSupportModal(false)} className="rounded-lg border border-border p-2 hover:bg-muted">✕</button>
            </div>

            {/* Filters */}
            <div className="mb-4 flex flex-wrap gap-3 rounded-xl border border-border bg-background p-3">
              <div className="flex-1 min-w-[150px]">
                <label className="mb-1 block text-xs font-medium">Search</label>
                <input
                  value={supportSearch}
                  onChange={(e) => { setSupportSearch(e.target.value); setSupportPage(1); }}
                  placeholder="Search subject, email, name..."
                  className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary"
                />
              </div>
              <div className="flex-1 min-w-[140px]">
                <label className="mb-1 block text-xs font-medium">Status</label>
                <select value={supportStatus} onChange={(e) => { setSupportStatus(e.target.value); setSupportPage(1); }} className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary">
                  <option value="">All</option>
                  <option value="OPEN">Open</option>
                  <option value="IN_PROGRESS">In Progress</option>
                  <option value="RESOLVED">Resolved</option>
                  <option value="CLOSED">Closed</option>
                </select>
              </div>
              <div className="flex-1 min-w-[140px]">
                <label className="mb-1 block text-xs font-medium">Category</label>
                <select value={supportCategory} onChange={(e) => { setSupportCategory(e.target.value); setSupportPage(1); }} className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary">
                  <option value="">All</option>
                  <option value="GENERAL">General</option>
                  <option value="TECHNICAL">Technical</option>
                  <option value="BILLING">Billing</option>
                  <option value="CONTENT">Content</option>
                  <option value="FEATURE_REQUEST">Feature Request</option>
                  <option value="BUG_REPORT">Bug Report</option>
                  <option value="ACCOUNT">Account</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="mb-1 block text-xs font-medium">Priority</label>
                <select value={supportPriority} onChange={(e) => { setSupportPriority(e.target.value); setSupportPage(1); }} className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary">
                  <option value="">All</option>
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </div>
            </div>

            {/* Tickets Table */}
            <div className="flex-1 overflow-auto rounded-xl border border-border bg-card">
              {supportLoading ? (
                <div className="flex items-center justify-center h-64">Loading...</div>
              ) : supportTickets.length === 0 ? (
                <div className="flex items-center justify-center h-64 text-muted-foreground">No tickets found</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Subject</th>
                      <th className="px-3 py-2 text-left font-medium">User</th>
                      <th className="px-3 py-2 text-left font-medium">Category</th>
                      <th className="px-3 py-2 text-left font-medium">Priority</th>
                      <th className="px-3 py-2 text-left font-medium">Status</th>
                      <th className="px-3 py-2 text-left font-medium">Created</th>
                      <th className="px-3 py-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {supportTickets.map((t) => (
                      <tr key={t.id} className="border-t border-border hover:bg-muted/50 cursor-pointer" onClick={() => setSelectedTicket(t)}>
                        <td className="px-3 py-2">
                          <div className="font-medium max-w-xs truncate" title={t.subject}>{t.subject}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-xs">{t.description}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{t.user.fullName}</div>
                          <div className="text-xs text-muted-foreground">{t.user.email}</div>
                          <div className="text-xs">{roleBadge(t.user.role)}</div>
                        </td>
                        <td className="px-3 py-2 text-xs">{t.category}</td>
                        <td className="px-3 py-2">
                          <span className={`badge ${priorityColors[t.priority] || "bg-muted text-muted-foreground"}`}>{t.priority}</span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`badge ${statusColors[t.status] || "bg-muted text-muted-foreground"}`}>{t.status}</span>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleDateString()}</td>
                        <td className="px-3 py-2 text-right">
                          <button onClick={(e) => { e.stopPropagation(); setSelectedTicket(t); }} className="rounded border border-border px-2 py-1 text-xs hover:bg-muted">View</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="px-3 py-2 border-t border-border flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Page {supportPage} of {Math.ceil(supportTotal / supportLimit)} — {supportTotal} total</span>
                <div className="flex gap-2">
                  <button onClick={() => setSupportPage(p => Math.max(1, p - 1))} disabled={supportPage === 1} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50">Prev</button>
                  <button onClick={() => setSupportPage(p => Math.min(Math.ceil(supportTotal / supportLimit), p + 1))} disabled={supportPage === Math.ceil(supportTotal / supportLimit)} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50">Next</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ticket Detail & Reply Modal */}
      {selectedTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setSelectedTicket(null); setReplyText(""); }}>
          <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold">{selectedTicket.subject}</h2>
                <div className="mt-1 flex items-center gap-2 text-sm flex-wrap">
                  <span className={`badge ${statusColors[selectedTicket.status] || "bg-muted text-muted-foreground"}`}>{selectedTicket.status}</span>
                  <span className={`badge ${priorityColors[selectedTicket.priority] || "bg-muted text-muted-foreground"}`}>{selectedTicket.priority}</span>
                  <span className="badge bg-muted text-muted-foreground">{selectedTicket.category}</span>
                </div>
              </div>
              <button onClick={() => { setSelectedTicket(null); setReplyText(""); }} className="rounded-lg border border-border p-2 hover:bg-muted">✕</button>
            </div>

            <div className="mt-4 border-t border-border pt-4">
              <h3 className="font-medium">User Details</h3>
              <div className="mt-2 text-sm space-y-1">
                <div><span className="font-medium">Name:</span> {selectedTicket.user.fullName}</div>
                <div><span className="font-medium">Email:</span> {selectedTicket.user.email}</div>
                <div><span className="font-medium">Role:</span> {roleBadge(selectedTicket.user.role)}</div>
                {selectedTicket.user.phone && <div><span className="font-medium">Phone:</span> {selectedTicket.user.phone}</div>}
              </div>
            </div>

            <div className="mt-4 border-t border-border pt-4">
              <h3 className="font-medium">Description</h3>
              <p className="mt-2 text-sm whitespace-pre-wrap">{selectedTicket.description}</p>
            </div>

            {selectedTicket.adminNotes && (
              <div className="mt-4 border-t border-border pt-4">
                <h3 className="font-medium">Admin Notes / Replies</h3>
                <div className="mt-2 text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded-lg">{selectedTicket.adminNotes}</div>
              </div>
            )}

            <div className="mt-4 border-t border-border pt-4">
              <h3 className="font-medium">Reply to User</h3>
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Type your reply..."
                rows={4}
                className="mt-2 w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary resize-none"
              />
              <div className="mt-3 flex gap-2">
                <select
                  value={selectedTicket.status}
                  onChange={(e) => updateTicketStatus(selectedTicket.id, e.target.value)}
                  className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
                >
                  <option value="OPEN">Open</option>
                  <option value="IN_PROGRESS">In Progress</option>
                  <option value="RESOLVED">Resolved</option>
                  <option value="CLOSED">Closed</option>
                </select>
                <button onClick={() => replyToTicket(selectedTicket.id)} disabled={!replyText.trim()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">Send Reply</button>
              </div>
            </div>

            <div className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">
              <div>Created: {new Date(selectedTicket.createdAt).toLocaleString()}</div>
              <div>Updated: {new Date(selectedTicket.updatedAt).toLocaleString()}</div>
              {selectedTicket.resolvedAt && <div>Resolved: {new Date(selectedTicket.resolvedAt).toLocaleString()} by {selectedTicket.resolvedBy}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}