#!/usr/bin/env bash
# SESSION41-exam-catalog-spelling - apply script (CHECK -> APPLY -> VERIFY).
# Works on Termux (md5sum) and macOS (md5 -q). Safe to run twice. Changes NOTHING if anything looks wrong.
#   bash apply-fix.sh [path-to-repo]      (default: the current folder, or ~/SSC-PREP)
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
PKG="$HERE/files"
NAME="SESSION41-exam-catalog-spelling"

# path|baseMd5|newMd5   ("-" = file absent; new "-" = delete the file)
TABLE='UPDATE_S41_EXAM_CATALOG_SPELLING_OCT2026.md|-|7f62e64f716b13ed8c1e336567195108
backend/src/admin/admin.controller.ts|cbce64840ece88987c1a425076d31893|17a701b9b54c3e8513df9896cc9246f7
backend/src/bank/bank-upload.service.ts|4e0f5599a01617da3943a5393f6cfb9b|bc3709d7844a339306373d366b1e1994
backend/src/bank/bank.service.ts|06f6ccd249091aeca61eac4696f419e5|a2c91ede2b59284470e39f896ce2777a
backend/src/bank/pyq-paper-builder.ts|50b2a4c8b195a7e94a563a8943171e46|c3bb3250c726b860b10656a253cc205a
backend/src/bank/question-edit.service.ts|969dd0688550429742b11c8de615b0f7|4548263d78c6fdb5442a57dfd03ff66c
backend/src/bank/taxonomy-import.service.ts|e8f910d89c83cd35db754d10725fff81|4e0b704c5e4cfac63a9a01b3fc119125
backend/src/bank/taxonomy-import.spelling.spec.ts|-|86131739ff0408e34e5346dd053e747a
backend/src/bank/upload-preview.ts|031d22ad015e0687410cb6aeb3a64d8d|97fac3446753271e8472c91dcfb19948
backend/src/common/common-exams.spec.ts|5ac523f9d23ac5aa06d863dd4275edb6|02e179a643897614126d536b58ee4ac8
backend/src/common/common-exams.ts|5ee1c234f1b1974346af27c812ddcc14|5c33a6092045a2c42ac2f810c813947f
backend/src/common/exam-presets.ts|639a4871d174ce5573998bb59e8eabb9|0a8dd6b8d1d5e39d6605c82db9ec6f13
backend/src/common/marking.ts|4dd706a0951f2a3cac6934638fe24889|3657586c912272269929e918fb9b9b39
backend/src/common/question-visibility.ts|2ec12b616afec02ac8e4e94b79be2765|51d84726def52d713bd4f6929205d1b5
backend/src/common/section-plan.ts|5f7348993512e18fc7d530b3de7621b0|6a3b35a922cc96d3df8ead2f965ba576
backend/src/common/slug-core.spec.ts|-|ea2f7a5d1c72206ca7e794d4f697f882
backend/src/common/slug-core.ts|-|45e93f76753ae38732dd7600b6f6cb21
backend/src/common/syllabus-import-plan.spec.ts|-|3c4848320080553ad7e3b9a339b39cbe
backend/src/common/syllabus-import-plan.ts|-|1a12d791117016a82ae101bb24927512
backend/src/pdf-export/pdf-export.service.ts|e427ea834c9e358fdee4cba704751281|9a5fab48b3fa25bff7d687476a64ccf8
backend/src/study-plan/study-plan-v2.service.ts|d1b9e42215a579b381f15be611c23115|16b9256e0e5c112741bbac2a9799e823
backend/src/tests/daily-test.service.ts|1554058a77e38a52d5c06ab884cd6fc2|bffb81b9371c63024950c4a862ea7516
backend/src/tests/tests.service.ts|27f7c1d1da163eb329adfcd430dc416b|eabb9d30a04be80bcfde4176c832e8ed
frontend/src/app/admin/exams/page.tsx|d416b470f45cdc10cc9bbbdd36fd291c|30ba7f4bad1aa407de2af6c7f17fd20b
frontend/src/app/admin/pyq-dates/page.tsx|b6df678de93ac4276b077004d51e07fc|c81c65a58324f002f617cde5b964a126
frontend/src/app/admin/pyq-export/page.tsx|b217c772e0be94045a59b988ca036712|d6b469aa33d969d74694d0b2a7ddfbfa
frontend/src/app/admin/questions/add/page.tsx|592921bc8c7b65d5531967a6f7276d49|e06f0ca7124b6fd24fa0620da5155543
frontend/src/app/admin/questions/edit/page.tsx|d175ceed3ca0aaa0adc4c93909e9d293|03f032ebde2e4f0b23cacf1096ef62b4
frontend/src/app/admin/questions/manage/page.tsx|c2c71c2b738cec7dd5776834bd54e200|b422c44e9e0dcd318ce669be1ded7162
frontend/src/app/study-plan/page.tsx|00f5dc6ce97d90ed0f9eadc730dabed6|f4231bdf13247290d860859e65ca0489'

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
