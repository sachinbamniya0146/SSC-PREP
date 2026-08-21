"use client";

import * as React from "react";
import { ThemeContext } from "@/components/theme-provider";
import { api } from "@/lib/api";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";

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
}

function SupportContent() {
  const { theme, toggleTheme } = React.useContext(ThemeContext);
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [tickets, setTickets] = React.useState<SupportTicket[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [limit] = React.useState(10);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [info, setInfo] = React.useState("");
  const [selectedTicket, setSelectedTicket] = React.useState<SupportTicket | null>(null);
  const [showCreateModal, setShowCreateModal] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<"my" | "create">("my");

  // Form state
  const [formSubject, setFormSubject] = React.useState("");
  const [formDescription, setFormDescription] = React.useState("");
  const [formCategory, setFormCategory] = React.useState("GENERAL");
  const [formPriority, setFormPriority] = React.useState("MEDIUM");

  const categories = ["GENERAL", "TECHNICAL", "BILLING", "CONTENT", "FEATURE_REQUEST", "BUG_REPORT", "ACCOUNT", "OTHER"];
  const priorities = ["LOW", "MEDIUM", "HIGH", "URGENT"];

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

  const categoryLabels: Record<string, string> = {
    GENERAL: "General",
    TECHNICAL: "Technical Issue",
    BILLING: "Billing/Payment",
    CONTENT: "Content Issue",
    FEATURE_REQUEST: "Feature Request",
    BUG_REPORT: "Bug Report",
    ACCOUNT: "Account Issue",
    OTHER: "Other",
  };

  async function loadTickets() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.append("page", String(page));
      params.append("limit", String(limit));
      const data = await api<{ tickets: SupportTicket[]; total: number }>(`/support/tickets?${params}`);
      setTickets(data.tickets);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }

  async function createTicket() {
    if (!formSubject.trim() || !formDescription.trim()) {
      setError("Subject and description are required");
      return;
    }
    setError("");
    try {
      await api("/support/tickets", {
        method: "POST",
        body: JSON.stringify({
          subject: formSubject,
          description: formDescription,
          category: formCategory,
          priority: formPriority,
        }),
      });
      setInfo("Ticket created successfully!");
      setShowCreateModal(false);
      setFormSubject("");
      setFormDescription("");
      loadTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create ticket");
    }
  }

  React.useEffect(() => {
    loadTickets();
  }, [page]);

  const statusBadge = (status: string) => (
    <span className={`badge ${statusColors[status] || "bg-muted text-muted-foreground"}`}>{status}</span>
  );

  const priorityBadge = (priority: string) => (
    <span className={`badge ${priorityColors[priority] || "bg-muted text-muted-foreground"}`}>{priority}</span>
  );

  return (
    <div className="min-h-screen bg-background">
      <AppHeader showSupport={true} />
      <main className="mx-auto max-w-4xl px-4 py-8">
        {/* Tab Navigation */}
        <div className="mb-6 flex gap-2 border-b border-border">
          <button
            onClick={() => setActiveTab("my")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "my" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            My Tickets
          </button>
          <button
            onClick={() => setActiveTab("create")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "create" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            Create Ticket
          </button>
        </div>

        {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">{error}</div>}
        {info && <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">{info}</div>}

        {/* Create Ticket Tab */}
        {activeTab === "create" && (
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-xl font-bold">Create Support Ticket</h2>
            <p className="mt-1 text-sm text-muted-foreground">Describe your issue and we'll get back to you as soon as possible.</p>
            
            <form onSubmit={(e) => { e.preventDefault(); createTicket(); }} className="mt-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Subject *</label>
                <input
                  type="text"
                  value={formSubject}
                  onChange={(e) => setFormSubject(e.target.value)}
                  placeholder="Brief summary of your issue"
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                  required
                />
              </div>
              
              <div>
                <label className="mb-1.5 block text-sm font-medium">Category</label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>{categoryLabels[cat]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium">Priority</label>
                <select
                  value={formPriority}
                  onChange={(e) => setFormPriority(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                >
                  {priorities.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium">Description *</label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Describe your issue in detail..."
                  rows={6}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary resize-none"
                  required
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button type="submit" className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
                  Submit Ticket
                </button>
              </div>
            </form>
          </div>
        )}

        {/* My Tickets Tab */}
        {activeTab === "my" && (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h1 className="text-2xl font-bold">My Support Tickets</h1>
              <button onClick={() => setActiveTab("create")} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
                New Ticket
              </button>
            </div>

            {tickets.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-12 text-center">
                <div className="text-4xl mb-4">📭</div>
                <h3 className="text-lg font-medium">No tickets yet</h3>
                <p className="mt-1 text-sm text-muted-foreground">Create your first support ticket to get help</p>
                <button onClick={() => setActiveTab("create")} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
                  Create Ticket
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">Subject</th>
                        <th className="px-4 py-3 text-left font-medium">Category</th>
                        <th className="px-4 py-3 text-left font-medium">Priority</th>
                        <th className="px-4 py-3 text-left font-medium">Status</th>
                        <th className="px-4 py-3 text-left font-medium">Created</th>
                        <th className="px-4 py-3 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tickets.map((t) => (
                        <tr key={t.id} className="border-t border-border hover:bg-muted/50 cursor-pointer" onClick={() => setSelectedTicket(t)}>
                          <td className="px-4 py-3">
                            <div className="font-medium">{t.subject}</div>
                            <div className="text-xs text-muted-foreground truncate max-w-xs">{t.description}</div>
                          </td>
                          <td className="px-4 py-3 text-xs">{categoryLabels[t.category] || t.category}</td>
                          <td className="px-4 py-3">{priorityBadge(t.priority)}</td>
                          <td className="px-4 py-3">{statusBadge(t.status)}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleDateString()}</td>
                          <td className="px-4 py-3 text-right">
                            <button onClick={(e) => { e.stopPropagation(); setSelectedTicket(t); }} className="rounded border border-border px-2 py-1 text-xs hover:bg-muted">View</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-3 border-t border-border flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Page {page} of {Math.ceil(total / limit)} — {total} total tickets</span>
                  <div className="flex gap-2">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="rounded border border-border px-3 py-1 text-sm disabled:opacity-50">Prev</button>
                    <button onClick={() => setPage(p => Math.min(Math.ceil(total / limit), p + 1))} disabled={page === Math.ceil(total / limit)} className="rounded border border-border px-3 py-1 text-sm disabled:opacity-50">Next</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Ticket Detail Modal */}
        {selectedTicket && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelectedTicket(null)}>
            <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-bold">{selectedTicket.subject}</h2>
                  <div className="mt-1 flex items-center gap-2 text-sm">
                    {statusBadge(selectedTicket.status)}
                    {priorityBadge(selectedTicket.priority)}
                    <span className="text-muted-foreground">{categoryLabels[selectedTicket.category] || selectedTicket.category}</span>
                  </div>
                </div>
                <button onClick={() => setSelectedTicket(null)} className="rounded-lg border border-border p-2 hover:bg-muted">✕</button>
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

              <div className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">
                <div>Created: {new Date(selectedTicket.createdAt).toLocaleString()}</div>
                <div>Updated: {new Date(selectedTicket.updatedAt).toLocaleString()}</div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function SupportPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center">Loading...</div>}>
      <SupportContent />
    </Suspense>
  );
}