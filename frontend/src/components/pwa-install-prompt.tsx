"use client";

import * as React from "react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

export function PWAInstallPrompt() {
  const [showPrompt, setShowPrompt] = React.useState(false);
  const [deferredPrompt, setDeferredPrompt] = React.useState<BeforeInstallPromptEvent | null>(null);

  React.useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Show prompt after a delay to not be annoying on first visit
      const timer = setTimeout(() => setShowPrompt(true), 30000);
      return () => clearTimeout(timer);
    };

    const handleAppInstalled = () => {
      setShowPrompt(false);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setShowPrompt(false);
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    // Don't show again for 7 days
    localStorage.setItem("pwa-install-dismissed", Date.now().toString());
  };

  // Don't show if already dismissed recently or on mobile (where native prompt shows)
  let dismissed = null;  if (typeof window !== "undefined") {    dismissed = localStorage.getItem("pwa-install-dismissed");  }  const isMobile = typeof window !== "undefined" && /Android|iPhone|iPad|iPod/.test(navigator.userAgent);  const isStandalone = typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches;
  if (!showPrompt || !deferredPrompt || isStandalone || isMobile || (dismissed && Date.now() - parseInt(dismissed) < 7 * 24 * 60 * 60 * 1000)) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm animate-slide-up" role="dialog" aria-label="Install SSC Prep Hub">
      <div className="card shadow-xl p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <span className="text-xl">📱</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold">Install SSC Prep Hub</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Add to home screen for offline access, faster loading & daily quiz reminders.
            </p>
            <div className="mt-3 flex gap-2">
              <button onClick={handleInstall} className="btn btn-primary text-sm flex-1">
                Install
              </button>
              <button onClick={handleDismiss} className="btn btn-outline text-sm">
                Later
              </button>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="text-muted-foreground hover:text-foreground flex-shrink-0"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}