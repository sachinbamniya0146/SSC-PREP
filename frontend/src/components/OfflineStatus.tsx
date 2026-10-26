"use client";

import * as React from "react";
import { useT } from "@/lib/i18n";
import { WARM_URLS, getSwStatus, lastWarmAt, requestPersistentStorage, swSupported, useOnline, warmPages, type SwStatus, type WarmProgress } from "@/lib/offline";
import { type OfflinePack, isPackExpired, storageEstimate } from "@/lib/offline-packs";
import { flushPendingSubmits, getPendingSubmits, listLocalAttempts } from "@/lib/offline-submit";

/**
 * One clear screen for "what works with no internet right now":
 *  - is the app itself saved (service worker + pages), and can I refresh that copy
 *  - which packs are downloaded, how big, do their pictures work, when they expire
 *  - how much phone storage is used (and is it protected from automatic clean-up)
 *  - which tests are still waiting to reach the server
 */
export default function OfflineStatus({ packs, onChanged }: { packs: OfflinePack[]; onChanged?: () => void }) {
  const t = useT();
  const online = useOnline();
  const [sw, setSw] = React.useState<SwStatus | null | undefined>(undefined); // undefined = still asking
  const [storage, setStorage] = React.useState<{ usedMb: number; quotaMb: number } | null>(null);
  const [persisted, setPersisted] = React.useState<boolean | null>(null);
  const [warm, setWarm] = React.useState<WarmProgress | null>(null);
  const [warming, setWarming] = React.useState(false);
  const [attempts, setAttempts] = React.useState(listLocalAttempts());
  const [syncing, setSyncing] = React.useState(false);
  const [, tick] = React.useReducer((n: number) => n + 1, 0);

  const load = React.useCallback(async () => {
    setSw(swSupported() ? await getSwStatus() : null);
    setStorage(await storageEstimate());
    try {
      setPersisted((await navigator.storage?.persisted?.()) ?? null);
    } catch {
      setPersisted(null);
    }
    setAttempts(listLocalAttempts());
  }, []);

  React.useEffect(() => {
    void load();
  }, [load, packs.length]);

  // the first save of the app runs in the background: keep the numbers live until every screen is saved
  const allSaved = !!sw?.pages && WARM_URLS.every((u) => sw.pages!.includes(u));
  React.useEffect(() => {
    if (!online || allSaved || sw === null) return;
    const id = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(id);
  }, [online, allSaved, sw, load]);

  const saveApp = async () => {
    setWarming(true);
    setWarm({ type: "WARM_PROGRESS", done: 0, total: WARM_URLS.length, failed: 0 });
    await warmPages(WARM_URLS, setWarm);
    setWarming(false);
    tick();
    await load();
  };

  const syncNow = async () => {
    setSyncing(true);
    await flushPendingSubmits();
    setSyncing(false);
    await load();
    onChanged?.();
  };

  const protect = async () => {
    setPersisted(await requestPersistentStorage());
  };

  const pending = getPendingSubmits();
  const pagesSaved = sw?.pages ? WARM_URLS.filter((u) => sw.pages!.includes(u)).length : 0;
  const swReady = !!sw && sw.version;
  const warmAt = lastWarmAt();
  const appOk = swReady && pagesSaved >= Math.ceil(WARM_URLS.length * 0.8);
  const packOk = (p: OfflinePack) => !isPackExpired(p) && !(p.imagesMissing && p.imagesMissing > 0);
  const readyPacks = packs.filter((p) => !isPackExpired(p));
  const pct = storage && storage.quotaMb ? Math.min(100, Math.round((storage.usedMb / storage.quotaMb) * 100)) : null;

  const row = (ok: boolean | null, label: string, detail: React.ReactNode) => (
    <li className="flex items-start gap-3 py-3">
      <span
        aria-hidden
        className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${ok === null ? "bg-muted-foreground/40" : ok ? "bg-success" : "bg-warning"}`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{label}</p>
        <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>
      </div>
    </li>
  );

  return (
    <section className="card mt-6 p-5 sm:p-6" aria-labelledby="offline-status-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="offline-status-h" className="font-bold">
          {t("Offline status", "Offline status")}
        </h2>
        <span className={`badge ${appOk && readyPacks.length > 0 ? "badge-success" : "badge-warning"}`}>
          {appOk && readyPacks.length > 0 ? t("Ready for offline", "Offline ke liye ready") : t("Needs setup", "Setup baaki hai")}
        </span>
      </div>

      <ul className="mt-2 divide-y divide-border">
        {row(
          sw === undefined ? null : !!appOk,
          t("App saved on this device", "App is device par saved hai"),
          sw === undefined ? (
            t("Checking…", "Check ho raha hai…")
          ) : sw === null ? (
            t("This browser (or the test server) has no offline support. Use Chrome / Edge / Safari on the live site.", "Is browser me offline support nahi hai. Live site par Chrome / Edge / Safari use karein.")
          ) : (
            <>
              {t(`${pagesSaved} of ${WARM_URLS.length} screens saved`, `${WARM_URLS.length} me se ${pagesSaved} screen saved`)}
              {warmAt ? ` · ${t("updated", "update")} ${new Date(warmAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` : ""}
              {" · "}
              <button className="font-semibold text-primary underline disabled:opacity-50" onClick={saveApp} disabled={!online || warming}>
                {warming ? `${warm?.done ?? 0}/${warm?.total ?? WARM_URLS.length}…` : t("Save / refresh now", "Abhi save / refresh karein")}
              </button>
              {!online && <span> ({t("needs internet", "internet chahiye")})</span>}
            </>
          ),
        )}

        {row(
          readyPacks.length > 0 ? packs.every(packOk) : false,
          t("Downloaded practice packs", "Download kiye practice packs"),
          packs.length === 0 ? (
            t("None yet. Download a pack below to practise without internet.", "Abhi koi nahi. Neeche se pack download karein.")
          ) : (
            <ul className="space-y-0.5">
              {packs.map((p) => {
                const exp = isPackExpired(p);
                return (
                  <li key={p.id}>
                    <b className="font-semibold text-foreground">{p.title}</b> · {p.questions.length} Q
                    {exp ? (
                      <span className="text-danger"> · {t("expired, renew online", "expire ho gaya, online renew karein")}</span>
                    ) : p.expiresAt ? (
                      <> · {t("valid till", "valid till")} {new Date(p.expiresAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}</>
                    ) : null}
                    {!exp && p.imagesMissing ? <span className="text-warning"> · {t(`${p.imagesMissing} picture(s) not saved`, `${p.imagesMissing} picture save nahi hui`)}</span> : null}
                  </li>
                );
              })}
            </ul>
          ),
        )}

        {row(
          pending.length === 0,
          t("Waiting to sync", "Sync hone baaki"),
          pending.length === 0 && attempts.every((a) => a.queued === false && Date.now() - a.savedAt > 60000) ? (
            t("Nothing waiting. Every finished test has reached the server.", "Kuch baaki nahi. Har finished test server tak pahunch gaya.")
          ) : (
            <>
              {t(`${pending.length} finished test(s) saved on this phone`, `${pending.length} finished test is phone par saved hain`)}
              {" · "}
              <button className="font-semibold text-primary underline disabled:opacity-50" onClick={syncNow} disabled={!online || syncing || pending.length === 0}>
                {syncing ? t("Syncing…", "Sync ho raha hai…") : t("Sync now", "Abhi sync karein")}
              </button>
              {attempts.filter((a) => !a.queued).length > 0 && (
                <span className="block">{t(`${attempts.filter((a) => !a.queued).length} test(s) still in progress on this phone`, `${attempts.filter((a) => !a.queued).length} test abhi chal rahe hain`)}</span>
              )}
            </>
          ),
        )}

        {row(
          pct === null ? null : pct < 80,
          t("Phone storage", "Phone storage"),
          storage ? (
            <>
              {storage.usedMb} MB / {storage.quotaMb} MB ({pct}%)
              {" · "}
              {persisted ? (
                t("protected from automatic clean-up", "automatic clean-up se protected")
              ) : (
                <button className="font-semibold text-primary underline" onClick={protect}>
                  {t("Protect my saved data", "Mera saved data protect karein")}
                </button>
              )}
            </>
          ) : (
            t("Your browser does not report storage.", "Browser storage nahi batata.")
          ),
        )}
      </ul>

      <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        {t(
          "Timed mocks (especially strict sectional ones) must be STARTED while online, because the server issues the section timer. After that you can lose internet: the clock keeps running on your phone and answers are delivered when you are back.",
          "Timed mocks (khaaskar strict sectional) online shuru karne hote hain, kyunki section timer server deta hai. Uske baad internet chala jaye to phone par clock chalti rehti hai aur answers wapas online aane par submit ho jaate hain.",
        )}
      </p>
    </section>
  );
}
