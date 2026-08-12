-- v5 §37 VERIFIED_COMPUTED: store the deterministic derivation backing the status
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "verificationEvidence" TEXT;
