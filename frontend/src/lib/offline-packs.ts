/**
 * Offline practice packs, stored in IndexedDB (plenty of room, unlike localStorage).
 * A pack is a set of questions WITH answers + explanations (same payload /bank/set already serves to the
 * practice screen), so a student can practise with no internet and see instant feedback.
 */
export type PackOption = {
  key: string;
  text: string;
  textHi?: string | null;
  diagramType?: string | null;
  diagramLabels?: (string | null)[] | null;
  imageUrl?: string | null;
};

export type PackQuestion = {
  id: string;
  questionText: string;
  questionTextHindi?: string | null;
  questionDiagramType?: string | null;
  questionDiagramLabels?: (string | null)[] | null;
  questionImageUrl?: string | null;
  options: PackOption[];
  chapter?: string;
  examName?: string | null;
  year?: number | null;
  shift?: string | null;
  marks?: number;
  negativeMarks?: number;
  correctAnswer: string | null;
  explanation?: string | null;
  explanationHindi?: string | null;
};

export type OfflinePack = {
  id: string;
  title: string;
  examId: string;
  examName: string;
  subjectId: string;
  subjectName: string;
  createdAt: number;
  questions: PackQuestion[];
  /** account that downloaded it: a pack never opens for another account (shared phones) */
  userId?: string;
  /** after this moment the pack must be renewed online (access / paywall may have changed) */
  expiresAt?: number;
  /** every picture the pack needs (kept in the never-trimmed pack image cache) */
  imageUrls?: string[];
  /** images that could NOT be saved, so the status screen can say "2 images missing" */
  imagesMissing?: number;
};

export const PACK_TTL_DAYS = 30;
export const isPackExpired = (p: OfflinePack, now = Date.now()) => !!p.expiresAt && now > p.expiresAt;
export const packImages = (qs: PackQuestion[]): string[] =>
  Array.from(new Set(qs.flatMap((q) => [q.questionImageUrl, ...q.options.map((o) => o.imageUrl)]).filter((u): u is string => !!u)));
export const currentUserId = (): string | null => {
  try {
    return (JSON.parse(localStorage.getItem("ssc_user") || "null")?.id as string | undefined) ?? null;
  } catch {
    return null;
  }
};

export type OfflineResult = {
  id?: number;
  packId: string;
  title: string;
  at: number;
  total: number;
  correct: number;
  wrong: number;
  skipped: number;
  score: number;
  maxScore: number;
};

const DB_NAME = "ssc-offline";
const DB_VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB not available"));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("packs")) db.createObjectStore("packs", { keyPath: "id" });
      if (!db.objectStoreNames.contains("results")) db.createObjectStore("results", { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = run(t.objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    t.oncomplete = () => db.close();
    t.onabort = () => reject(t.error);
  });
}

export const savePack = (p: OfflinePack) => tx("packs", "readwrite", (s) => s.put(p));
export const getPack = (id: string) => tx<OfflinePack | undefined>("packs", "readonly", (s) => s.get(id));
export const deletePack = (id: string) => tx("packs", "readwrite", (s) => s.delete(id));
export async function listPacks(): Promise<OfflinePack[]> {
  const all = await tx<OfflinePack[]>("packs", "readonly", (s) => s.getAll());
  const uid = currentUserId();
  // another account's packs are deleted on sight (answers + solutions inside)
  const foreign = all.filter((p) => p.userId && uid && p.userId !== uid);
  for (const p of foreign) await deletePack(p.id).catch(() => undefined);
  return all.filter((p) => !foreign.includes(p)).sort((a, b) => b.createdAt - a.createdAt);
}
export const saveResult = (r: OfflineResult) => tx("results", "readwrite", (s) => s.add(r));
export async function listResults(limit = 20): Promise<OfflineResult[]> {
  const all = await tx<OfflineResult[]>("results", "readonly", (s) => s.getAll());
  return all.sort((a, b) => b.at - a.at).slice(0, limit);
}
export async function clearAllOfflineData(): Promise<void> {
  try {
    await tx("packs", "readwrite", (s) => s.clear());
    await tx("results", "readwrite", (s) => s.clear());
  } catch {
    /* ignore */
  }
}

export async function storageEstimate(): Promise<{ usedMb: number; quotaMb: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    return { usedMb: Math.round(((e.usage ?? 0) / 1048576) * 10) / 10, quotaMb: Math.round((e.quota ?? 0) / 1048576) };
  } catch {
    return null;
  }
}
