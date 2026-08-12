"use client";

import * as React from "react";

type Mock = {
  id: string;
  title: string;
  description?: string | null;
  type: string;
  durationMinutes: number;
  totalQuestions: number;
  totalMarks: number;
  free: boolean;
  locked: boolean;
  reason?: string;
  offerPriceInr?: number;
  offerDays?: number;
};

export default function MocksPage() {
  const [mocks, setMocks] = React.useState<Mock[]>([]);
  const [offer, setOffer] = React.useState<{ active: boolean; priceInr: number; days: number; message: string } | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = async () => {
    const token = localStorage.getItem("ssc_access_token");
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1"}/mocks`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        const d = await res.json();
        setMocks(d.mockAccess);
        setOffer(d.offer);
      }
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const purchase = async (m: Mock) => {
    const token = localStorage.getItem("ssc_access_token");
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1"}/mocks/purchase`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ testTemplateId: m.id }),
      },
    );
    if (res.ok) {
      alert(`✅ Mock unlocked! ₹${m.offerPriceInr} for ${m.offerDays} days access.`);
      load();
    } else {
      alert("⚠️ Payment failed. Try again.");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">
            ← <span className="text-primary">SSC</span>PrepHub
          </a>
          <a href="/dashboard" className="btn btn-outline text-sm">
            Back to Dashboard
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-bold">Mock Tests 🎯</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          2 free mocks per test · Previous-year mocks are always FREE · unlock more for just
          ₹{offer?.priceInr ?? 10} for {offer?.days ?? 15} days!
        </p>

        {loading && <p className="mt-8 text-muted-foreground">Loading mocks…</p>}

        {!loading && offer && (
          <div className="card mt-6 border-success/30 bg-success/5 p-5">
            <p className="font-semibold text-success">🔥 Special Offer</p>
            <p className="mt-1 text-sm text-muted-foreground">{offer.message}</p>
          </div>
        )}

        {!loading && (
          <div className="mt-6 space-y-4">
            {mocks.length === 0 && (
              <p className="card p-6 text-center text-sm text-muted-foreground">
                No mock tests available yet — the question bank is being loaded. Practice daily
                quizzes in the meantime!
              </p>
            )}
            {mocks.map((m) => (
              <div
                key={m.id}
                className="card flex flex-wrap items-center justify-between gap-3 p-5"
              >
                <div>
                  <p className="font-semibold">{m.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {m.totalQuestions} questions · {m.durationMinutes} min · {m.totalMarks} marks ·{" "}
                    {m.type}
                  </p>
                  {m.free ? (
                    <span className="mt-2 inline-block rounded-full bg-success/20 px-3 py-1 text-xs font-semibold text-success">
                      FREE {m.reason?.startsWith("FREE_") ? "(2 free per mock)" : ""}
                    </span>
                  ) : (
                    <span className="mt-2 inline-block rounded-full bg-primary/20 px-3 py-1 text-xs font-semibold text-primary">
                      🔒 Locked · ₹{m.offerPriceInr}/{m.offerDays} days
                    </span>
                  )}
                </div>
                {m.free ? (
                  <a
                    href={`/test?template=${encodeURIComponent(m.id)}`}
                    className="btn bg-success text-success-foreground hover:opacity-90"
                  >
                    Start Mock
                  </a>
                ) : (
                  <button
                    onClick={() => purchase(m)}
                    className="btn bg-primary text-primary-foreground hover:opacity-90"
                  >
                    Unlock for ₹{m.offerPriceInr}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}