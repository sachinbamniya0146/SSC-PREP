"use client";
import * as React from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useFeatures } from "@/lib/features";
import { INDIAN_STATES } from "@/lib/states";
import { Skeleton } from "@/components/Skeleton";

type Place = { rank: number; outOf: number; percentile: number };
export type AttemptRank = {
  countsForRank: boolean;
  /** the viewer is an admin / staff account: never listed on a board and never counted in a student's rank */
  staff?: boolean;
  overall: Place;
  state: (Place & { name: string }) | null;
  stateMissing: boolean;
  firstAttempt: Place | null;
  topScore: number | null;
  avgScore: number | null;
  attempts: number;
};
type Board = {
  scope: "india" | "state";
  state: string | null;
  needState: boolean;
  total: number;
  rows: { rank: number; name: string; state: string | null; score: number; accuracy: number; durationSec: number; isMe: boolean }[];
};

const fmtTime = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

/**
 * "Where do I stand" card on the result page: All-India rank and State rank, percentile, and the toppers of this
 * test (India or own state). A retake is shown as practice rank. No state chosen yet -> one-tap picker.
 */
export default function RankCard({ attemptId, templateId, onRank }: { attemptId: string; templateId?: string; onRank?: (r: AttemptRank) => void }) {
  const tr = useT();
  const { on } = useFeatures();
  const [data, setData] = React.useState<AttemptRank | null>(null);
  const [err, setErr] = React.useState("");
  const [tab, setTab] = React.useState<"india" | "state">("india");
  const [board, setBoard] = React.useState<Board | null>(null);
  const [boardErr, setBoardErr] = React.useState("");
  const [boardBusy, setBoardBusy] = React.useState(false);
  const [pick, setPick] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setErr("");
      const d = await api<AttemptRank>(`/tests/attempts/${attemptId}/rank`);
      setData(d);
      onRank?.(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load rank");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const showBoard = on("leaderboard") && !!templateId;
  React.useEffect(() => {
    if (!showBoard || !templateId) return;
    let off = false;
    setBoardBusy(true);
    setBoardErr("");
    api<Board>(`/tests/rank/leaderboard/${templateId}${tab === "state" ? "?scope=state" : ""}`)
      .then((b) => !off && setBoard(b))
      .catch((e) => !off && setBoardErr(e instanceof Error ? e.message : "Could not load toppers"))
      .finally(() => !off && setBoardBusy(false));
    return () => {
      off = true;
    };
  }, [showBoard, templateId, tab, data?.stateMissing]);

  const saveState = async () => {
    if (!pick) return;
    setSaving(true);
    try {
      await api("/users/me/profile", { method: "PUT", body: JSON.stringify({ state: pick }) });
      await load();
      setTab("state");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save your state");
    } finally {
      setSaving(false);
    }
  };

  if (err && !data) {
    return (
      <div className="card mt-4 flex items-center justify-between gap-3 p-4 text-sm">
        <span className="text-muted-foreground">{err}</span>
        <button onClick={load} className="btn btn-outline btn-sm">{tr("Retry", "Dobara try karo")}</button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="card mt-4 space-y-3 p-5" role="status" aria-label="Loading rank">
        <Skeleton className="h-4 w-40" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      </div>
    );
  }

  const stateOn = on("stateRank");
  const big = (p: Place | null, label: string, sub: string) => (
    <div className="rounded-xl border border-border bg-muted/30 p-4 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {p ? (
        <>
          <p className="mt-1 text-3xl font-extrabold leading-none text-primary">
            #{p.rank}
            <span className="ml-1 text-sm font-semibold text-muted-foreground">/ {p.outOf}</span>
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {tr("Top", "Top")} {Math.max(0.1, Math.round((p.rank / Math.max(1, p.outOf)) * 1000) / 10)}% · {p.percentile}%ile
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{sub}</p>
      )}
    </div>
  );

  return (
    <div className="card mt-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold">🏅 {tr("Your rank in this test", "Is test me aapki rank")}</h2>
        <span className="text-xs text-muted-foreground">
          {data.attempts} {tr("students", "students")}
          {data.topScore != null ? ` · ${tr("top score", "top score")} ${data.topScore}` : ""}
        </span>
      </div>

      {!data.countsForRank && (
        <p className="mt-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-foreground">
          {data.staff
            ? tr(
                "You are signed in as staff. Admin and staff attempts are shown as a practice rank and are never counted in any student's rank.",
                "Aap staff account se hain. Admin / staff ke attempt practice rank ki tarah dikhte hain, kisi student ki rank me gine nahi jaate.",
              )
            : tr(
                "This is a retake, so it is shown as a practice rank and does not change anyone's real rank.",
                "Ye retake hai, isliye practice rank dikh rahi hai - asli rank me koi change nahi hota.",
              )}
          {data.firstAttempt && (
            <>
              {" "}
              {tr("Your first attempt stands at", "Aapka pehla attempt abhi")} <b>#{data.firstAttempt.rank}</b> / {data.firstAttempt.outOf}.
            </>
          )}
        </p>
      )}

      <div className={`mt-3 grid gap-3 ${stateOn ? "sm:grid-cols-2" : ""}`}>
        {big(data.overall, data.countsForRank ? tr("All-India rank", "All-India rank") : tr("All-India practice rank", "All-India practice rank"), "-")}
        {stateOn &&
          (data.stateMissing ? (
            <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{tr("State rank", "State rank")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{tr("Choose your state to see how you rank against students from your state.", "Apna state chuno aur apne state ke students me rank dekho.")}</p>
              <div className="mt-2 flex gap-2">
                <select value={pick} onChange={(e) => setPick(e.target.value)} className="min-w-0 flex-1 border bg-background px-2 py-1.5 text-sm" aria-label="State">
                  <option value="">{tr("Select state", "State chuno")}</option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <button onClick={saveState} disabled={!pick || saving} className="btn btn-primary btn-sm">
                  {saving ? "…" : tr("Save", "Save")}
                </button>
              </div>
              {err && <p className="mt-1 text-xs text-danger">{err}</p>}
            </div>
          ) : (
            big(data.state, `${tr("State rank", "State rank")} · ${data.state?.name ?? ""}`, "-")
          ))}
      </div>

      {showBoard && (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold">{tr("Toppers of this test", "Is test ke toppers")}</p>
            {stateOn && (
              <div className="inline-flex rounded-full border border-border p-0.5 text-xs font-semibold">
                {(["india", "state"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setTab(k)}
                    className={`rounded-full px-3 py-1 transition ${tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {k === "india" ? "India" : tr("My state", "Mera state")}
                  </button>
                ))}
              </div>
            )}
          </div>
          {boardBusy && !board ? (
            <Skeleton className="mt-2 h-24" />
          ) : boardErr ? (
            <p className="mt-2 text-xs text-muted-foreground">{boardErr}</p>
          ) : board?.needState ? (
            <p className="mt-2 text-xs text-muted-foreground">{tr("Choose your state above to see your state toppers.", "State toppers dekhne ke liye upar state chuno.")}</p>
          ) : board && board.rows.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">{tr("No students yet.", "Abhi koi student nahi.")}</p>
          ) : (
            <div className={`mt-2 overflow-x-auto transition-opacity ${boardBusy ? "opacity-60" : ""}`}>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="pb-1.5 pr-3 font-semibold">#</th>
                    <th className="pb-1.5 pr-3 font-semibold">{tr("Student", "Student")}</th>
                    <th className="pb-1.5 pr-3 font-semibold">{tr("Score", "Score")}</th>
                    <th className="pb-1.5 pr-3 font-semibold">{tr("Accuracy", "Accuracy")}</th>
                    <th className="pb-1.5 font-semibold">{tr("Time", "Time")}</th>
                  </tr>
                </thead>
                <tbody>
                  {board?.rows.map((r) => (
                    <tr key={`${r.rank}-${r.name}-${r.score}-${r.durationSec}`} className={r.isMe ? "bg-primary/10 font-semibold" : ""}>
                      <td className="py-1.5 pr-3">{r.rank}</td>
                      <td className="py-1.5 pr-3">
                        {r.name}
                        {r.isMe ? ` (${tr("you", "aap")})` : ""}
                        {r.state && tab === "india" ? <span className="ml-1 text-muted-foreground">· {r.state}</span> : null}
                      </td>
                      <td className="py-1.5 pr-3">{r.score}</td>
                      <td className="py-1.5 pr-3">{r.accuracy}%</td>
                      <td className="py-1.5">{fmtTime(r.durationSec)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            {tr(
              "Rank counts only each student's first attempt. Same score = faster time ranks higher; equal score and time share a rank.",
              "Rank me sirf pehla attempt ginta hai. Same score par kam time wala upar; score aur time dono same ho to rank share hoti hai.",
            )}
          </p>
        </div>
      )}
    </div>
  );
}
