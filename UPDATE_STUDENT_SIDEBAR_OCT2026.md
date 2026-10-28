# Student left-side menu (session 19, 28 Oct 2026)

Sachin's wish (roadmap area 1): a left menu for students on desktop / tablet like the admin sidebar, phones keep the
bottom tab bar, no layout jump, nothing loud.

## What changed (frontend only, no backend, no migration)

| File | Change |
|---|---|
| `frontend/src/lib/student-nav.ts` (new) | ONE list of menu items (3 groups: Learn / Improve / Account, 13 items, English + Hinglish), ONE list of routes that get the menu, active-item rule, and the tiny boot script text. No hooks, so the server layout may import it. |
| `frontend/src/components/StudentSidebar.tsx` (new) | The menu itself. Collapsible (full 240 px / icon rail 68 px), choice remembered in `localStorage.ssc_sidebar`, default = rail below 1024 px, full above. Items follow the feature controller flags (`vocabulary`, `leaderboard`, `referral`) and the UI language. Focus ring, `aria-current`, `aria-label`s (labels are hidden in the rail, the accessible name stays). |
| `frontend/src/app/layout.tsx` | Mounts `<StudentSidebar />`; adds the boot script in `<head>` that puts `has-sidebar` / `sidebar-rail` on `<html>` before first paint (pages use normal links = full page loads, so without this the content would jump 240 px on every page). |
| `frontend/src/app/globals.css` | Sidebar rules; `body.has-tabbar` padding now only below 768 px. Under 768 px nothing changes. |
| `frontend/src/components/AppHeader.tsx` | `data-shell` hooks: when the sidebar is on, the top bar drops its logo / links / hamburger and keeps theme switch + account menu (right group got `ml-auto` so it stays on the right). Without the sidebar the header is exactly as before. |
| `frontend/src/components/MobileTabBar.tsx`, `SupportChatWidget.tsx`, `AppStatus.tsx` | Breakpoint `lg` -> `md` so the bottom bar and the floating widgets agree with the sidebar (tablets now get the sidebar, not the bar). |
| `scripts/audit/sidebar-boot-test.cjs` (new) + README row | Repeatable check of the route / width logic. |

Routes that get the menu: dashboard, mocks, sectional, year-wise, question-bank, question-bank-practice, vocabulary,
review, weak-topics, study-plan, bookmarks, leaderboard, referral, help, profile, premium, settings (only when signed in).
Never on: test, cgl-test, quiz, weak-practice, results, verification, admin, login, signup, landing, pricing, legal pages.

## Verified (sandbox) / NOT verified

Run: strict TypeScript check of the two new files with shims (0 errors in them; the repo-wide tsc diff only shows the
usual "react / next not installed" noise, no new unused symbols), `minilint` (0), `sidebar-boot-test.cjs` (24 cases +
menu/route consistency, ALL OK), real SSR of `StudentSidebar` + `AppHeader` rendered with the repo's own `globals.css`
compiled by Tailwind 4 (the repo uses 3.4.10, same utilities) and screenshot at 1280 / 820 / 768 / 360 px, light + dark,
rail + full: no horizontal scroll, sidebar 240 / 68 px, header right group stays right, under 768 px sidebar is
`display:none` even if the class is set.
NOT run: real eslint, `next build`, a real browser on the real pages, the phone bottom bar (it only appears after
hydration, so it is not in the static mock-up), keyboard walk-through on the real app. First real compile = GitHub Actions.

## Known limits / follow-ups
- Seven student pages still draw their own small "<- SSCPrepHub" header (`bookmarks`, `help`, `leaderboard`, `review`,
  `study-plan`, `weak-topics`, `question-bank-practice`). They work with the sidebar, but the roadmap rule is "no page
  builds its own header": move them to `AppShell` / `ShellHeader` one by one (leaderboard / study-plan carry page controls).
- "Premium is too big" is NOT touched: needs a screenshot to know which element (header badge, dashboard card at
  `dashboard/page.tsx` ~L412, or `/premium`). The sidebar deliberately has no Premium item.
- Admin / staff link stays in the account menu (top bar), not in the sidebar.
- `Practice` points to `/question-bank-practice` (the topic picker). The practice session itself is not in the list.
