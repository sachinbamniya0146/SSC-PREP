"use client";

import * as React from "react";

type ReferralStat = {
  totalReferrals: number;
  paidReferrals: number;
  totalPurchases: number;
  rewardThreshold: number;
  progressPercent: number;
  rewarded: boolean;
};

export default function ReferralPage() {
  const [code, setCode] = React.useState("");
  const [shareLink, setShareLink] = React.useState("");
  const [stats, setStats] = React.useState<ReferralStat | null>(null);
  const [refs, setRefs] = React.useState<
    { id: string; refereeName: string; purchases: number; status: string }[]
  >([]);
  const [loading, setLoading] = React.useState(true);

  const load = async () => {
      const token = typeof window !== 'undefined' ? localStorage.getItem("ssc_access_token") : null;
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1"}/referral/me`, {
          headers: token ? { Authorization: `Bearer ${token}` } as HeadersInit : {},
        });
        if (res.ok) {
          const d = await res.json();
          setCode(d.referralCode);
          setShareLink(d.shareLink);
          setStats(d.stats);
          setRefs(d.referrals);
        }
      } finally {
        setLoading(false);
      }
  };

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        shareLink || `https://sscprephub.in/register?ref=${code}`,
      );
      alert("🔗 Referral link copied! Share with friends.");
    } catch {
      /* ignore */
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
        <h1 className="text-2xl font-bold">Refer &amp; Earn 🎁</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Get{" "}
          <span className="font-semibold text-primary">
            FREE 30-day subscription
          </span>{" "}
          when 10 friends make a paid purchase using your code.
        </p>

        {loading && <p className="mt-8 text-muted-foreground">Loading your referral stats…</p>}

        {!loading && (
          <>
            {stats && (
              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                <div className="card p-5">
                  <p className="text-xs text-muted-foreground">Total Referred</p>
                  <p className="mt-1 text-3xl font-bold">{stats.totalReferrals}</p>
                </div>
                <div className="card p-5">
                  <p className="text-xs text-muted-foreground">Paid Referrals ✅</p>
                  <p className="mt-1 text-3xl font-bold">
                    {stats.paidReferrals}
                    <span className="text-sm font-normal text-muted-foreground"> / {stats.rewardThreshold}</span>
                  </p>
                </div>
                <div className="card p-5">
                  <p className="text-xs text-muted-foreground">Total Purchases (₹)</p>
                  <p className="mt-1 text-3xl font-bold">{stats.totalPurchases}</p>
                </div>
              </div>
            )}

            {stats && (
              <div className="card mt-6 p-5">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span>Reward progress</span>
                  <span className="font-semibold">{stats.progressPercent}%</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all"
                    style={{ width: `${Math.min(stats.progressPercent, 100)}%` }}
                  />
                </div>
                {stats.rewarded ? (
                  <p className="mt-3 text-sm font-semibold text-success">
                    🎉 You&apos;ve earned your FREE subscription!
                  </p>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Only <b>paid test purchases</b> count toward the reward. Need{" "}
                    {Math.max(0, stats.rewardThreshold - stats.paidReferrals)} more to unlock.
                  </p>
                )}
              </div>
            )}

            {code && (
              <div className="card mt-6 p-5">
                <p className="text-sm text-muted-foreground">Your referral code</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-2xl font-black tracking-widest text-primary">
                    {code}
                  </span>
                  <button
                    onClick={copyLink}
                    className="btn bg-primary text-primary-foreground hover:opacity-90"
                  >
                    📋 Copy Share Link
                  </button>
                </div>
                <p className="mt-3 break-all text-xs text-muted-foreground">{shareLink}</p>
              </div>
            )}

            <div className="mt-8">
              <h2 className="text-lg font-semibold">People you referred</h2>
              {refs.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  No referrals yet. Share your code to start earning!
                </p>
              ) : (
                <div className="mt-3 divide-y divide-border rounded-2xl border border-border bg-card">
                  {refs.map((r) => (
                    <div key={r.id} className="flex items-center justify-between px-5 py-4">
                      <div>
                        <p className="font-medium">{r.refereeName}</p>
                        <p className="text-xs text-muted-foreground">{r.purchases} paid purchase(s)</p>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          r.status === "REWARDED"
                            ? "bg-success/20 text-success"
                            : r.status === "PAIDED"
                              ? "bg-warning/20 text-warning"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {r.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}