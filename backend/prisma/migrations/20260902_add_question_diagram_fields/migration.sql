-- FEATURE (Session 22): Venn/figure-based diagram questions (e.g. "select
-- the correct Venn diagram" reasoning MCQs — common in SSC CGL/CHSL papers).
--
-- Diagrams are stored as a TYPE CODE (from a fixed taxonomy, see
-- backend/src/bank/diagram-types.ts) + plain-text labels — never as image
-- files. The frontend renders the actual SVG from (type, labels) at request
-- time, so this scales to bulk-uploading thousands of such questions with
-- zero image storage/CDN cost, and always renders crisp on any screen size.
--
-- Two new nullable columns on "questions" for when the QUESTION STEM itself
-- is a diagram (e.g. "which of the following best represents Biology,
-- Zoology, Animal Geography" shown as a 3-circle figure). When an OPTION
-- (not the stem) is the diagram instead — the far more common case, e.g.
-- "select the correct Venn diagram" with 4 diagram choices — that is stored
-- inside the existing "optionsJson" column instead (it's already JSON, so
-- no migration needed there: each option object may now optionally carry
-- diagramType / diagramLabels alongside its existing key/text/textHi).
--
-- Both columns are nullable and default to unset, so every existing text
-- question is completely unaffected — this is purely additive.

ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "questionDiagramType" TEXT;
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "questionDiagramLabels" JSONB;
