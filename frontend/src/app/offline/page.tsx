"use client";

import * as React from "react";

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="text-6xl mb-6">📴</div>
        <h1 className="text-2xl font-bold mb-2">You're Offline</h1>
        <p className="text-muted-foreground mb-6">
          It looks like you're not connected to the internet. Some features may not be available.
        </p>
        <div className="space-y-3">
          <button
            onClick={() => window.location.reload()}
            className="btn btn-primary w-full"
          >
            🔄 Try Again
          </button>
          <p className="text-sm text-muted-foreground">
            Or navigate to <a href="/dashboard" className="text-primary underline">Dashboard</a> when you're back online.
          </p>
        </div>
        <div className="mt-8 p-4 rounded-lg bg-card border border-border text-sm">
          <p className="font-semibold">Available Offline:</p>
          <ul className="mt-2 space-y-1 text-left">
            <li>• Previously loaded quiz questions</li>
            <li>• Cached test results & analytics</li>
            <li>• Bookmarked questions</li>
            <li>• Study plan progress</li>
          </ul>
        </div>
      </div>
    </div>
  );
}