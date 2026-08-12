#!/bin/bash
# Daily SSC Prep Hub DB backup — keep last 14 daily + 8 weekly copies
# Runs from host via launchd/cron. Backs up ssc_prep_hub_v2 from ssc-postgres container.
set -euo pipefail

BACKUP_ROOT="/Users/sachin/ssc-prep-hub/backups"
DAILY_DIR="$BACKUP_ROOT/daily"
WEEKLY_DIR="$BACKUP_ROOT/weekly"
STAMP=$(date +%Y%m%d)
KEEP_DAILY=14
KEEP_WEEKLY=8

mkdir -p "$DAILY_DIR" "$WEEKLY_DIR"

# 1. Daily dump (plain SQL, compressed)
docker exec ssc-postgres pg_dump -U postgres -d ssc_prep_hub_v2 --no-owner --no-privileges \
  | gzip > "$DAILY_DIR/ssc_prep_hub_v2_${STAMP}.sql.gz"
echo "daily backup: $(ls -la "$DAILY_DIR/ssc_prep_hub_v2_${STAMP}.sql.gz" | awk '{print $5}') bytes"

# 2. Rotate dailies (keep last 14)
ls -1t "$DAILY_DIR"/ssc_prep_hub_v2_*.sql.gz 2>/dev/null | tail -n +$((KEEP_DAILY + 1)) | xargs -r rm -f 2>/dev/null || true

# 3. Weekly copy (Sunday only) + rotate
DOW=$(date +%u)
if [ "$DOW" = "7" ]; then
  cp "$DAILY_DIR/ssc_prep_hub_v2_${STAMP}.sql.gz" "$WEEKLY_DIR/ssc_prep_hub_v2_weekly_${STAMP}.sql.gz"
  echo "weekly backup taken"
fi
ls -1t "$WEEKLY_DIR"/ssc_prep_hub_v2_weekly_*.sql.gz 2>/dev/null | tail -n +$((KEEP_WEEKLY + 1)) | xargs -r rm -f 2>/dev/null || true

# 4. Sanity: verify the dump is a valid gzip + contains CREATE TABLE
# (use grep -c, NOT grep -q: under pipefail, -q exits early → SIGPIPE → false failure)
if gzip -t "$DAILY_DIR/ssc_prep_hub_v2_${STAMP}.sql.gz" && \
   [ "$(gzip -dc "$DAILY_DIR/ssc_prep_hub_v2_${STAMP}.sql.gz" | grep -c "CREATE TABLE" || true)" -gt 0 ]; then
  echo "BACKUP_OK: valid gzip with tables"
else
  echo "BACKUP_FAILED: corruption check failed" >&2
  exit 1
fi
