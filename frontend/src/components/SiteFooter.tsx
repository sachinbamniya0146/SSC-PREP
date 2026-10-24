import { Logo } from "@/components/Logo";

const cols = [
  {
    title: "Practice",
    links: [
      { href: "/mocks", label: "Mock Tests" },
      { href: "/sectional", label: "Sectional Tests" },
      { href: "/question-bank", label: "PYQ Question Bank" },
      { href: "/year-wise", label: "Year-wise Papers" },
      { href: "/offline", label: "Offline Practice" },
    ],
  },
  {
    title: "Learn",
    links: [
      { href: "/vocabulary", label: "Vocabulary" },
      { href: "/study-plan", label: "Study Plan" },
      { href: "/weak-topics", label: "Weak Topics" },
      { href: "/leaderboard", label: "Leaderboard" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/login", label: "Login" },
      { href: "/signup", label: "Create account" },
      { href: "/premium", label: "Premium plans" },
      { href: "/referral", label: "Refer & Earn" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="container-page grid gap-10 py-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
            Exam-pattern mock tests, previous year papers and smart analytics for SSC aspirants, in Hindi and English.
          </p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <h4 className="text-sm font-semibold">{c.title}</h4>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {c.links.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="transition hover:text-primary">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="container-page flex flex-col items-center justify-between gap-2 py-5 text-xs text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} SSC Prep Hub · sscprephub.in</span>
          <span>Made for aspirants, by aspirants.</span>
        </div>
      </div>
    </footer>
  );
}
