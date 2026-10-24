import { Logo } from "@/components/Logo";

const points = [
  "3 free mock tests on every SSC exam",
  "Questions and solutions in Hindi + English",
  "Rank, accuracy and weak-topic analytics",
  "Daily practice with streaks and XP",
];

/** Left-hand brand panel shared by /login and /signup (desktop only). */
export function AuthBrandPanel({ heading, sub }: { heading: string; sub: string }) {
  return (
    <div className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
      <div className="grid-dots pointer-events-none absolute inset-0 opacity-25 invert" />
      <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-accent/30 blur-3xl" />
      <a href="/" className="relative w-fit rounded-xl bg-white/95 px-3 py-2 text-slate-900">
        <Logo size={30} />
      </a>
      <div className="relative max-w-md">
        <h2 className="text-3xl font-extrabold leading-tight tracking-tight xl:text-4xl">{heading}</h2>
        <p className="mt-4 text-sm leading-relaxed opacity-90">{sub}</p>
        <ul className="mt-8 space-y-3 text-sm">
          {points.map((p) => (
            <li key={p} className="flex items-start gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/20">
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              {p}
            </li>
          ))}
        </ul>
      </div>
      <p className="relative text-xs opacity-75">© {new Date().getFullYear()} SSC Prep Hub · sscprephub.in</p>
    </div>
  );
}
