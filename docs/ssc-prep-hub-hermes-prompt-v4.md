# SSC Prep Hub — Master Build Prompt for Hermes AI Agent (v4 — Frontend & PYQ Search Overhaul)

> Supersedes nothing — this **adds Sections 29–35** on top of v1–v3. This file is scoped to what's urgent right now: the live site looks broken/unstyled, the test-taking and results UI need to match real SSC-platform quality (not generic), and Hermes needs to actively find and ingest PYQs, not just wait for uploads. Ship this incrementally — page by page, live — not as one final batch.

---

## 29. P0 — Fix the Rendering Bug Before Any Styling Work

**Diagnosis from the live screenshot:** headings render in default serif font, links are default browser blue-underlined, there are no cards, no spacing rhythm, no color system applied anywhere. This is the signature of **Tailwind/global CSS not being loaded or not being applied** in the deployed build — not a "the design needs more work" problem.

Before touching any component styling, Hermes must:
1. Verify the Tailwind config's `content`/`purge` globs actually match the project's file locations (a common cause: globs pointing at the wrong directory after a restructure, so every utility class gets purged out of the production CSS bundle).
2. Verify the global stylesheet (`globals.css` with `@tailwind base; @tailwind components; @tailwind utilities;`) is actually imported in the root layout, and that the root layout isn't being bypassed by a stray raw HTML page.
3. Check the deployed build output (not just local dev) — CSS-purge and build-vs-dev discrepancies are the most common reason a site looks fine on `localhost` but ships broken.
4. Confirm shadcn/ui components are actually being used (`<Card>`, `<Button>`, etc.) rather than raw unstyled `<div>`/`<h1>`/`<a>` tags — if the current landing page is raw semantic HTML with no component/utility classes at all, that's the second half of the bug.
5. Once fixed, redeploy and visually confirm against a checklist: fonts render as the design system's typeface (not browser default serif), links are not default blue/underlined, buttons are not raw `<button>` browser chrome, spacing is consistent.

**This step is blocking.** Nothing in Sections 30–34 will look right if this isn't fixed first, so do this first and confirm it visually before moving to component work.

---

## 30. Design System (Replacing "Plain Text" With an Actual Visual Language)

- **Typography:** a proper type scale — Display (landing hero), H1–H4, Body, Caption, Label — using a modern sans (e.g., Inter, Manrope, or similar geometric/humanist sans, not the browser default serif currently showing). Devanagari-compatible font pairing for Hindi content (e.g., Noto Sans Devanagari) so Hindi text doesn't fall back to an ugly system font.
- **Color system:** primary brand color + accent + semantic colors (success/warning/danger/info) as CSS variables, each with a light-mode and dark-mode value, driving every button, badge, and status indicator — not ad hoc hex codes per component.
- **Spacing/layout:** 8px base grid, consistent card padding, consistent section vertical rhythm on the landing page (the current "Hindi + English" / "Live Leaderboard" / "Pricing" sections should be visually distinct cards/sections with icons and illustration accents, not stacked plain headings).
- **Components:** shadcn/ui as the base (Button, Card, Badge, Tabs, Dialog, Progress) styled to the brand tokens above — reuse the same component set across web and admin per v1 §4's `packages/ui`.
- **Landing page redesign (specific to the current content):**
  - Hero with a real headline + subheadline + CTA button (not a bare heading).
  - "Hindi + English" feature block as an icon + short copy card, not a plain paragraph.
  - "Live All-India Leaderboard" as a feature card with a small illustrative rank-list preview graphic.
  - Pricing section (v1 §"Subscriptions" / v3 §26.3 note on configurable pricing) redesigned as **two side-by-side pricing cards** with a "BEST VALUE" ribbon/badge on the recommended plan, checkmark-icon feature lists (not bullet dashes), and a prominent CTA button per card — this directly fixes what's currently just plain bullet-pointed text with a bare "Get Started" link.
- **Motion:** Framer Motion for section entrance transitions, button hover/press states, and page transitions — subtle, fast (150–250ms), never blocking interaction.
- **Dark/Light/System theme:** verify theme toggle actually swaps the CSS variable set, tested on every new component built in this pass, not just the shell.

---

## 31. Real Exam Test-Taking UI (Matched to Reference Screenshots)

Replicate the following structure at a **premium, more polished visual level** than the reference screenshots (which are functional but visually dated) — same information architecture, better typography/spacing/motion:

