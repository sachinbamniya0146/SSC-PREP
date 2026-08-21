"use client";

import * as React from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from "chart.js";
import { Bar, Doughnut } from "react-chartjs-2";
import { AppHeader } from "@/components/app-header";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
);

type Achievement = {
  id: string;
  key: string;
  name: string;
  nameHindi?: string | null;
  description: string;
  descriptionHindi?: string | null;
  icon: string;
  tier: "BRONZE" | "SILVER" | "GOLD" | "PLATINUM" | "DIAMOND";
  xpReward: number;
  coinReward: number;
  criteria: { metric: string; threshold: number };
  sortOrder: number;
};

type UserAchievement = {
  id: string;
  userId: string;
  achievementId: string;
  earnedAt: string;
  progress: number;
  notified: boolean;
  achievement: Achievement;
};

type TierConfig = {
  color: string;
  bg: string;
  label: string;
};

const TIER_CONFIG: Record<string, TierConfig> = {
  BRONZE: { color: "text-amber-600", bg: "bg-amber-100", label: "Bronze" },
  SILVER: { color: "text-slate-600", bg: "bg-slate-100", label: "Silver" },
  GOLD: { color: "text-yellow-600", bg: "bg-yellow-100", label: "Gold" },
  PLATINUM: { color: "text-purple-600", bg: "bg-purple-100", label: "Platinum" },
  DIAMOND: { color: "text-cyan-600", bg: "bg-cyan-100", label: "Diamond" },
};

const TIER_ORDER = ["DIAMOND", "PLATINUM", "GOLD", "SILVER", "BRONZE"];

