/**
 * Which sheet of an uploaded workbook holds the questions?
 *
 * Until now every upload path read `wb.SheetNames[0]`. The v3 template (and every workbook the
 * AI Master Prompt produces) puts README / guide sheets BEFORE the data, so the first sheet was
 * a README and the upload failed with "Required column missing: examId".
 *
 * Order of preference:
 *   1. a sheet named "Questions Import"   (Master Prompt output)
 *   2. a sheet named "Questions"          (v3 template, the app's own export)
 *   3. the first sheet whose header row has examId + questionText (a trailing * is ignored)
 *   4. the first sheet                    (single-sheet files behave exactly as before)
 *
 * NOTE: pickQuestionsSheetName is serialised into the Excel worker thread with Function#toString,
 * so it must stay self-contained (no imports, no closures, no outside helpers).
 */
export function pickQuestionsSheetName(
  sheetNames: string[],
  headerOf: (sheetName: string) => unknown[],
): string | undefined {
  if (!sheetNames || sheetNames.length === 0) return undefined;
  var norm = function (s: string) {
    return String(s).toLowerCase().replace(/[\s_\-]+/g, ' ').trim();
  };
  var i: number;
  for (i = 0; i < sheetNames.length; i++) if (norm(sheetNames[i]) === 'questions import') return sheetNames[i];
  for (i = 0; i < sheetNames.length; i++) if (norm(sheetNames[i]) === 'questions') return sheetNames[i];
  for (i = 0; i < sheetNames.length; i++) {
    var row = headerOf(sheetNames[i]) || [];
    var heads: Record<string, boolean> = {};
    for (var j = 0; j < row.length; j++) heads[String(row[j] == null ? '' : row[j]).trim().replace(/\*\s*$/, '').trim()] = true;
    if (heads['examId'] && heads['questionText']) return sheetNames[i];
  }
  return sheetNames[0];
}
