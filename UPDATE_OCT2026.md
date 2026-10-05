# Update — Oct 2026 (student experience + admin tools)

## Deploy notes
- New migration `20261004100000_ai_solution_votes` (runs automatically via `prisma migrate deploy` in the backend container).
- Re-build both containers (`deploy.sh` does this). No new env variables required.
- `APP_BASE_URL` (optional, backend env): used for referral share links; defaults to https://sscprephub.in.

## What changed
- **AI solutions** are labelled "AI generated". Students who attempted the question can confirm / dispute them.
  10 distinct confirmations -> saved permanently (`COMMUNITY_VERIFIED`, shown as "Verified by students").
  5+ disputes outnumbering confirmations -> AI text dropped and regenerated for the next student.
- **Refer & earn**: referral code now works for Google signups, code is normalised, one referrer per student, no self-referral,
  "apply a friend's code" box on the referral page, referral errors can no longer fail a paid purchase.
- **Weak topics -> practice**: after a test, "What to do next" lists weak topics/sub-topics of THAT submission (wrong + skipped),
  grouped Subject -> Chapter; the student ticks topics, chooses how many questions per topic, and starts one custom practice set.
- **Offline-safe tests**: answers are mirrored on the device, the final submit is queued if the network is down and sent
  automatically later; the server honours answers finished inside the test window (6 h replay limit).
- **Subject-wise analysis** with drill-down: subject -> chapters -> topics/sub-topics.
- **Vocabulary admin**: move any word to any position, Fix numbering, full word editing. Students who already could open a word keep it unlocked.
- **Profile**: Google photo (also shown to admin), edit name/mobile, English/Hinglish language switch (English is the default).
- **Back button** follows the in-app trail instead of raw browser history.
- **Cleanup**: removed one-off import data and parse/upload scripts, and the seed that re-created deleted mock templates on every deploy
  (`seed-mocks.mjs` now only seeds an EMPTY database).

## Known limits
- Offline replay trusts the client's finish timestamp (bounded to the test window + 6 h).
- Only the screens listed in `frontend/src/lib/i18n.ts` users switch to Hinglish; older admin screens are unchanged.
