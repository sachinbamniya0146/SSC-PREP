"use client";

import * as React from "react";
import { ThemeContext } from "@/components/theme-provider";
import { api, authHeaders } from "@/lib/api";

const TELEGRAM_TYPES: { type: string; label: string }[] = [
  { type: "daily_practice", label: "Daily Practice Question" },
  { type: "mock_results", label: "Mock Test Results" },
  { type: "leaderboard", label: "Leaderboard / Rank Updates" },
  { type: "announcements", label: "Announcements" },
];

interface TelegramAccount {
  chatId: string;
  username?: string | null;
  firstName?: string | null;
  isActive: boolean;
  subscriptions: { type: string; isActive: boolean }[];
}

interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: string;
  phone?: string | null;
  isEmailVerified: boolean;
  createdAt: string;
  _count: { testAttempts: number; bookmarks: number };
  subscriptions: { status: string; endsAt: string | null; planId: string }[];
}

export default function ProfilePage() {
  const { theme, toggleTheme } = React.useContext(ThemeContext);
  const [user, setUser] = React.useState<UserProfile | null>(null);
  const [phone, setPhone] = React.useState("");
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [showCurrentPassword, setShowCurrentPassword] = React.useState(false);
  const [showNewPassword, setShowNewPassword] = React.useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = React.useState(false);
  const [error, setError] = React.useState("");
  const [info, setInfo] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const [telegram, setTelegram] = React.useState<TelegramAccount | null | undefined>(undefined);
  const [chatIdInput, setChatIdInput] = React.useState("");
  const [tgLinking, setTgLinking] = React.useState(false);
  const [tgError, setTgError] = React.useState("");
  const [tgBusyType, setTgBusyType] = React.useState<string | null>(null);

  async function loadTelegram() {
    try {
      const data = await api<TelegramAccount | null>("/telegram/account", { headers: authHeaders() });
      setTelegram(data);
    } catch (err) {
      console.error("Failed to load Telegram account", err);
      setTelegram(null);
    }
  }

  async function linkTelegram() {
    const chatId = Number(chatIdInput.trim());
    if (!chatIdInput.trim() || Number.isNaN(chatId)) {
      setTgError("Enter a valid numeric Telegram Chat ID");
      return;
    }
    setTgLinking(true);
    setTgError("");
    try {
      await api("/telegram/link", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ chatId }),
      });
      setChatIdInput("");
      await loadTelegram();
    } catch (err) {
      setTgError(err instanceof Error ? err.message : "Failed to link Telegram account");
    } finally {
      setTgLinking(false);
    }
  }

  async function toggleSubscription(type: string, currentlyOn: boolean) {
    setTgBusyType(type);
    setTgError("");
    try {
      const res = await api<{ ok: boolean; error?: string }>(
        `/telegram/${currentlyOn ? "unsubscribe" : "subscribe"}/${type}`,
        { method: "POST", headers: authHeaders() },
      );
      if (!res.ok) setTgError(res.error || "Failed to update subscription");
      await loadTelegram();
    } catch (err) {
      setTgError(err instanceof Error ? err.message : "Failed to update subscription");
    } finally {
      setTgBusyType(null);
    }
  }

  async function loadProfile() {
    try {
      const token = localStorage.getItem("ssc_access_token");
      if (!token) return;
      const data = await api<{ user: UserProfile; entitlements: any }>("/auth/me", { headers: { Authorization: `Bearer ${token}` } });
      setUser(data.user);
      if (data.user.phone) setPhone(data.user.phone);
    } catch (err) {
      console.error("Failed to load profile", err);
    }
  }

  async function updatePhone() {
    if (!phone || phone.length < 10) {
      setError("Mobile number must be at least 10 digits");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const token = localStorage.getItem("ssc_access_token");
      await api("/users/me/phone", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      setInfo("Mobile number updated successfully");
      loadProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update mobile number");
    } finally {
      setSaving(false);
    }
  }

  async function changePassword() {
    if (newPassword.length < 6 || newPassword.length > 20) {
      setError("New password must be between 6 and 20 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirm password do not match");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const token = localStorage.getItem("ssc_access_token");
      await api("/auth/password/change", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      setInfo("Password changed successfully. Please login again.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => { localStorage.clear(); window.location.href = "/login"; }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setSaving(false);
    }
  }

  React.useEffect(() => {
    loadProfile();
  }, []);

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-xl">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <span className="text-lg font-bold">
            SSC<span className="text-primary">PrepHub</span>
          </span>
          <div className="flex items-center gap-3 text-sm">
            <button onClick={toggleTheme} aria-label="Toggle theme" className="rounded-lg border border-border p-2 text-sm">
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
            <a href="/dashboard" className="rounded-lg border border-border px-4 py-2 font-semibold hover:bg-muted">Dashboard</a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold">👤 My Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your account settings and preferences</p>

        {error && <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">{error}</div>}
        {info && <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">{info}</div>}

        {/* Account Info */}
        <div className="mt-6 rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Account Information</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Full Name</label>
              <p className="mt-1 text-sm font-medium">{user.fullName}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Email</label>
              <p className="mt-1 text-sm font-medium">{user.email}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Role</label>
              <p className="mt-1 text-sm font-medium">{user.role}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Email Status</label>
              <p className="mt-1 text-sm font-medium">{user.isEmailVerified ? "✅ Verified" : "⏳ Pending Verification"}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Member Since</label>
              <p className="mt-1 text-sm font-medium">{new Date(user.createdAt).toLocaleDateString()}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Tests Taken</label>
              <p className="mt-1 text-sm font-medium">{user._count.testAttempts}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Bookmarks</label>
              <p className="mt-1 text-sm font-medium">{user._count.bookmarks}</p>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Active Subscriptions</label>
              <p className="mt-1 text-sm font-medium">
                {user.subscriptions.length > 0
                  ? user.subscriptions
                      .filter((s) => s.status === "ACTIVE")
                      .map((s) => `${s.planId} (until ${s.endsAt ? new Date(s.endsAt).toLocaleDateString() : "N/A"})`)
                      .join(", ")
                  : "Free Tier"}
              </p>
            </div>
          </div>
        </div>

        {/* Mobile Number - Mandatory */}
        <div className="mt-6 rounded-xl border border-border bg-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">📱 Mobile Number <span className="text-red-500">*</span></h2>
            <span className="text-xs text-muted-foreground">Required for account security & notifications</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[250px]">
              <label className="mb-1.5 block text-sm font-medium">Mobile Number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 9876543210"
                className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                inputMode="numeric"
                required
              />
            </div>
            <button onClick={updatePhone} disabled={saving || phone.length < 10} className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {saving ? "Saving…" : "Update Mobile"}
            </button>
          </div>
          {user.phone ? (
            <p className="mt-2 text-xs text-muted-foreground">Current: {user.phone}</p>
          ) : (
            <p className="mt-2 text-xs text-red-500">⚠️ Mobile number is mandatory. Please add your mobile number.</p>
          )}
        </div>

        {/* Change Password */}
        <div className="mt-6 rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">🔐 Change Password</h2>
          <p className="mt-1 text-sm text-muted-foreground">Password must be between 6 and 20 characters</p>
          <div className="mt-4 space-y-4 max-w-md">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Current Password</label>
              <div className="relative">
                <input
                  type={showCurrentPassword ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Current password"
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showCurrentPassword ? "👁️" : "🔒"}
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">New Password</label>
              <div className="relative">
                <input
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="6-20 characters"
                  minLength={6}
                  maxLength={20}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showNewPassword ? "👁️" : "🔒"}
                </button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{newPassword.length}/20 characters (min 6)</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Confirm New Password</label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  minLength={6}
                  maxLength={20}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showConfirmPassword ? "👁️" : "🔒"}
                </button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{confirmPassword.length}/20 characters (min 6)</p>
              {confirmPassword && newPassword !== confirmPassword && (
                <p className="mt-1 text-xs text-red-500">⚠️ Passwords do not match</p>
              )}
            </div>
            <button onClick={changePassword} disabled={saving || !currentPassword || newPassword.length < 6 || newPassword.length > 20 || newPassword !== confirmPassword} className="rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {saving ? "Changing…" : "Change Password"}
            </button>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/5 p-6">
          <h2 className="text-lg font-semibold text-red-500">⚠️ Danger Zone</h2>
          <p className="mt-2 text-sm text-muted-foreground">These actions are irreversible</p>
          <div className="mt-4 flex gap-4">
            <button className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-600 hover:bg-red-500/20">
              Delete Account
            </button>
            <a href="/login" onClick={() => localStorage.clear()} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted">Logout</a>
          </div>
        </div>
      </main>
    </div>
  );
}