export default function AchievementsPage() {
  const [earned, setEarned] = React.useState<UserAchievement[]>([]);
  const [allAchievements, setAllAchievements] = React.useState<Achievement[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [activeTab, setActiveTab] = React.useState<"earned" | "progress" | "all">("earned");

  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
  const headers = (): Record<string, string> => {
    const token = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const load = async () => {
    setLoading(true);
    try {
      const [earnedRes, allRes] = await Promise.all([
        fetch(`${apiBase}/achievements/me`, { headers: headers() }),
        fetch(`${apiBase}/achievements`, { headers: headers() }),
      ]);

      if (earnedRes.ok) {
        const data = await earnedRes.json();
        setEarned(data.achievements || []);
      }
      if (allRes.ok) {
        const data = await allRes.json();
        setAllAchievements(data.achievements || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    load();
  }, []);

  const getProgress = (achievement: Achievement, userAchievement?: UserAchievement) => {
    if (userAchievement) return 100;
    // For demo, return 0 since we don't have the actual progress from backend
    return 0;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const earnedCount = earned.length;
  const totalCount = allAchievements.length;
  const completionPercent = totalCount > 0 ? Math.round((earnedCount / totalCount) * 100) : 0;

  const earnedByTier = earned.reduce((acc, ua) => {
    const tier = ua.achievement.tier;
    acc[tier] = (acc[tier] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const progressData = {
    labels: TIER_ORDER,
    datasets: [
      {
        label: "Earned",
        data: TIER_ORDER.map((t) => earnedByTier[t] || 0),
        backgroundColor: [
          "rgba(6, 182, 212, 0.8)", // Diamond
          "rgba(168, 85, 247, 0.8)", // Platinum
          "rgba(234, 179, 8, 0.8)", // Gold
          "rgba(100, 116, 139, 0.8)", // Silver
          "rgba(217, 119, 6, 0.8)", // Bronze
        ],
      },
    ],
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🏆</div>
          <p className="text-muted-foreground">Loading achievements...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader showSupport={true} />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Achievements & Badges</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Earn badges for streaks, XP milestones, accuracy, and more. Unlock tiers from Bronze to Diamond!
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-4 mb-8">
          <div className="card p-5 text-center">
            <p className="text-3xl font-bold text-primary">{earnedCount}</p>
            <p className="text-sm text-muted-foreground">Earned</p>
          </div>
          <div className="card p-5 text-center">
            <p className="text-3xl font-bold text-muted-foreground">{totalCount}</p>
            <p className="text-sm text-muted-foreground">Total Badges</p>
          </div>
          <div className="card p-5 text-center">
            <p className="text-3xl font-bold text-success">{completionPercent}%</p>
            <p className="text-sm text-muted-foreground">Completion</p>
          </div>
          <div className="card p-5 text-center">
            <p className="text-3xl font-bold text-accent">{earned.reduce((sum, ua) => sum + ua.achievement.xpReward, 0)}</p>
            <p className="text-sm text-muted-foreground">Bonus XP</p>
          </div>
        </div>

        <div className="card mb-6">
          <div className="p-5">
            <h2 className="text-lg font-semibold mb-4">Progress by Tier</h2>
            <div className="h-64">
              <Bar
                data={progressData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  indexAxis: "y",
                  plugins: {
                    legend: { display: false },
                  },
                  scales: {
                    x: { beginAtZero: true, max: Math.max(...progressData.datasets[0].data, 1) },
                  },
                }}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2 mb-6 border-b border-border">
          {(["earned", "progress", "all"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition ${
                activeTab === tab
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "earned" && `✅ Earned (${earned.length})`}
              {tab === "progress" && `📈 In Progress`}
              {tab === "all" && `📋 All Badges (${allAchievements.length})`}
            </button>
          ))}
        </div>

        {activeTab === "earned" && earned.length === 0 && (
          <div className="card p-10 text-center">
            <p className="text-4xl mb-3">🏆</p>
            <h2 className="text-xl font-bold mb-2">No badges earned yet</h2>
            <p className="text-muted-foreground mb-6">
              Start practicing to unlock your first badge! Try the Daily Quiz or take a mock test.
            </p>
            <a href="/quiz" className="btn btn-primary inline-block">
              Take Daily Quiz →
            </a>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(activeTab === "earned" ? earned : activeTab === "progress" ? allAchievements.filter((a) => !earned.some((e) => e.achievementId === a.id)) : allAchievements).map((item) => {
            const isEarned = "earnedAt" in item;
            const achievement = isEarned ? item.achievement : item;
            const userAchievement = isEarned ? item : undefined;
            const config = TIER_CONFIG[achievement.tier];
            const progress = getProgress(achievement, userAchievement);

            return (
              <div
                key={achievement.id}
                className={`card p-4 transition-all hover:shadow-lg ${
                  isEarned ? "" : "opacity-60 grayscale"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{achievement.icon}</span>
                    <div>
                      <h3 className="font-semibold">{achievement.name}</h3>
                      {achievement.nameHindi && (
                        <p className="text-xs text-muted-foreground">{achievement.nameHindi}</p>
                      )}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${config.bg} ${config.color}`}
                  >
                    {config.label}
                  </span>
                </div>

                <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                  {achievement.description}
                  {achievement.descriptionHindi && (
                    <span className="block mt-1 text-xs">🇮🇳 {achievement.descriptionHindi}</span>
                  )}
                </p>

                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>XP: +{achievement.xpReward}</span>
                  <span>Coins: +{achievement.coinReward}</span>
                </div>

                {isEarned && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-xs text-success font-medium">
                      ✅ Earned on {formatDate(userAchievement!.earnedAt)}
                    </p>
                  </div>
                )}

                {!isEarned && (
                  <div className="mt-3">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground text-right">
                      {progress}% progress
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {(activeTab === "earned" ? earned : activeTab === "progress" ? allAchievements.filter((a) => !earned.some((e) => e.achievementId === a.id)) : allAchievements).length === 0 && (
          <div className="card p-10 text-center">
            <p className="text-muted-foreground">No badges in this category.</p>
          </div>
        )}
      </main>
    </div>
  );
}