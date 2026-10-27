"use client";

/**
 * Device clean-up helpers.
 *
 * The old "offline practice" feature (service-worker page cache, downloadable packs, offline hub) was REMOVED.
 * This file only makes sure nothing it left behind survives on a student's phone:
 *  - Cache Storage entries created by the old service worker
 *  - the "ssc-offline" IndexedDB (downloaded packs carried answers + solutions)
 *  - old localStorage flags
 * and gives logout / account-switch one function that wipes everything account-specific.
 */

import { getApiBase } from "@/lib/api-base";

const LEGACY_LS_KEYS = ["ssc_offline_meta", "ssc_offline_uid", "ssc_warm_at", "ssc_warm_ver"];
const LEGACY_DB = "ssc-offline";
const PURGED_FLAG = "ssc_legacy_offline_purged_v1";

async function deleteAllCaches(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    /* Cache Storage not available (private mode / old browser) */
  }
}

function deleteLegacyDb(): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve();
      const req = indexedDB.deleteDatabase(LEGACY_DB);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Wipes everything the removed offline feature stored. Safe to call any number of times. */
export async function purgeLegacyOfflineData(): Promise<void> {
  await Promise.all([deleteAllCaches(), deleteLegacyDb()]);
  try {
    LEGACY_LS_KEYS.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/** One-time purge per device (runs on the first visit after this update). */
export async function purgeLegacyOfflineDataOnce(): Promise<void> {
  try {
    if (localStorage.getItem(PURGED_FLAG) === "1") return;
    await purgeLegacyOfflineData();
    localStorage.setItem(PURGED_FLAG, "1");
  } catch {
    /* ignore */
  }
}

/** Logout: drop every cached / saved copy so the next person on a shared phone sees nothing of this account. */
export async function clearUserCaches(): Promise<void> {
  await purgeLegacyOfflineData();
}

// ---------------------------------------------------------------------------------------------------------------
// Logout (27 Oct 2026). Before this the Logout button only wiped the browser: the server was never told, so the
// refresh token and device session stayed valid, and `localStorage.clear()` also threw away the student's theme /
// language and any finished test that was still waiting to be sent. Now:
//  1. the server session is revoked (best effort — logging out never waits for, or fails because of, the network);
//  2. everything account-specific is removed from localStorage + sessionStorage (tokens, profile, active attempt,
//     sectional / year-wise stashes) so the next person on a shared phone starts clean;
//  3. device preferences and a test that is still queued for sending are KEPT.
// ---------------------------------------------------------------------------------------------------------------
const KEEP_EXACT = new Set(["theme", "ssc_lang", "ssc_review_lang", "ssc_install_dismissed", "ssc_legacy_offline_purged_v1", "ssc_pending_submits"]);
// drafts of a queued (unsent) submit must survive, otherwise the queue has nothing to send for them
const KEEP_PREFIX = ["ssc_attempt_draft_", "ssc_attempt_start_"];

export async function logoutAndClear(): Promise<void> {
  try {
    const at = localStorage.getItem("ssc_access_token");
    const rt = localStorage.getItem("ssc_refresh_token");
    if (at && rt) {
      // keepalive: the request still goes out while the page navigates to /login
      void fetch(`${getApiBase()}/auth/logout`, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${at}` },
        body: JSON.stringify({ refreshToken: rt }),
      }).catch(() => undefined);
    }
  } catch {
    /* ignore */
  }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (KEEP_EXACT.has(k) || KEEP_PREFIX.some((p) => k.startsWith(p))) continue;
      localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
  await clearUserCaches();
}
