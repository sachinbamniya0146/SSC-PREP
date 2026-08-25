"use client";

import * as React from "react";
import { ThemeContext } from "@/components/theme-provider";
import { api } from "@/lib/api";

type AuthResponse = {
  user: { id: string; email: string; fullName: string; role: string };
  accessToken: string;
  refreshToken: string;
};

export default function SignupPage() {
  const { theme, toggleTheme } = React.useContext(ThemeContext);
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = React.useState(false);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  // Email domain validation helper
  const isAllowedDomain = (email: string): boolean => {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return false;

    // List of blocked disposable/temporary email domains
    const blockedDomains = [
      'tempmail.com', 'temp-mail.org', 'guerrillamail.com', '10minutemail.com',
      'mailinator.com', 'throwawaymail.com', 'yopmail.com', 'dispostable.com',
      'fakeinbox.com', 'trashmail.com', 'getnada.com', 'maildrop.cc',
      'sharklasers.com', 'grr.la', 'spamgourmet.com', 'mintemail.com',
      'tempmail.net', 'tempmail.io', 'tempmail.plus', 'inboxkitten.com',
      'fakemailgenerator.com', 'emailondeck.com', 'getairmail.com',
      'dropmail.me', 'boxmail.xyz', 'wuzupmail.net', 'tempr.email',
      'tempemail.co', 'bccto.me', 'chacuo.net', 'mailcatch.com',
      'fakemail.net', 'spam4.me', 'spambox.us', 'spamcannon.com',
      'spamcowboy.com', 'spamcrackers.com', 'spamgourmet.net',
      'spamhole.com', 'spaminator.de', 'spamkill.info', 'spaml.com',
      'spaml.de', 'spammer.com', 'spammers.dk', 'spambog.com',
      'spambog.de', 'spambog.ru', 'spambog.com', 'spamday.com',
      'spamex.com', 'spamfree24.com', 'spamfree24.de', 'spamfree24.eu',
      'spamfree24.net', 'spamfree24.org', 'spamgourmet.org',
      'spamherelots.com', 'spamhereplease.com', 'spamhere.org',
      'spamhole.com', 'spamkill.net', 'spammonitor.net', 'spamnesty.com',
      'spamspot.com', 'spamstack.net', 'spamthis.co', 'spamthisplease.com',
    ];

    if (blockedDomains.includes(domain)) {
      return false;
    }

    // Allow major providers
    const allowedDomains = [
      'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.co.uk',
      'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
      'icloud.com', 'me.com', 'mac.com',
      'protonmail.com', 'proton.me',
      'zoho.com', 'zohomail.com',
      'aol.com', 'aim.com',
      'mail.com', 'email.com',
      'gmx.com', 'gmx.de', 'gmx.net',
      'web.de', 't-online.de',
      'yandex.com', 'yandex.ru',
      'rediffmail.com', 'indiatimes.com',
    ];

    // Check if exact match or subdomain of allowed
    if (allowedDomains.includes(domain)) return true;
    
    // Allow common suffixes (educational, gov, org)
    const commonSuffixes = [
      '.edu', '.ac.in', '.gov.in', '.nic.in', '.org', '.net', '.co.in', '.in'
    ];

    for (const suffix of commonSuffixes) {
      if (domain.endsWith(suffix)) return true;
    }

    // Block suspicious patterns
    if (domain.includes('temp') || domain.includes('disposable') || domain.includes('throwaway') || domain.includes('fake') || domain.includes('trash') || domain.includes('spam')) {
      return false;
    }

    // Allow other domains by default (but not temp mail)
    return true;
  };

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    
    // Email domain validation
    if (!isAllowedDomain(email)) {
      setError("Please use a valid email provider (Gmail, Yahoo, Outlook, etc.). Temporary/disposable emails are not allowed.");
      return;
    }
    
    if (password.length < 6 || password.length > 20) {
      setError("Password must be between 6 and 20 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (phone.length < 10) {
      setError("Mobile number must be at least 10 digits");
      return;
    }
    setLoading(true);
    try {
      const data = await api<AuthResponse>("/auth/signup", {
        method: "POST",
        body: JSON.stringify({ fullName, email, phone, password }),
      });
      localStorage.setItem("ssc_access_token", data.accessToken);
      localStorage.setItem("ssc_refresh_token", data.refreshToken);
      localStorage.setItem("ssc_user", JSON.stringify(data.user));
      window.location.href = "/dashboard";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Signup failed";
      if (message.includes("already registered")) {
        setError("This email is already registered. Please login instead.");
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
            Create <span className="text-primary">Free Account</span>
          </h1>
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="rounded-lg border border-border p-2 text-sm"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400" role="alert">
            <div className="flex items-center gap-2">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          </div>
        )}

        <form onSubmit={handleSignup} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Full Name</label>
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your Name"
              autoComplete="name"
              className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
            />
          </div>
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
              Use a real email provider (Gmail, Yahoo, Outlook, etc.). Temporary emails are not allowed.
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Mobile Number <span className="text-red-500">*</span></label>
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 9876543210"
              autoComplete="tel"
              className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
              inputMode="numeric"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Required for account security & notifications.
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                minLength={6}
                maxLength={20}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="6-20 characters"
                autoComplete="new-password"
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
            <p className="mt-1 text-xs text-muted-foreground">{password.length}/20 characters (min 6)</p>
            <div className="mt-1 h-1 w-full bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all duration-300" style={{ width: `${Math.min(100, (password.length / 20) * 100)}%` }} />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Confirm Password</label>
            <div className="relative">
              <input
                type={showConfirmPassword ? "text" : "password"}
                required
                minLength={6}
                maxLength={20}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
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
            {confirmPassword && password !== confirmPassword && (
              <p className="mt-1 text-xs text-red-500">⚠️ Passwords do not match</p>
            )}
            {confirmPassword && password === confirmPassword && confirmPassword.length >= 6 && (
              <p className="mt-1 text-xs text-emerald-500">✅ Passwords match</p>
            )}
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {loading ? "Creating account…" : "Create Free Account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <a href="/login" className="font-semibold text-primary">
            Login
          </a>
        </p>
      </div>
    </div>
  );
}