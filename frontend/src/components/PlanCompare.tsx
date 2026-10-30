"use client";
/**
 * "Free vs Premium" - what a student gets without paying and what a plan adds.
 *
 * Every row is something the server really does (see backend/src/common/free-limits.ts and the services that import it); the
 * numbers come from GET /payments/benefits, so this table cannot drift away from the limits the server enforces.
 * Nothing here is a promise about future features: if it is not enforced / built, it is not listed.
 */
import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";
import { useT } from "@/lib/i18n";

type Benefits = {
  free: { practiceSetsPerDay: number; practiceSetQuestions: number; bookmarks: number; triesPerPremiumMock: number; chapterPdfPriceInr: number; smartMocks?: number; customTestsPerDay?: number };
  premiumMockCount: number;
};

const Yes = ({ label }: { label?: string }) => (
  <span className="inline-flex items-center gap-1 font-semibold text-success">
    <span aria-hidden>✓</span>
    <span className={label ? "" : "sr-only"}>{label || "Included"}</span>
  </span>
);
const No = () => (
  <span className="text-muted-foreground">
    <span aria-hidden>—</span>
    <span className="sr-only">Not included</span>
  </span>
);

export default function PlanCompare({ id = "compare" }: { id?: string }) {
  const tr = useT();
  const [b, setB] = React.useState<Benefits | null>(null);

  React.useEffect(() => {
    let off = false;
    fetchAuth(`${API_BASE}/payments/benefits`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !off && d?.free && setB(d))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, []);

  const f = b?.free;
  const rows: { label: string; hint?: string; free: React.ReactNode; premium: React.ReactNode }[] = [
    {
      label: tr("PYQ mock tests", "PYQ mock tests"),
      hint: tr("Every previous-year paper, real exam screen, timer and marking", "Har previous-year paper, asli exam screen, timer aur marking"),
      free: <Yes label={tr("All", "Sab")} />,
      premium: <Yes label={tr("All", "Sab")} />,
    },
    {
      label: tr("Result analysis & rank", "Result analysis aur rank"),
      hint: tr("Subject / chapter accuracy, All-India and State rank", "Subject / chapter accuracy, All-India aur State rank"),
      free: <Yes />,
      premium: <Yes />,
    },
    {
      label: tr("Weak-topic practice & revision", "Weak-topic practice aur revision"),
      hint: tr("Your wrong answers come back at the right time, never limited", "Galat sawal sahi samay par wapas aate hain, koi limit nahi"),
      free: <Yes label={tr("Unlimited", "Unlimited")} />,
      premium: <Yes label={tr("Unlimited", "Unlimited")} />,
    },
    {
      label: tr("Study planner, daily test & leaderboard", "Study planner, daily test aur leaderboard"),
      free: <Yes />,
      premium: <Yes />,
    },
    {
      label: tr("Chapter / topic practice sets", "Chapter / topic practice sets"),
      hint: f ? tr(`One set = ${f.practiceSetQuestions} questions`, `1 set = ${f.practiceSetQuestions} sawal`) : undefined,
      free: f ? <span className="font-semibold">{f.practiceSetsPerDay} {tr("sets / day", "sets / din")}</span> : <span className="text-muted-foreground">…</span>,
      premium: <Yes label={tr("Unlimited", "Unlimited")} />,
    },
    {
      label: tr("Smart mocks (exam-wise, PYQ weightage)", "Smart mock (exam-wise, PYQ weightage)"),
      hint: tr("Built from the practice bank in the pattern of your exam", "Practice bank se, aapke exam ke pattern me"),
      free: f && f.smartMocks ? <span className="font-semibold">{f.smartMocks} {tr("free", "free")}</span> : <span className="text-muted-foreground">…</span>,
      premium: <Yes label={tr("Unlimited", "Unlimited")} />,
    },
    {
      label: tr("Custom tests (your topics, your time)", "Custom test (apne topic, apna time)"),
      free: f && f.customTestsPerDay ? <span className="font-semibold">{f.customTestsPerDay} {tr("per day", "per din")}</span> : <span className="text-muted-foreground">…</span>,
      premium: <Yes label={tr("Unlimited", "Unlimited")} />,
    },
    {
      label: tr("Bookmarks", "Bookmarks"),
      free: f ? <span className="font-semibold">{f.bookmarks}</span> : <span className="text-muted-foreground">…</span>,
      premium: <Yes label={tr("Unlimited", "Unlimited")} />,
    },
    {
      label: tr("Chapter PDFs", "Chapter PDFs"),
      hint: tr("Printable chapter practice with answer key", "Print karne layak chapter practice, answer key ke saath"),
      free: f ? <span className="font-semibold">₹{f.chapterPdfPriceInr} {tr("per chapter", "per chapter")}</span> : <span className="text-muted-foreground">…</span>,
      premium: <Yes label={tr("All included", "Sab shamil")} />,
    },
    ...(b && b.premiumMockCount > 0
      ? [
          {
            label: tr("Premium mock series", "Premium mock series"),
            hint: tr(`${b.premiumMockCount} special mock(s)`, `${b.premiumMockCount} special mock`),
            free: <span className="font-semibold">{f!.triesPerPremiumMock} {tr("tries each", "try har mock")}</span>,
            premium: <Yes label={tr("All, unlimited", "Sab, unlimited")} />,
          },
        ]
      : []),
    {
      label: tr("Telegram bot", "Telegram bot"),
      hint: tr("Progress reports and result PDFs on Telegram", "Telegram par progress report aur result PDF"),
      free: <No />,
      premium: <Yes />,
    },
  ];

  return (
    <section id={id} aria-labelledby={`${id}-h`} className="mb-10 scroll-mt-24">
      <h2 id={`${id}-h`} className="text-2xl font-bold">{tr("Free vs Premium", "Free vs Premium")}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        {tr(
          "Most of your preparation is free. Premium removes the daily limits and adds a few extra tools.",
          "Zyada tar taiyari free hai. Premium daily limits hata deta hai aur kuch extra tools deta hai.",
        )}
      </p>
      <div className="card mt-4 overflow-hidden">
        <table className="w-full table-fixed text-left text-xs sm:text-sm">
          <caption className="sr-only">{tr("What is included in Free and in Premium", "Free aur Premium me kya shamil hai")}</caption>
          <colgroup>
            <col className="w-[46%]" />
            <col className="w-[27%]" />
            <col className="w-[27%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th scope="col" className="px-3 py-3 font-semibold sm:px-4">{tr("Feature", "Feature")}</th>
              <th scope="col" className="px-2 py-3 text-center font-semibold">Free</th>
              <th scope="col" className="px-2 py-3 text-center font-semibold">
                <span aria-hidden className="mr-1 text-warning">✦</span>Premium
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row" className="px-3 py-3 align-top font-medium sm:px-4">
                  {r.label}
                  {r.hint && <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground sm:text-xs">{r.hint}</span>}
                </th>
                <td className="px-2 py-3 text-center align-top">{r.free}</td>
                <td className="bg-warning/[0.06] px-2 py-3 text-center align-top">{r.premium}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {tr(
          "Vocabulary Mastery's skip-ahead unlocks are sold separately and are not part of Premium.",
          "Vocabulary Mastery ke skip-ahead unlocks alag se milte hain, Premium me shamil nahi.",
        )}
      </p>
    </section>
  );
}
