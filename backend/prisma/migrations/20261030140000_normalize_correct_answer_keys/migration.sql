-- S47: old rows may hold the answer key as "a", " B", "C ", "(D)", "A)" ... Every scoring site now compares trimmed + upper-cased, but
-- reports, exports and older code paths read the raw column. Make the stored value the plain letter A-D.
-- Only a value that is unambiguously ONE letter (with optional spaces / brackets / dot) is touched; anything else is left for the admin.
-- Re-run safe: after the first run no row matches the WHERE.
UPDATE "questions"
SET "correctAnswer" = UPPER(SUBSTRING(BTRIM("correctAnswer") FROM '^[\(\[]?\s*([A-Da-d])\s*[\)\]\.:]?$'))
WHERE "correctAnswer" IS NOT NULL
  AND "correctAnswer" !~ '^[A-D]$'
  AND BTRIM("correctAnswer") ~ '^[\(\[]?\s*[A-Da-d]\s*[\)\]\.:]?$';
