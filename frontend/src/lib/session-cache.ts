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