**Top bar:**
- Zoom (+ / −) controls, "Show Fullscreen" toggle, exam title + subtitle (e.g., "SSC CGL Tier I 2026 — Full Mock Test"), Pause button (admin-configurable whether pause is allowed per test type — full mocks typically shouldn't allow pausing, practice tests can).
- Server-authoritative time-left counter (per v1 §8), color-shifting (neutral → amber → red as time runs low), never trusting client clock.
- Masked roll number / candidate name display.

**Section tabs + navigation:**
- PART-A/B/C/D-style subject tabs, color-coded by completion state (not started / in progress / complete), consistent with the question-palette color legend below.
- Action row: **Mark for Review**, **Save & Next**, **Submit Section**, **Submit Test** — exact behavior per v1 §8 (autosave on every change, not just on these clicks).

**Question palette (right sidebar):**
- Numbered grid, color-coded legend: Not Visited / Answered / Not Answered / Marked for Review / Answered + Marked for Review — matching the reference screenshot's symbol table exactly (including the important rule that "answered + marked for review" still counts as answered for evaluation, which must be explained to the user, not just implied by color).
- Live per-section mini-analysis panel (Answered / Not Answered counts) updating in real time as the user progresses, like the "PART-A Analysis" panel in the reference.
- A one-time **symbols/legend explainer** shown before the test starts (bilingual, matching the reference's "SYMBOLS" page), not buried in a help menu.

**Bilingual instructions page (pre-test):**
- Side-by-side Hindi/English instructions in a structured table: duration, total questions, negative marking %, and a section-wise breakdown table (Section / Subject / Question Count / Max Marks) — generated dynamically from the `TestTemplate` config, never hardcoded per exam.
- Explicit, exam-accurate language rules surfaced to the user before they start (mirroring the reference's actual SSC rule: the comprehension section's language is locked at selection, other sections can be bilingual or single-language depending on what the user picked) — implement this exact rule set, since it's the real SSC exam behavior, not a simplified version of it.
- "Select Test Language" dropdown (English / Hindi) with the agree-to-instructions checkbox gating the Start button.

**Review-before-submit modal:**
- A table exactly like the reference's "Review test before submit": Section name / Questions count / Answered / Not Answered / Marked for Review / Visited / Not Visited, with **Submit Test** and **Cancel** actions — this is what makes the exam feel exam-accurate rather than a generic quiz submit button.

**Proctoring polish (flagged as a later-phase enhancement, not P0):** the reference shows a "Show Camera" / face-alignment flow. Note this as an optional Phase-9+ feature (webcam capture at test end for integrity, admin-configurable per test type) — don't block the current UI pass on building this; ship the rest first.

---

## 32. Results & Analysis Page

Match the reference's analysis page structure, restyled to the new design system:

- **Top summary ring cluster:** Rank (X / total attempts), Score (X / max), Attempted (X / total), Accuracy %, Percentile — as circular progress rings with the design system's color tokens (not the reference's plain gray/orange rings).
- **Cut-off badge:** shown prominently next to the summary (per subject where applicable), computed from real data (admin-set or historically derived), never a placeholder number.
- **Section-wise performance cards:** Score / Attempted / Accuracy / Cut-off per subject, in a clean card grid.
- **"Compare with Topper" bar comparison:** You vs. Topper, per section and overall — Score, Accuracy, Correct, Wrong, Time — exactly the comparison structure in the reference, restyled with the brand's bar-chart treatment (consider Recharts per v1's frontend stack rather than manual divs).
- **Top 10 toppers leaderboard** on the result page (avatars, rank badges, score) — ties into v1's Realtime Leaderboard feature, computed per-test rather than only globally.
- **Difficulty breakdown ("Expert's Comment" equivalent):** Overall/Subject-wise difficulty labels (Easy/Moderate/Hard) — **per the v2 §7.6 guardrail, this must be computed from real aggregate data** (average accuracy and time-per-question across all attempts on that test), not an LLM inventing a plausible-sounding comment. Show it as a clean data-driven summary, not prose pretending to be a human expert's note.
- **Strengths & Weaknesses tabs:** Strong Topics / Weak Topics / Average Topics, feeding directly from v1 §9's analytics engine.
- **Attempt history + "View Solution":** dropdown to switch between multiple attempts of the same test, each linking into the full answer-review flow (v1 §"Answer Review").

