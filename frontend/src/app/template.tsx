// Re-mounts on every navigation: a short, GPU-only fade/slide so page
// changes feel instant and smooth instead of a hard cut.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-page">{children}</div>;
}
