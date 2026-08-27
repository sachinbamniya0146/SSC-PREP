-- FIX Error #4 (CRITICAL — single active session security bypass).
-- Links each refresh_tokens row to the device_sessions row it was issued
-- for, so that logging in on a new device can revoke ONLY the old
-- device's refresh tokens (not every token belonging to the user).
--
-- Existing rows: old refresh tokens issued before this migration will
-- have deviceSessionId = NULL. That is fine — NULL just means "not linked
-- to a session" and auth.service.ts's refresh() code treats a token as
-- invalid once it's revoked or expired anyway; NULL-linked old tokens are
-- not treated as extra-privileged, they simply predate this feature and
-- will expire naturally (JWT_REFRESH_EXPIRES_IN, default 7d).

ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "deviceSessionId" TEXT;

CREATE INDEX IF NOT EXISTS "refresh_tokens_deviceSessionId_idx" ON "refresh_tokens"("deviceSessionId");

ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_deviceSessionId_fkey"
  FOREIGN KEY ("deviceSessionId") REFERENCES "device_sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
