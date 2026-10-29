# Handoff 30 - exam date DD/MM/YYYY only, per-student withdrawal rule (30 Oct 2026)

Rules: `NEXT-CLAUDE-MASTER-PROMPT-V4.md` (Project docs). Same delivery protocol as before: small one-topic zip with `apply-fix.sh`, three push blocks, say what was / was NOT run, check Actions yourself. **Next handoff number is 31.**
Read first: `UPDATE_S46_DATE_DMY_WITHDRAW_RULE_OCT2026.md`.

## What S46 changed
- `examDate` is accepted ONLY as DD/MM/YYYY everywhere an admin types or uploads it (`common/exam-date-format.ts` is the single rule). Stored as YYYY-MM-DD. Exports write DD/MM/YYYY. Excel template has a typing-time rule.
- Admin can set "friends needed to withdraw" per student (0 / 1 / 2 / default) and release a student's pending commission now (`ReferralWallet.withdrawMinFriends`).
- Master Package v9 (outside the repo): prompt section 11E, validator, converter `convert_dates_to_dmy.py`, templates and Odd-One-Out workbooks converted.

## Open / ideas (not done)
1. Nothing from S23 - S46 UI has been seen on a phone (`PHONE_CHECK_CHECKLIST_OCT2026.md`).
2. The Excel typing-time rule is written for Excel / LibreOffice; Google Sheets ignores custom rules on import (the server still refuses a wrong date on upload).
3. `year` vs `examDate` year mismatch is NOT an error on upload (CGL 2024 Tier 2 was held in Jan 2025); only the master-package checker flags it.
4. Old files with `YYYY-MM-DD` now fail with "Write 12/09/2025 instead" - use `convert_dates_to_dmy.py` from the Master Package.
