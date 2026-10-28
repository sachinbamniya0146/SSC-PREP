# One header for every student page (session 20, 28 Oct 2026) - finishes roadmap area 1

Independent of session 19 (touches different files), so either order works. Best together: with the left menu the top bar has nothing duplicated; without it the shared header still carries the nav links (desktop) / hamburger (phone).

Seven student pages drew their own small "<- SSCPrepHub" bar. They now use the shared `ShellHeader` (theme switch +
account menu, and with the left menu from session 19 nothing is duplicated). Page-specific controls moved into the page:

| Page | What moved |
|---|---|
| `bookmarks` | "Browse Bank" button sits next to "Practice" in the page heading row |
| `help` | shared header when signed in; a signed-out visitor keeps the plain bar (no account menu for someone not logged in) |
| `leaderboard` | All-time / This Week toggle moved into the page heading row, beside All India / My state (both got `aria-pressed`) |
| `review` | "Spaced Repetition" label became a small eyebrow above the title |
| `study-plan` | removed the header "Create Plan" / "Dashboard" buttons (the page body already has "Create Your Plan"; the sidebar has Dashboard) |
| `weak-topics` | title + "Planner" link moved to the top of the page |
| `question-bank-practice` | both headers (loading + main) replaced; "Dashboard" button dropped (sidebar) |

Left as they are on purpose: detail pages with a contextual back link (`study-plan/board` "<- Study Plan",
`vocabulary/[slug]` and `vocabulary/revision` "<- Vocabulary", `premium/history` "<- Premium", `settings/telegram`).

Verified: tsc error-list diff vs session 19 tree (only removed "JSX types missing" noise lines, no new error, no new
unused symbol), `minilint` 0. NOT run: eslint, `next build`, a browser. Frontend only, no backend / migration.
