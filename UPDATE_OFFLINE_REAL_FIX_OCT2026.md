# Offline fix (Oct 26 2026)
Frontend only, no backend/migration change.
Verified: tsc clean, next build OK, `cd frontend/e2e && npm i && npx playwright install chromium && npx playwright test` passes
(needs a production build; mock API/CDN started by the test).
Rule: strict sectional mocks must be STARTED online; after that offline works (resume + queued submit).