---

## 33. Exam & PYQ Discovery UI

Match the reference's browse/search UX (ixamBee/MockTestZone pattern), scoped to this platform's SSC-family exams and restyled:

- **Prominent global search bar** ("Search for Exams, PYQs, Mock Tests, and Topics") on its own dedicated discovery page, not just a header icon — typo-tolerant via Meilisearch (v1 §"Search").
- **Left category sidebar:** SSC exam families (CGL, CHSL, CPO, MTS, GD, JE, Stenographer, Selection Post, Delhi Police, CISF, CRPF, BSF, CAPF) as filterable categories, matching the reference's sidebar pattern.
- **Exam/test card grid:** exam name, language badges (Hindi/English), total test count, question count, average duration, and a clear CTA state — **Start Now** (free/unlocked), **Unlock Now** (premium-gated per v3 §16's `EntitlementGuard`), or **View Mock Tests** (browse into the series) — styled as real cards with hover elevation, not the reference's plain bordered boxes.
- **Previous Year Paper library page:** a grid of exam-authority cards (SSC CGL, SSC CHSL, SSC CPO, SSC Selection Post, Delhi Police, etc.) each opening into that exam's full PYQ archive by year/shift — mirroring the reference's PYQ library page structure, filterable by exam category tabs (All / CGL / CHSL / CPO / MTS / GD / JE / Stenographer / Selection Post / Police & Paramilitary).
- **Free-tier visibility, premium-gated attempt:** tests can be *browsed* (title, question count, duration visible) by anyone, but *starting* a non-free one requires the entitlement check — matching the reference's "Log in to start — free" pattern where relevant, and the paid unlock flow where relevant.

---

## 34. Hermes-Driven PYQ Search & Ingestion

This directly answers "Hermes should search PYQ and add" — the platform should not rely solely on admin uploads for PYQ coverage:

- **Admin-triggerable "Auto-Fetch PYQ" job:** admin selects an exam (e.g., "SSC CGL 2025 Tier I") and Hermes runs a web search for that exam's official previous-year question papers and answer keys, prioritizing **official sources first** (ssc.nic.in released papers/answer keys, official gazette notifications) over third-party redistributions.
- **Candidate review before ingestion:** found PDFs are presented to the admin as a candidate list (source, year, shift, confidence that it's the genuine official paper) — **nothing is auto-published**; approved candidates are handed to the existing PDF ingestion pipeline (v2 §7) with the same chunked processing, duplicate-safe import (v3 §22), and human-review gate as manually uploaded PDFs. This is the same trust model extended to a new intake source, not a bypass of it.
- **Legitimacy & copyright care:** Hermes fetches the actual exam questions/papers (which are released as public exam material by the commission), never a competitor platform's copyrighted explanations, proprietary difficulty tags, UI, or branded content — if a search result is clearly a competitor's rewritten/annotated version rather than the source paper, skip it and keep looking for the original.
- **In-app search-to-request loop:** the discovery search bar (§33) doubles as a demand signal — if a user searches a specific paper ("SSC CHSL 2024 Tier I Shift 3") that isn't in the bank yet, log it (`SearchMiss` record: query, exam, count) so the next Auto-Fetch run is prioritized by real demand rather than guesswork.
- **Coverage dashboard:** admin view showing, per SSC exam, how many years/shifts are covered vs. missing, so gaps in PYQ coverage are visible at a glance rather than discovered by a student hitting a dead end.

---

## 35. Execution Order for This Pass

Given this needs to ship live, incrementally, today — not as one big final release:

1. **Fix the CSS/build bug (§29)** — confirm visually before anything else.
2. **Apply the design system to the landing page (§30)** — the page currently visible, since that's what's being checked live right now.
3. **Pricing section redesign (§30)** — quick, high-visual-impact, self-contained.
4. **Test-taking UI (§31)** — palette, timer, instructions, review-before-submit — the core "does this feel like a real exam" moment.
5. **Results/analysis page (§32)**.
6. **Discovery/search + PYQ library UI (§33)**, wired to whatever question bank already exists.
7. **Hermes PYQ auto-fetch (§34)** — runs in the background/admin-triggered, doesn't block the visible UI work above.

Ship and deploy after each numbered step so there's a live, visibly-improving site to check throughout, rather than one large batch at the end.
