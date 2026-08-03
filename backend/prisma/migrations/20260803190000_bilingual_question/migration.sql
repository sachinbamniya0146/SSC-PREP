-- SSC Prep Hub: add bilingual explanation + AI translation status on Question.
-- v3 bilingual mandate: questionTextHindi exists; add explanationHindi so both
-- languages have full question + solution. translationStatus marks AI-generated
-- (AUTO_UNVERIFIED) vs human-verified, per v2 Rule 7.

CREATE TYPE "TranslationStatus" AS ENUM ('HUMAN_VERIFIED', 'AUTO_UNVERIFIED');

ALTER TABLE "questions" ADD COLUMN "explanationHindi" text;
ALTER TABLE "questions" ADD COLUMN "translationStatus" "TranslationStatus" NOT NULL DEFAULT 'HUMAN_VERIFIED';