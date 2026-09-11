-- Sachin, Sep 2026 session — Phase 2 (Admin Topic/SubTopic manager +
-- Hindi-medium taxonomy).
--
-- 1) nameHindi on Subject/Chapter/Topic/SubTopic — needed for the upcoming
--    Hindi-medium toggle (chapter/topic/subject names in Hindi) AND for the
--    bulk syllabus-Excel taxonomy importer, which reads bilingual names
--    straight out of your SSC_Exams_Complete_Syllabus_Hindi.xlsx-style
--    sheets (each cell "English\nHindi").
--
-- 2) sub_topics(topicId, slug) unique index — SubTopic was the ONLY one of
--    the four taxonomy levels without a uniqueness constraint (Chapter has
--    subjectId+slug, Topic has chapterId+slug already). Without it,
--    createSubTopic() can't be idempotent and the bulk importer would
--    create duplicate rows every time the same Excel is re-uploaded.
--
-- IF NOT EXISTS everywhere — safe to run even if partially applied by hand.
-- If the CREATE UNIQUE INDEX step fails, you have duplicate (topicId, slug)
-- rows already in sub_topics — run this first to find them:
--   SELECT "topicId", slug, COUNT(*) FROM sub_topics GROUP BY "topicId", slug HAVING COUNT(*) > 1;

ALTER TABLE "subjects"   ADD COLUMN IF NOT EXISTS "nameHindi" TEXT;
ALTER TABLE "chapters"   ADD COLUMN IF NOT EXISTS "nameHindi" TEXT;
ALTER TABLE "topics"     ADD COLUMN IF NOT EXISTS "nameHindi" TEXT;
ALTER TABLE "sub_topics" ADD COLUMN IF NOT EXISTS "nameHindi" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "sub_topics_topicId_slug_key" ON "sub_topics"("topicId", "slug");
