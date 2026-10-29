#!/usr/bin/env bash
# SESSION42-other-exam-patterns - apply script (CHECK -> APPLY -> VERIFY).
# Works on Termux (md5sum) and macOS (md5 -q). Safe to run twice. Changes NOTHING if anything looks wrong.
#   bash apply-fix.sh [path-to-repo]      (default: the current folder, or ~/SSC-PREP)
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
PKG="$HERE/files"
NAME="SESSION42-other-exam-patterns"

# path|baseMd5|newMd5   ("-" = file absent; new "-" = delete the file)
TABLE='UPDATE_S42_OTHER_EXAM_PATTERNS_OCT2026.md|-|59df9da7b0b3a974f2a01287ebf17c1f
backend/src/admin/admin.controller.ts|17a701b9b54c3e8513df9896cc9246f7|d56a7f0c6300c084f153cb5beaab7491
backend/src/bank/pyq-paper-builder.ts|c3bb3250c726b860b10656a253cc205a|179f02697895d0771e02d81d7f6ed0f9
backend/src/common/exam-presets.catalog.spec.ts|-|625f16889190f71322b3cc5216a2aa38
backend/src/common/exam-presets.ts|0a8dd6b8d1d5e39d6605c82db9ec6f13|fd8951e2a01c5cecead3fe3e3902c075
backend/src/common/marking.spec.ts|22e66bf346afec45d2a1ba37c58e2546|532e2179a69eb0e62f1184fbd1e36292
backend/src/common/marking.ts|3657586c912272269929e918fb9b9b39|273a665332269d499f7a1f45230a342f
frontend/src/app/admin/patterns/page.tsx|6503de68f892e33781c7439fed6cfe23|5ac779423118dc5be1c4ffde4f08def6'

md5of() {
  if command -v md5sum >/dev/null 2>&1; then md5sum "$1" | cut -d' ' -f1; else md5 -q "$1"; fi
}

# ---- find the repo ----
REPO="${1:-}"
if [ -z "$REPO" ]; then
  if [ -f "./backend/prisma/schema.prisma" ]; then REPO="."; elif [ -f "$HOME/SSC-PREP/backend/prisma/schema.prisma" ]; then REPO="$HOME/SSC-PREP"; fi
fi
if [ -z "$REPO" ] || [ ! -f "$REPO/backend/prisma/schema.prisma" ] || [ ! -f "$REPO/frontend/package.json" ]; then
  echo "STOP: cannot find the SSC-PREP repo. Run:  bash apply-fix.sh ~/SSC-PREP"
  exit 1
fi
REPO="$(cd "$REPO" && pwd)"
echo "$NAME -> repo: $REPO"

# ---- CHECK ----
total=0; todo=0; done_=0; bad=0; damaged=0
while IFS='|' read -r rel base new; do
  [ -z "$rel" ] && continue
  total=$((total + 1))
  if [ "$new" != "-" ]; then
    if [ ! -f "$PKG/$rel" ] || [ "$(md5of "$PKG/$rel")" != "$new" ]; then
      echo "  DAMAGED PACKAGE FILE: $rel"; damaged=$((damaged + 1)); continue
    fi
  fi
  if [ -f "$REPO/$rel" ]; then cur="$(md5of "$REPO/$rel")"; else cur="-"; fi
  if [ "$cur" = "$new" ]; then
    done_=$((done_ + 1))
  elif [ "$cur" = "$base" ]; then
    todo=$((todo + 1))
  else
    echo "  DIFFERENT FROM THE BASE: $rel"; bad=$((bad + 1))
  fi
done <<EOF_TABLE
$TABLE
EOF_TABLE

if [ "$damaged" -gt 0 ] || [ "$bad" -gt 0 ]; then
  echo "STOP: $damaged damaged package file(s), $bad repo file(s) differ from the version this package was made for."
  echo "Nothing was changed. Run 'git status' and 'git pull', then try again; if it still stops, send this output."
  exit 1
fi
if [ "$todo" -eq 0 ]; then
  echo "nothing to do - all $total files already match."
  exit 0
fi
echo "OK: $todo to update ($done_ already match)"

# ---- APPLY ----
BACKUP="$(dirname "$REPO")/ssc-backup-$NAME-$(date +%Y%m%d-%H%M%S)"
while IFS='|' read -r rel base new; do
  [ -z "$rel" ] && continue
  if [ -f "$REPO/$rel" ]; then cur="$(md5of "$REPO/$rel")"; else cur="-"; fi
  [ "$cur" = "$new" ] && continue
  if [ -f "$REPO/$rel" ]; then
    mkdir -p "$BACKUP/$(dirname "$rel")" && cp -p "$REPO/$rel" "$BACKUP/$rel" || { echo "STOP: could not back up $rel - nothing more was changed."; exit 1; }
  fi
  if [ "$new" = "-" ]; then
    rm -f "$REPO/$rel"
  else
    mkdir -p "$REPO/$(dirname "$rel")" && cp "$PKG/$rel" "$REPO/$rel" || { echo "ERROR: could not write $rel"; exit 1; }
  fi
done <<EOF_TABLE
$TABLE
EOF_TABLE
[ -d "$BACKUP" ] && echo "backup of the replaced files: $BACKUP"

# ---- VERIFY ----
fail=0
while IFS='|' read -r rel base new; do
  [ -z "$rel" ] && continue
  if [ -f "$REPO/$rel" ]; then cur="$(md5of "$REPO/$rel")"; else cur="-"; fi
  if [ "$cur" != "$new" ]; then echo "  VERIFY FAILED: $rel"; fail=$((fail + 1)); fi
done <<EOF_TABLE
$TABLE
EOF_TABLE
if [ "$fail" -gt 0 ]; then
  echo "ERROR: $fail file(s) do not match after copying. Send this output."
  exit 1
fi
echo "OK: all $total files match"
