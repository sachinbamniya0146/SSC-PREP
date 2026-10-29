#!/usr/bin/env bash
# SESSION43-syllabus-all-exams - apply script (CHECK -> APPLY -> VERIFY).
# Works on Termux (md5sum) and macOS (md5 -q). Safe to run twice. Changes NOTHING if anything looks wrong.
#   bash apply-fix.sh [path-to-repo]      (default: the current folder, or ~/SSC-PREP)
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
PKG="$HERE/files"
NAME="SESSION43-syllabus-all-exams"

# path|baseMd5|newMd5   ("-" = file absent; new "-" = delete the file)
TABLE='UPDATE_S43_SYLLABUS_ALL_EXAMS_OCT2026.md|-|2393635a1539b91a824d3203155fb45d
backend/src/bank/taxonomy-import.workbook.spec.ts|-|c07e82abb524665abf03ceab074253e5
backend/src/common/syllabus-import-plan.spec.ts|3c4848320080553ad7e3b9a339b39cbe|500d3c853617568bd2eed60b1d0ca5e3
backend/src/common/syllabus-import-plan.ts|1a12d791117016a82ae101bb24927512|b5455468a2e12822f0f5dc0c7b754b96
docs/syllabus/SSC_PrepHub_Syllabus_All_Exams_v1.xlsx|-|376f135c2aeecdcf5bc36cac0a111263
scripts/audit/xlsx-lite.cjs|e01c232069dd099d6dab86673d96c5b6|c26c8f37dea4a7ef1e5e9254f2c05dbe'

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
