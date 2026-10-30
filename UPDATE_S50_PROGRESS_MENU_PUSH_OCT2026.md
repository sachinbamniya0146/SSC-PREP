# S50 - My progress (study counts), top-left phone menu, push that really arrives, all-topic coverage (30 Oct 2026)

## 1. My progress (`/progress`, menu "My progress")
`GET /study-stats?period=today|week|month|year|all` (`study-stats/`): every ANSWERED question of a FINISHED test or practice set (skipped questions and running attempts are not counted).
- Totals for today / this week (Mon-Sun) / this month / this year / since the first answer, each with right / wrong / accuracy; first day + number of study days.
- Series: last 30 days, 12 weeks, 12 months (a quiet day is a zero bar).
- Subject -> chapter split for the chosen period, Hindi + English names, accuracy per chapter, "Practice" button on chapters under 60%.
- All "days" are IST days (an answer at 00:30 IST is today).
- Dashboard strip "Questions I solved" (today / week / month / since start) links to it.
- The SQL was run against a REAL PostgreSQL 16 with all 62 migrations applied (`scripts/audit/study-stats-sim.cjs`, 17 checks ALL OK).

## 2. Phone menu
A menu button at the TOP-LEFT of the header (phones) opens one left drawer with every student option, plus Admin (staff) and Log out. The bottom-bar "Menu" tab opens the same drawer. One component: `StudentDrawer` (mounted in the layout).

## 3. Tests from practice questions cover all topics
Smart mock: inside each subject section every topic the exam asked (and that has questions) gets at least ONE question when the section is big enough, then the PYQ weightage splits the rest (`allocateWithCaps(..., coverAll)`). A topic the exam never asked is still never used.

## 4. Notifications that really arrive
- Silent re-sync: a signed-in student who already allowed notifications is re-registered on every app start (a phone can lose or rotate its subscription; one phone can have two accounts). Before this, a stale subscription meant silence.
- Admin screen shows "Phone alerts ON / OFF" with the number of reachable students and phones (`GET /push/admin/status`).
- Phone alerts need VAPID keys ON THE SERVER. Create them once (any computer or Termux with Node):

```
node -e "const c=require('crypto');const e=c.createECDH('prime256v1');e.generateKeys();const b=x=>x.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');console.log('VAPID_PUBLIC_KEY='+b(e.getPublicKey()));console.log('VAPID_PRIVATE_KEY='+b(Buffer.from(e.getPrivateKey('hex').padStart(64,'0'),'hex')))"
```
Put both lines into `/opt/ssc-prep-hub/.env` on the server, then deploy once more: the deploy workflow reads `VAPID_PUBLIC_KEY` from that file and bakes it into the frontend build (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`). Keep the private key secret; do not change the keys later (every student would have to allow notifications again).
- Android (Chrome / installed app): shows in the notification bar. iPhone: only after "Add to Home Screen" (Apple's rule). The in-app inbox works everywhere.

## Checked
Specs: study-stats.util (7), test-blueprint (+4). Sims: study-stats (real Postgres), builder, notify, batch-scoring, sidebar-boot. Real Postgres: all 62 migrations (3 of them re-run twice), test-reserve SQL (floor(n/2), second run 0 changes). minilint 0. tsc base-vs-mod no new real errors.
NOT run: jest, eslint, next build, prisma generate, a browser or phone, a real push service.
