-- Hindi-medium taxonomy (nameHindi on Subject/Chapter/Topic/SubTopic) +
-- sub_topics(topicId, slug) uniqueness — needed by the bulk syllabus-Excel
-- importer, which reads bilingual names straight out of
-- SSC_Exams_Complete_Syllabus_Hindi.xlsx-style sheets (each cell is
-- "English\nHindi"), and needs to be safely re-runnable on the same file
-- without creating duplicate rows.
--
-- IF NOT EXISTS everywhere — safe to run even if partially applied by hand.
-- If the CREATE UNIQUE INDEX step fails, you already have duplicate
-- (topicId, slug) rows in sub_topics — find them first with:
--   SELECT "topicId", slug, COUNT(*) FROM sub_topics GROUP BY "topicId", slug HAVING COUNT(*) > 1;

ALTER TABLE "subjects"   ADD COLUMN IF NOT EXISTS "nameHindi" TEXT;
ALTER TABLE "chapters"   ADD COLUMN IF NOT EXISTS "nameHindi" TEXT;
ALTER TABLE "topics"     ADD COLUMN IF NOT EXISTS "nameHindi" TEXT;
ALTER TABLE "sub_topics" ADD COLUMN IF NOT EXISTS "nameHindi" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "sub_topics_topicId_slug_key" ON "sub_topics"("topicId", "slug");
