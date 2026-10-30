"use client";

import * as React from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { subscribeToPush, pushSupported } from "@/lib/push";
import { AppShell, PageHeading, EmptyState, ErrorNote } from "@/components/AppShell";

type Item = { id: string; kind: string; title: string; body: string; url?: string | null; readAt?: string | null; createdAt: string };
type Prefs = {
  weakTopic: boolean;
  streak: boolean;
  tests: boolean;
  news: boolean;
  remindHourIst: number;
  pausedUntil: string | null;
  pushAvailable: boolean;
};

const ICON: Record<string, string> = { RESUME: "⏳", STREAK: "🔥", WEAK: "📉", COMEBACK: "👋", ADMIN: "📢" };

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "abhi";
  if (s < 3600) return `${Math.round(s / 60)} min pehle`;
  if (s < 86400) return `${Math.round(s / 3600)} ghante pehle`;
  return `${Math.round(s / 86400)} din pehle`;
}

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;

export default function NotificationsPage() {
  const t = useT();
  const [items, setItems] = React.useState<Item[]>([]);
  const [unread, setUnread] = React.useState(0);
  const [prefs, setPrefs] = React.useState<Prefs | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const [needsLogin, setNeedsLogin] = React.useState(false);
  const [perm, setPerm] = React.useState<string>("unsupported");
  const [msg, setMsg] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      if (!localStorage.getItem("ssc_access_token")) {
        setNeedsLogin(true);
        return;
      }
    } catch {
      /* private mode: let the request decide */
    }
    try {
      const [inbox, p] = await Promise.all([api<{ items: Item[]; unread: number }>("/notifications"), api<Prefs>("/notifications/prefs")]);
      setItems(Array.isArray(inbox?.items) ? inbox.items : []);
      setUnread(Number(inbox?.unread) || 0);
      setPrefs(p);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, [load]);

  const open = async (n: Item) => {
    if (!n.readAt) {
      setItems((l) => l.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      setUnread((u) => Math.max(0, u - 1));
      api("/notifications/read", { method: "POST", body: JSON.stringify({ ids: [n.id] }) }).catch(() => undefined);
    }
    if (n.url) window.location.href = n.url;
  };

  const readAll = async () => {
    setItems((l) => l.map((x) => ({ ...x, readAt: x.readAt || new Date().toISOString() })));
    setUnread(0);
    await api("/notifications/read-all", { method: "POST" }).catch(() => undefined);
  };

  const save = async (patch: Partial<Prefs> & { pauseDays?: number }) => {
    setMsg("");
    try {
      const p = await api<Prefs>("/notifications/prefs", { method: "PUT", body: JSON.stringify(patch) });
      setPrefs(p);
      setMsg(t("Saved", "Save ho gaya"));
    } catch {
      setMsg(t("Could not save. Try again.", "Save nahi hua. Dobara try karo."));
    }
  };

  const enablePush = async () => {
    const r = await subscribeToPush().catch(() => "denied" as const);
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    setMsg(r === "subscribed" ? t("Phone alerts are on", "Phone alerts on ho gaye") : r === "unsupported" ? t("This browser or server does not support phone alerts. Reminders still appear here.", "Is browser/server par phone alerts nahi chalte. Reminders yahin dikhenge.") : t("Permission was not given. You can allow it in the browser settings.", "Permission nahi mili. Browser settings se allow kar sakte ho."));
  };

  const toggle = (k: "weakTopic" | "streak" | "tests" | "news", en: string, hi: string) => (
    <label key={k} className="flex cursor-pointer items-center justify-between gap-3 py-2 text-sm">
      <span>{t(en, hi)}</span>
      <input type="checkbox" className="h-5 w-5" checked={!!prefs?.[k]} onChange={(e) => void save({ [k]: e.target.checked })} />
    </label>
  );

  const paused = prefs?.pausedUntil ? new Date(prefs.pausedUntil) : null;

  return (
    <AppShell width="lg">
      <PageHeading
        title={t("Notifications", "Notifications")}
        subtitle={t("Reminders to finish a test, save your streak and fix weak topics.", "Test poora karne, streak bachane aur kamzor topics sudharne ke reminders.")}
        actions={unread > 0 ? <button className="btn btn-outline btn-sm" onClick={() => void readAll()}>{t("Mark all read", "Sab padh liye")}</button> : undefined}
      />

      {needsLogin ? (
        <EmptyState title={t("Please log in", "Pehle login karein")} action={<a className="btn btn-primary" href="/login">{t("Log in", "Login")}</a>} />
      ) : loading ? (
        <div className="card p-6 text-sm text-muted-foreground">{t("Loading…", "Load ho raha hai…")}</div>
      ) : error ? (
        <ErrorNote onRetry={() => void load()}>{t("Could not load your notifications.", "Notifications load nahi hue.")}</ErrorNote>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <section aria-label={t("Inbox", "Inbox")}>
            {items.length === 0 ? (
              <EmptyState title={t("Nothing yet", "Abhi kuch nahi")} body={t("Reminders and messages from your teachers will show up here.", "Reminders aur teachers ke messages yahan dikhenge.")} />
            ) : (
              <ul className="space-y-2">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => void open(n)}
                      className={`card flex w-full items-start gap-3 p-4 text-left transition hover:border-primary/40 ${n.readAt ? "" : "border-primary/40 bg-primary/5"}`}
                    >
                      <span className="text-xl" aria-hidden>{ICON[n.kind] || "🔔"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold">{n.title}</span>
                          {!n.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label={t("unread", "unread")} />}
                        </span>
                        <span className="mt-0.5 block text-sm text-muted-foreground">{n.body}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{ago(n.createdAt)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <aside className="card h-fit space-y-1 p-4" aria-label={t("Reminder settings", "Reminder settings")}>
            <h2 className="text-sm font-semibold">{t("What should we remind you about?", "Kis cheez ka reminder chahiye?")}</h2>
            {prefs && (
              <>
                {toggle("tests", "Unfinished tests, come-back nudges", "Adhure test, wapas aane ka reminder")}
                {toggle("streak", "Save my streak", "Meri streak bachao")}
                {toggle("weakTopic", "Weak topic practice", "Kamzor topic ki practice")}
                {toggle("news", "New tests and messages from admin", "Naye test aur admin ke messages")}
                <label className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>{t("Daily reminder time", "Roz reminder ka time")}</span>
                  <select className="rounded-md border border-border bg-background px-2 py-1 text-sm" value={prefs.remindHourIst} onChange={(e) => void save({ remindHourIst: Number(e.target.value) })}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>{hourLabel(h)}</option>
                    ))}
                  </select>
                </label>
                <div className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>{paused ? t(`Paused until ${paused.toLocaleDateString()}`, `${paused.toLocaleDateString()} tak band`) : t("Pause all reminders", "Sab reminders rokein")}</span>
                  {paused ? (
                    <button className="btn btn-outline btn-sm" onClick={() => void save({ pauseDays: 0 })}>{t("Resume", "Chalu karo")}</button>
                  ) : (
                    <button className="btn btn-outline btn-sm" onClick={() => void save({ pauseDays: 3 })}>{t("3 days", "3 din")}</button>
                  )}
                </div>
                <div className="mt-2 border-t border-border pt-3 text-sm">
                  <p className="font-medium">{t("Phone alerts", "Phone alerts")}</p>
                  {perm === "granted" ? (
                    <p className="text-muted-foreground">{t("On for this device.", "Is device par on hain.")}</p>
                  ) : pushSupported() && perm !== "denied" ? (
                    <button className="btn btn-primary btn-sm mt-1" onClick={() => void enablePush()}>{t("Turn on", "On karo")}</button>
                  ) : (
                    <p className="text-muted-foreground">{perm === "denied" ? t("Blocked in the browser settings. Reminders still show here.", "Browser settings me block hai. Reminders yahin dikhenge.") : t("Not available here. Reminders still show here.", "Yahan available nahi. Reminders yahin dikhenge.")}</p>
                  )}
                </div>
                {msg && <p className="pt-1 text-xs text-muted-foreground" role="status">{msg}</p>}
              </>
            )}
          </aside>
        </div>
      )}
    </AppShell>
  );
}
