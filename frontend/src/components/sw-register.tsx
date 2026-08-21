"use client";

import * as React from "react";

export function SWRegister() {
  const [isOnline, setIsOnline] = React.useState(true);
  const [updateAvailable, setUpdateAvailable] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    // Check initial online status
    setIsOnline(navigator.onLine);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Register service worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").then((registration) => {
        // Check for updates
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                setUpdateAvailable(true);
              }
            });
          }
        });

        // Listen for controller change (new SW took over)
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          window.location.reload();
        });
      }).catch((err) => {
        console.log("SW registration failed:", err);
      });
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const handleUpdate = () => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg?.waiting) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
        }
      });
    }
  };

  if (!isOnline) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-warning/90 px-4 py-2 text-center text-sm text-warning-foreground animate-slide-down" role="alert">
        📴 You're offline. Some features may not be available.
      </div>
    );
  }

  if (updateAvailable) {
    return (
      <div className="fixed bottom-4 left-4 right-4 sm:max-w-md sm:left-auto sm:right-4 z-50 animate-slide-up" role="alert">
        <div className="card shadow-xl p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-sm">🔄</span>
              </div>
              <div>
                <p className="font-semibold">Update Available</p>
                <p className="text-sm text-muted-foreground">A new version of SSC Prep Hub is ready.</p>
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={handleUpdate} className="btn btn-primary text-sm">
                Refresh
              </button>
              <button onClick={() => setUpdateAvailable(false)} className="btn btn-outline text-sm">
                Later
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}