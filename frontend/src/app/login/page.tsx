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
  const [showPassword, setShowPassword] = React.useState(false);
  const [otp, setOtp] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [showNewPassword, setShowNewPassword] = React.useState(false);
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
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  )}
                </button>
              </div>
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
              <div className="relative">
                <input
                  type={showNewPassword ? "text" : "password"}
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="min 6 characters"
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showNewPassword ? "Hide password" : "Show password"}
                >
                  {showNewPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  )}
                </button>
              </div>
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
