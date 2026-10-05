"use client";
import * as React from "react";
import { fetchAuth, API_BASE } from "@/lib/api";
import { useT } from "@/lib/i18n";

type Status = {
  votable: boolean;
  verified: boolean;
  correct: number;
  incorrect: number;
  required: number;
  myVote: "CORRECT" | "INCORRECT" | null;
  reset?: boolean;
};

/**
 * Honest labelling + crowd verification of AI-written solutions.
 *  - an AI solution is always marked "AI generated"
 *  - a student who attempted the question can confirm it is correct (or report a mistake)
 *  - until 10 different students confirm it, EVERY student keeps seeing the "not verified yet" notice
 *  - at 10 confirmations the solution is saved permanently and shows "Verified by students"
 * Renders nothing for PDF / staff-verified solutions.
 */
export default function SolutionVerify({ questionId, source }: { questionId: string; source?: string | null }) {
  const t = useT();
  const isAi = source === "AI_GENERATED" || source === "COMMUNITY_VERIFIED";
  const [st, setSt] = React.useState<Status | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState("");

  React.useEffect(() => {
    if (!isAi || !questionId) return;
    let cancelled = false;
    fetchAuth(`${API_BASE}/ai-explanation/questions/${questionId}/verification`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setSt(d as Status);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [questionId, isAi]);

  if (!isAi) return null;

  const vote = async (v: "CORRECT" | "INCORRECT") => {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await fetchAuth(`${API_BASE}/ai-explanation/questions/${questionId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote: v }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d?.message || t("Could not save your response.", "Aapka response save nahi hua."));
        return;
      }
      setSt(d as Status);
      if ((d as Status).reset) {
        setMsg(t("Thanks! This solution was flagged by students and will be regenerated.", "Shukriya! Ye solution students ne flag kiya hai, naya generate hoga."));
      }
    } catch {
      setMsg(t("Network error — please try again.", "Network error — dobara try karein."));
    } finally {
      setBusy(false);
    }
  };

  const verified = source === "COMMUNITY_VERIFIED" || st?.verified;
  const required = st?.required ?? 10;
  const done = st?.correct ?? 0;

  if (verified) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs">
        <span className="font-semibold text-success">✅ {t("Verified by students", "Students ne verify kiya")}</span>
        <span className="text-muted-foreground">{t("AI-written, confirmed correct by", "AI ne likha, sahi confirm kiya")} {required}+ {t("students", "students ne")}</span>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs">
      <p className="font-semibold text-foreground">
        🤖 {t("AI generated solution — not verified yet", "AI generated solution — abhi verify nahi hua")}{" "}
        <span className="font-normal text-muted-foreground">
          ({done}/{required} {t("students confirmed", "students ne confirm kiya")})
        </span>
      </p>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (done / required) * 100)}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">{t("Is this solution correct?", "Kya ye solution sahi hai?")}</span>
        <button
          onClick={() => vote("CORRECT")}
          disabled={busy}
          className={`rounded-md border px-2.5 py-1 font-semibold ${st?.myVote === "CORRECT" ? "border-success bg-success/15 text-success" : "border-border hover:bg-muted"}`}
        >
          👍 {t("Yes, correct", "Haan, sahi hai")}
        </button>
        <button
          onClick={() => vote("INCORRECT")}
          disabled={busy}
          className={`rounded-md border px-2.5 py-1 font-semibold ${st?.myVote === "INCORRECT" ? "border-danger bg-danger/15 text-danger" : "border-border hover:bg-muted"}`}
        >
          👎 {t("Has a mistake", "Isme galti hai")}
        </button>
      </div>
      {st?.myVote && !msg && (
        <p className="mt-1 text-muted-foreground">
          {t("Thanks! You marked it", "Shukriya! Aapne mark kiya:")} {st.myVote === "CORRECT" ? t("correct", "sahi") : t("incorrect", "galat")}. {t("You can change this any time.", "Aap ise kabhi badal sakte hain.")}
        </p>
      )}
      {msg && <p className="mt-1 text-muted-foreground">{msg}</p>}
    </div>
  );
}
