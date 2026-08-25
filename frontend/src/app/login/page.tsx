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
  const [mode, setMode] = React.useState<"login" | "forgot" | "forgot-verify">("login");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [otp, setOtp] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [showNewPassword, setShowNewPassword] = React.useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = React.useState(false);
  const [info, setInfo] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [otpCooldown, setOtpCooldown] = React.useState(0);
  const [otpSent, setOtpSent] = React.useState(false);

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

  // OTP Cooldown timer
  React.useEffect(() => {
    if (otpCooldown > 0) {
      const timer = setInterval(() => {
        setOtpCooldown(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [otpCooldown]);

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
      const message = err instanceof Error ? err.message : "Login failed";
      // Provide specific error messages
      if (message.includes("Invalid email or password")) {
        setError("Invalid email or password. Please check your credentials and try again.");
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function requestForgot() {
    setError("");
    setInfo("");
    setLoading(true);
    try {
      const res = await api("/auth/password/forgot", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setInfo("If this email is registered, a reset OTP has been sent. Check your inbox (and spam folder).");
      setMode("forgot-verify");
      setOtpSent(true);
      setOtpCooldown(60); // 60 second cooldown
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not send reset OTP";
      // Show specific error messages to user
      if (message.includes("wait")) {
        setError(message);
      } else if (message.includes("Maximum 3 reset OTPs per hour") || message.includes("Too many reset requests")) {
        setError(message);
      } else if (message.includes("valid email provider") || message.includes("Temporary/disposable emails")) {
        setError(message);
      } else {
        setError("Failed to send reset OTP. Please check your email and try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function resendOtp() {
    if (otpCooldown > 0) return;
    setError("");
    setInfo("");
    setLoading(true);
    try {
      const res = await api("/auth/password/forgot", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setInfo("New reset OTP sent to your email. Please check your inbox.");
      setOtpCooldown(60);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not resend OTP";
      if (message.includes("wait")) {
        setError(message);
      } else if (message.includes("Maximum 3 reset OTPs per hour") || message.includes("Too many reset requests")) {
        setError(message);
      } else if (message.includes("valid email provider") || message.includes("Temporary/disposable emails")) {
        setError(message);
      } else {
        setError("Failed to resend OTP. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("New password and confirm password do not match");
      return;
    }
    if (newPassword.length < 6 || newPassword.length > 20) {
      setError("New password must be between 6 and 20 characters");
      return;
    }
    if (!otp || otp.length !== 6) {
      setError("Please enter the 6-digit OTP");
      return;
    }
    setLoading(true);
    try {
      await api("/auth/password/reset", {
        method: "POST",
        body: JSON.stringify({ email, otp, newPassword, confirmPassword }),
      });
      setInfo("✅ Password updated successfully! Redirecting to login...");
      setTimeout(() => {
        setMode("login");
        setPassword("");
        setOtp("");
        setNewPassword("");
        setConfirmPassword("");
        setOtpSent(false);
      }, 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Reset failed";
      if (message.includes("Invalid or expired OTP")) {
        setError("The OTP is invalid or has expired. Please request a new one.");
      } else if (message.includes("match")) {
        setError("New password and confirm password do not match");
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-xl">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-bold">
            {mode === "login" ? "Login to " : mode === "forgot" ? "Reset Password " : "Verify OTP "}
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

        {/* Mode tabs - only Login and Forgot Password */}
        <div className="mb-6 flex overflow-hidden rounded-lg border border-border text-sm">
          {(["login", "forgot"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(""); setInfo(""); }}
              className={`flex-1 px-3 py-2 capitalize ${
                mode === m ? "bg-primary font-semibold text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              {m === "login" ? "Password Login" : "Forgot Password"}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400" role="alert">
            <div className="flex items-center gap-2">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          </div>
        )}
        {info && (
          <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400" role="status">
            <div className="flex items-center gap-2">
              <span>✅</span>
              <span>{info}</span>
            </div>
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
                autoComplete="email"
                className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
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
                  autoComplete="current-password"
                  className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm outline-none focus:border-primary pr-10"
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

        {mode === "forgot" && (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@gmail.com"
                autoComplete="email"
                className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Enter your registered email. We'll send a 6-digit OTP (valid for 10 minutes).
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Use a real email provider (Gmail, Yahoo, Outlook, etc.). Temporary emails are not allowed.
              </p>
            </div>
            <button
              type="button"
              onClick={requestForgot}
              disabled={loading || !email || otpCooldown > 0}
              className="w-full rounded-lg border border-primary/40 bg-primary/10 py-2.5 text-sm font-semibold text-primary hover:bg-primary/20 disabled:opacity-50"
            >
              {loading ? "Sending…" : otpCooldown > 0 ? `Resend in ${otpCooldown}s` : otpSent ? "Resend OTP" : "Send Reset OTP"}
            </button>
          </div>
        )}

        {mode === "forgot-verify" && (
          <form onSubmit={resetPassword} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Email</label>
              <input
                type="email"
                required
                readOnly
                value={email}
                className="w-full rounded-lg border border-input bg-muted px-4 py-2.5 text-sm outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">6-Digit OTP <span className="text-primary">(valid for 10 minutes)</span></label>
              <input
                type="text"
                required
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="Enter OTP from email"
                autoComplete="one-time-code"
                className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm outline-none focus:border-primary text-center tracking-widest text-lg"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Didn't receive the OTP? Check spam folder or 
                <button
                  type="button"
                  onClick={resendOtp}
                  disabled={otpCooldown > 0 || loading}
                  className="text-primary underline hover:no-underline disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {otpCooldown > 0 ? `resend in ${otpCooldown}s` : "resend OTP"}
                </button>
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">New Password</label>
              <div className="relative">
                <input
                  type={showNewPassword ? "text" : "password"}
                  required
                  minLength={6}
                  maxLength={20}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="6-20 characters"
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm outline-none focus:border-primary pr-10"
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
              <p className="mt-1 text-xs text-muted-foreground">{newPassword.length}/20 characters (min 6)</p>
              <div className="mt-1 h-1 w-full bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all duration-300" style={{ width: `${Math.min(100, (newPassword.length / 20) * 100)}%` }} />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Confirm New Password</label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  required
                  minLength={6}
                  maxLength={20}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm outline-none focus:border-primary pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                >
                  {showConfirmPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  )}
                </button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{confirmPassword.length}/20 characters (min 6)</p>
              {confirmPassword && newPassword !== confirmPassword && (
                <p className="mt-1 text-xs text-red-500">⚠️ Passwords do not match</p>
              )}
              {confirmPassword && newPassword === confirmPassword && confirmPassword.length >= 6 && (
                <p className="mt-1 text-xs text-emerald-500">✅ Passwords match</p>
              )}
            </div>
            <button
              type="button"
              onClick={resendOtp}
              disabled={loading || otpCooldown > 0}
              className="w-full rounded-lg border border-primary/40 bg-primary/10 py-2.5 text-sm font-semibold text-primary hover:bg-primary/20 disabled:opacity-50"
            >
              {loading ? "Sending…" : otpCooldown > 0 ? `Resend in ${otpCooldown}s` : "Resend OTP"}
            </button>
            <button
              type="submit"
              disabled={loading || !otp || !newPassword || !confirmPassword || newPassword !== confirmPassword || newPassword.length < 6 || newPassword.length > 20}
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