# S49 - free limits for built tests, practice time, resume everywhere (30 Oct 2026)

## Free vs plan (server-enforced, `common/free-limits.ts`, shown on the Premium page)
- PYQ mocks: top 10 newest free (unchanged, `isPyqMockFreeForStart`).
- Smart mocks (built from the practice bank for one exam): **10 free per student in total** (`FREE_SMART_MOCKS`).
- Custom tests (student picks topics, count, minutes): **5 free per IST day** (`FREE_CUSTOM_TESTS_PER_DAY`).
- Any ACTIVE plan (the Rs 19 one or any other), admin and moderator: unlimited. A lapsed plan is a free student again.
- Over the limit: HTTP 400 `PREMIUM_REQUIRED` with English + Hindi text; /build-test shows "N left" and disables Start; /test offers the plans.
- `GET /tests/builder/quota`. Counting is by real attempts (`TestAttempt` of a "Smart mock" / "Custom test" template), so a refused or failed start costs nothing.
- ASSUMPTION to confirm with the owner: "top 10 practice-bank mocks free" = 10 smart mocks per student (they are generated, not pre-made).

## Practice sets: fixed or own time
Practice set instruction screen (client-timed sets from Question-Bank-Practice) now has "Standard (30 s per question)" or the student's own minutes (1-300). Server-timed exams are unchanged.

## Resume
`UnfinishedTests` card ("Continue where you left off") on the dashboard and on the history page, from `/tests/attempts/active`; the front pop-up from S48 stays. Back button inside any test / practice set already opens Continue / Submit / Leave for now (S48).

## Already in place (checked, not changed)
- No repeated question for a student: the builder prefers questions the student has not answered yet and only repeats when the topic is used up (`pickQuestions`, `seen`).
- Weightage and exam format: smart mock = the exam pattern's sections and question counts, topics only from that exam's PYQs, weight = PYQ count; a subject / topic the exam never asked is not used. New uploads join automatically (the reserve job + live queries).

## Checked in the sandbox (NOT the real build)
free-limits spec (+2), builder-sim (+10 checks: 5 custom a day, 10 smart total, plan / lapsed / admin), notify-sim, batch-scoring-sim, sidebar test, minilint 0 (frontend), tsc base-vs-mod (no new real errors; the S48 build error was a Prisma `groupBy` typing issue, fixed in S48b).
NOT run: jest, eslint, next build, prisma generate, Postgres, browser / phone.
