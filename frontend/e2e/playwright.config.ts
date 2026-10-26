import { defineConfig } from "@playwright/test";

/**
 * Offline end-to-end test. Run from frontend/e2e:
 *   (cd .. && npm ci && npm run build)      # production build: the service worker only exists there
 *   npm install && npx playwright install chromium
 *   npx playwright test
 * It starts a fake API (:4000), a fake image CDN (:4001) and `next start` (:3100) by itself.
 */
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3100", viewport: { width: 1100, height: 800 }, trace: "retain-on-failure" },
  webServer: [
    { command: "node mock-api.mjs 4000", url: "http://127.0.0.1:4000/api/v1/_log", reuseExistingServer: true },
    { command: "node mock-api.mjs 4001", url: "http://127.0.0.1:4001/img/ping.png", reuseExistingServer: true },
    { command: "npx next start -p 3100", cwd: "..", url: "http://localhost:3100/offline.html", reuseExistingServer: true, timeout: 60_000 },
  ],
});
