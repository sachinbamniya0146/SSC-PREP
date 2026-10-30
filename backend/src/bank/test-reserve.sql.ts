/**
 * S48 — the "keep half of every topic for tests" rule, as ONE SQL statement (the migration 20261030150000 runs the same logic once).
 *
 * Per leaf (sub-topic, else topic, else chapter, else subject) of live PRACTICE questions (year IS NULL):
 *   reservedTarget = floor(n / 2)   -> students always keep at least half in Practice (a leaf with 1 question keeps it in Practice).
 * Only ADDS reserved rows (newest first) and never un-reserves one, so a question a student already practised never moves to the
 * test half and back, and running it twice changes nothing.
 */
export const REBALANCE_TEST_RESERVE_SQL = `
WITH leaf AS (
  SELECT id, COALESCE("subTopicId", "topicId", "chapterId", "subjectId") AS k, "testReserved", "questionNo"
  FROM "questions"
  WHERE "year" IS NULL AND "isActive" = true AND "isApproved" = true AND "autoSuspended" = false
), cnt AS (
  SELECT k, COUNT(*) AS n, COUNT(*) FILTER (WHERE "testReserved") AS r FROM leaf GROUP BY k
), pick AS (
  SELECT l.id,
         ROW_NUMBER() OVER (PARTITION BY l.k ORDER BY l."questionNo" DESC) AS rn,
         (c.n / 2) - c.r AS need
  FROM leaf l JOIN cnt c ON c.k = l.k
  WHERE l."testReserved" = false AND (c.n / 2) > c.r
)
UPDATE "questions" SET "testReserved" = true WHERE "id" IN (SELECT id FROM pick WHERE rn <= need)
`;

/** The same rule in plain TypeScript, for the spec (and for reading): how many MORE rows of a leaf must be reserved. */
export function reserveNeeded(total: number, alreadyReserved: number): number {
  const target = Math.floor(Math.max(0, total) / 2);
  return Math.max(0, target - Math.max(0, alreadyReserved));
}
