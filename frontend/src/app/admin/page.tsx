"use client";

import * as React from "react";

export default function AdminPage() {
  const [tab, setTab] = React.useState<"dashboard" | "questions" | "import">("dashboard");
  const [user, setUser] = React.useState<any>(null);
  const [stats, setStats] = React.useState<any>(null);

  React.useEffect(() => {
    const raw = localStorage.getItem("ssc_user");
    if (raw) {
      try { setUser(JSON.parse(raw)); } catch {}
    }
    loadStats();
  }, []);

  const loadStats = async () => {
    const token = localStorage.getItem("ssc_access_token");
    try {
      const r = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1"}/bank/meta`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (r.ok) setStats(await r.json());
    } catch {}
  };

  if (!user || user.role !== "ADMIN") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="card p-8 text-center">
          <p className="text-2xl">🔒</p>
          <h1 className="mt-3 text-xl font-bold">Admin Access Only</h1>
          <p className="mt-2 text-sm text-muted-foreground">Login with an admin account.</p>
          <a href="/login" className="btn btn-primary mt-4 inline-block">Login</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <span className="text-lg font-bold">⚙️ SSC<span className="text-primary">PrepHub</span> Admin</span>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{user.fullName}</span>
            <a href="/dashboard" className="btn btn-outline">Dashboard</a>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-8">
        {/* Sidebar */}
        <aside className="w-56 shrink-0">
          <nav className="space-y-1">
            {[
              { id: "dashboard" as const, label: "📊 Dashboard", icon: "📊" },
              { id: "questions" as const, label: "📝 Questions", icon: "📝" },
              { id: "import" as const, label: "📤 Import PDF", icon: "📤" },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`w-full rounded-lg px-4 py-2.5 text-left text-sm font-medium transition ${
                  tab === t.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <main className="min-w-0 flex-1">
          {tab === "dashboard" && (
            <div>
              <h1 className="text-2xl font-bold">Admin Dashboard</h1>
              <p className="mt-1 text-sm text-muted-foreground">Platform overview</p>
              
              {stats && (
                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                  <div className="card p-5">
                    <p className="text-xs text-muted-foreground">Total Questions</p>
                    <p className="mt-1 text-3xl font-bold">{stats.totalQuestions}</p>
                  </div>
                  <div className="card p-5">
                    <p className="text-xs text-muted-foreground">Exams</p>
                    <p className="mt-1 text-3xl font-bold">{stats.exams?.length || 0}</p>
                  </div>
                  <div className="card p-5">
                    <p className="text-xs text-muted-foreground">Hindi Coverage</p>
                    <p className="mt-1 text-3xl font-bold">{stats.approxHindiCovered}</p>
                  </div>
                </div>
              )}

              <div className="card mt-8 p-6">
                <h2 className="font-semibold">Quick Actions</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <a href="/question-bank" className="card p-4 text-center hover:border-primary">
                    <p className="text-lg">📝</p>
                    <p className="mt-1 text-sm font-medium">Browse Question Bank</p>
                  </a>
                  <a href="/discover" className="card p-4 text-center hover:border-primary">
                    <p className="text-lg">🔍</p>
                    <p className="mt-1 text-sm font-medium">Discovery Page</p>
                  </a>
                </div>
              </div>
            </div>
          )}

          {tab === "questions" && (
            <div>
              <h1 className="text-2xl font-bold">Questions</h1>
              <p className="mt-1 text-sm text-muted-foreground">Browse and manage questions</p>
              <iframe src="/question-bank" className="mt-4 h-[70vh] w-full rounded-xl border border-border" />
            </div>
          )}

          {tab === "import" && (
            <div>
              <h1 className="text-2xl font-bold">Import PDF</h1>
              <p className="mt-1 text-sm text-muted-foreground">Upload PDFs to extract questions</p>
              <div className="card mt-6 p-8 text-center">
                <p className="text-4xl">📄</p>
                <p className="mt-3 font-semibold">PDF Ingestion Pipeline</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Coming in Phase 3. For now, questions are imported via the seed script.
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}