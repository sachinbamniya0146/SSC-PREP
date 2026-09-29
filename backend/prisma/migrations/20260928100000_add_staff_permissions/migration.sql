-- Department-level staff permissions (Questions / Practice / Vocabulary / Support).
-- Additive only. Existing MODERATOR accounts previously had access to
-- everything, so they are granted all four permissions here to keep their
-- current access unchanged; admin can then narrow them from /admin/staff.

DO $$ BEGIN
  CREATE TYPE "StaffPermission" AS ENUM ('QUESTIONS', 'PRACTICE', 'VOCABULARY', 'SUPPORT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "permissions" "StaffPermission"[] NOT NULL DEFAULT ARRAY[]::"StaffPermission"[];

UPDATE "users"
   SET "permissions" = ARRAY['QUESTIONS','PRACTICE','VOCABULARY','SUPPORT']::"StaffPermission"[]
 WHERE "role" = 'MODERATOR' AND cardinality("permissions") = 0;
