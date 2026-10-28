import * as React from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { LEGAL_UPDATED } from "@/lib/site-config";

export type LegalSection = { id: string; title: string; body: React.ReactNode };

const DOCS = [
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/refund", label: "Refund & Cancellation" },
];

export function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 leading-relaxed text-foreground/85">{children}</p>;
}
export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mt-3 list-disc space-y-1.5 pl-5 leading-relaxed text-foreground/85 marker:text-primary">{children}</ul>;
}

/** Shared frame for Terms / Privacy / Refund: header, document switcher, table of contents, numbered sections, footer. */
export function LegalLayout({
  title,
  intro,
  current,
  sections,
}: {
  title: string;
  intro: React.ReactNode;
  current: string;
  sections: LegalSection[];
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader minimal />
      <main className="container-page py-10 sm:py-14">
        <div className="mx-auto max-w-6xl">
          <nav aria-label="Legal documents" className="mb-6 flex flex-wrap gap-2">
            {DOCS.map((d) => (
              <a
                key={d.href}
                href={d.href}
                aria-current={d.href === current ? "page" : undefined}
                className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                  d.href === current ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                }`}
              >
                {d.label}
              </a>
            ))}
          </nav>

          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: {LEGAL_UPDATED}</p>
          <div className="mt-4 max-w-3xl leading-relaxed text-foreground/85">{intro}</div>

          <div className="mt-10 grid gap-10 lg:grid-cols-[260px_1fr]">
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">On this page</p>
              <ol className="mt-3 space-y-1.5 text-sm">
                {sections.map((s, i) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="block rounded-md px-2 py-1 text-muted-foreground transition hover:bg-muted hover:text-foreground">
                      <span className="mr-1.5 tabular-nums text-xs">{i + 1}.</span>
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </aside>

            <div className="min-w-0 max-w-3xl">
              {sections.map((s, i) => (
                <section key={s.id} id={s.id} className="scroll-mt-24 border-b border-border/60 py-7 first:pt-0 last:border-0">
                  <h2 className="text-xl font-bold">
                    <span className="mr-2 text-primary tabular-nums">{i + 1}.</span>
                    {s.title}
                  </h2>
                  {s.body}
                </section>
              ))}
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
