-- Answer key corrected after students finished: an admin can re-score the affected attempts. The first score and a note are kept on the attempt.
-- Additive only and re-run safe (IF NOT EXISTS, nullable columns, no back-fill needed: NULL = never re-scored).

ALTER TABLE "test_attempts" ADD COLUMN IF NOT EXISTS "rescoredAt"          TIMESTAMP(3);
ALTER TABLE "test_attempts" ADD COLUMN IF NOT EXISTS "scoreBeforeRescore"  DOUBLE PRECISION;
ALTER TABLE "test_attempts" ADD COLUMN IF NOT EXISTS "rescoreNote"         TEXT;
