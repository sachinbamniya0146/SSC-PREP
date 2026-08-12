-- v3 §6.4 Daily Test: stable per-attempt question composition (ids in order)
ALTER TABLE "test_attempts" ADD COLUMN IF NOT EXISTS "questionSnapshot" JSONB;