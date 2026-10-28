import * as React from "react";

/** Grey placeholder blocks that shimmer while data loads (instead of a bare "Loading…"). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card space-y-3 p-5">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <div className="grid gap-2 sm:grid-cols-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        </div>
      ))}
    </div>
  );
}
