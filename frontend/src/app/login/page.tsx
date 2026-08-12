"use client";

import * as React from "react";
import { ThemeContext } from "@/components/theme-provider";
import { api } from "@/lib/api";

type AuthResponse = {
  user: { id: string; email: string; fullName: string; role: string };
  accessToken: string;
  refreshToken: string;
};

export default function LoginPage() {
  const { theme, toggleTheme } = React.useContext(ThemeContext);
  const [mode, setMode] = React.useState<"login" | "otp" | "forgot">("login");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [otp, setOtp] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [info, setInfo] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  // Google Sign-In (Google Identity Services) — visible only when the server
  // has GOOGLE_CLIENT_ID configured (NEXT_PUBLIC_GOOGLE_CLIENT_ID).
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

  const handleGoogleCredential = React.useCallback(async (credential: string) => {
    setError(""); setLoading(true);
    try {
      const data = await api<AuthResponse>("/auth/google", {
        method: "POST",
        body: JSON.stringify({ idToken: credential, platform: "WEB" }),
      });
      localStorage.setItem("ssc_access_token", data.accessToken);
      localStorage.setItem("ssc_refresh_token", data.refreshToken);
      localStorage.setItem("ssc_user", JSON.stringify(data.user));
      window.location.href = "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google login failed");
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!googleClientId) return;
    const existing = document.getElementById("gsi-script");
    if (existing) return;
    const s = document.createElement("script");
    s.id = "gsi-script";
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => {
      const g = (window as any).google;
      if (!g?.accounts?.id) return;
      g.accounts.id.initialize({
        client_id: googleClientId,
        callback: (resp: any) => handleGoogleCredential(resp?.credential ?? ""),
        auto_select: false,
      });
      const el = document.getElementById("google-signin-btn");
      if (el) g.accounts.id.renderButton(el, { theme: "outline", size: "large", width: 320, shape: "pill" });
    };
    document.head.appendChild(s);
  }, [googleClientId, handleGoogleCredential]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api<AuthResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, platform: "WEB" }),
      });
      localStorage.setItem("ssc_access_token", data.accessToken);
      localStorage.setItem("ssc_refresh_token", data.refreshToken);
      localStorage.setItem("ssc_user", JSON.stringify(data.user));
      window.location.href = "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function requestOtp() {
    setError("");
    setInfo("");
    setLoading(true);
    try {
      await api("/auth/otp/request", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setInfo("OTP sent to your email (dev: check server log / demo OTP 123456).");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send OTP");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api<AuthResponse>("/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify({ email, otp }),
      });
      localStorage.setItem("ssc_access_token", data.accessToken);
      localStorage.setItem("ssc_refresh_token", data.refreshToken);
      localStorage.setItem("ssc_user", JSON.stringify(data.user));
      window.location.href = "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid OTP");
    } finally {
      setLoading(false);
    }
  }

  async function requestForgot() {
    setError("");
    setInfo("");
    setLoading(true);
    try {
      await api("/auth/password/forgot", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setInfo("Reset OTP sent to your email. Enter it with your new password below.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send reset OTP");
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api("/auth/password/reset", {
        method: "POST",
        body: JSON.stringify({ email, otp, newPassword }),
      });
      setInfo("✅ Password updated. Login with your new password.");
      setMode("login");
      setPassword("");
      setOtp("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-xl">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-bold">
            {mode === "login" ? "Login to " : mode === "otp" ? "OTP Login " : "Reset Password "}
            <span className="text-primary">SSC Prep Hub</span>
          </h1>
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="rounded-lg border border-border p-2 text-sm"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>

        {/* Mode tabs */}
        <div className="mb-6 flex overflow-hidden rounded-lg border border-border text-sm">
          {(["login", "otp", "forgot"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(""); setInfo(""); }}
              className={`flex-1 px-3 py-2 capitalize ${
                mode === m ? "bg-primary font-semibold text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              {m === "login" ? "Password" : m === "otp" ? "OTP" : "Forgot"}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}
        {info && (
          <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
            {info}
          </div>
        )}

        {mode === "login" && (
          <>
            {googleClientId && (
              <>
                <div className="mb-4 flex justify-center" id="google-signin-btn" />
                <div className="mb-4 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
                </div>
              </>
            )}
            <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {loading ? "Signing in…" : "Login"}
            </button>
          </form>
          </>
        )}

        {mode === "otp" && (
          <form onSubmit={verifyOtp} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">OTP</label>
              <input
                type="text"
                required
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="6-digit OTP"
                className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
              />
            </div>
            <button
              type="button"
              onClick={requestOtp}
              disabled={loading || !email}
              className="w-full rounded-lg border border-primary/40 bg-primary/10 py-2.5 text-sm font-semibold text-primary hover:bg-primary/20 disabled:opacity-50"
            >
              {loading ? "Sending…" : "Send OTP"}
            </button>
            <button
              type="submit"
              disabled={loading || !otp}
              className="w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {loading ? "Verifying…" : "Verify & Login"}
            </button>
          </form>
        )}

        {mode === "forgot" && (
          <form onSubmit={resetPassword} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">OTP (from email)</label>
              <input
                type="text"
                required
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="6-digit OTP"
                className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">New Password</label>
              <input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="min 6 characters"
                className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
              />
            </div>
            <button
              type="button"
              onClick={requestForgot}
              disabled={loading || !email}
              className="w-full rounded-lg border border-primary/40 bg-primary/10 py-2.5 text-sm font-semibold text-primary hover:bg-primary/20 disabled:opacity-50"
            >
              {loading ? "Sending…" : "Send Reset OTP"}
            </button>
            <button
              type="submit"
              disabled={loading || !otp || !newPassword}
              className="w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {loading ? "Resetting…" : "Reset Password"}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          New here?{" "}
          <a href="/signup" className="font-semibold text-primary">
            Create free account
          </a>
        </p>
      </div>
    </div>
  );
}
