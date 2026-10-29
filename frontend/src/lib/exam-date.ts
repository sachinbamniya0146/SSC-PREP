// Exam dates: the server stores YYYY-MM-DD, but everything an admin reads, types or uploads uses ONE format: DD/MM/YYYY.
export function isoToDmy(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? "").trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** "12/09/2025" -> "2025-09-12" (null when it is not a real DD/MM/YYYY date). */
export function dmyToIso(dmy: string | null | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(dmy ?? "").trim());
  if (!m) return null;
  const d = +m[1], mo = +m[2], y = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (y < 2000 || y > 2100 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}
