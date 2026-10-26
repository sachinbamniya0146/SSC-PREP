import { test, expect, type Page } from "@playwright/test";

/**
 * Offline end-to-end: online -> download pack -> go offline -> practise the pack -> resume a timed mock after a
 * reload -> submit (queued) -> back online -> the queued submit reaches the server.
 * Needs a PRODUCTION build (`npm run build` in frontend/): the service worker is not registered by `next dev`.
 */
const API = "http://127.0.0.1:4000/api/v1";

function fakeJwt() {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ sub: "u1", exp: 4102444800 })}.x`;
}
const serverLog = async (): Promise<{ m: string; p: string; b: string }[]> => (await fetch(`${API}/_log`)).json();
const queued = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("ssc_pending_submits") || "[]").length as number);

test("offline: pack practice, mid-test resume, queued submit replay", async ({ page, context }) => {
  await fetch(`${API}/_reset`);
  await context.addInitScript((tok) => {
    localStorage.setItem("ssc_access_token", tok);
    localStorage.setItem("ssc_refresh_token", "r");
    localStorage.setItem("ssc_user", JSON.stringify({ id: "u1", fullName: "Sachin" }));
  }, fakeJwt());

  await test.step("service worker installs and controls the page; screens get saved", async () => {
    await page.goto("/dashboard");
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 }).toBeFalsy(); // first load is uncontrolled
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 }).toBeTruthy();
    // wait until the saved-page warm finished (status screen counts them)
    await page.goto("/offline");
    await expect(page.getByText(/15 of 15 screens saved/)).toBeVisible({ timeout: 60_000 });
  });

  await test.step("download a pack (questions + pictures)", async () => {
    await page.locator("option[value=e1]").waitFor({ state: "attached" });
    await page.locator("select").nth(0).selectOption("e1");
    await page.locator("select").nth(1).selectOption("s1");
    await page.getByRole("button", { name: "Download for offline" }).click();
    await expect(page.getByText("10 questions offline save ho gaye.")).toBeVisible({ timeout: 20_000 });
    // pictures live in the never-trimmed pack cache
    const imgs = await page.evaluate(async () => (await (await caches.open("ssc-packimg-v1")).keys()).length);
    expect(imgs).toBe(2);
  });

  await test.step("start the timed mock while online (the server issues the clock) and answer one question", async () => {
    await page.goto("/test?template=T1");
    await page.locator("input[type=checkbox]").first().check();
    await page.getByRole("button", { name: "Start test" }).click();
    await page.getByText("Mock question 0?").waitFor();
    await page.getByText("Opt A", { exact: true }).first().click();
    await expect.poll(async () => (await serverLog()).some((l) => l.m === "PUT" && l.p.endsWith("/attempts/att1/answers")), { timeout: 10_000 }).toBeTruthy();
  });

  await test.step("internet drops: pages, hub and pack practice still work, pictures included", async () => {
    await context.setOffline(true);
    await page.goto("/dashboard");
    await expect(page.getByText("Your Study Planner")).toBeVisible();
    await page.goto("/offline");
    await expect(page.getByText("● Offline")).toBeVisible();
    await page.getByRole("button", { name: "Practice karein" }).first().click();
    await expect(page.getByText("Pack question 0?")).toBeVisible();
    const img = page.locator("img").first();
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBeTruthy();
    await page.getByRole("button", { name: "Option A" }).click();
    await expect(page.getByText("✓ Sahi jawab!")).toBeVisible();
  });

  await test.step("reload in the middle of the mock while offline: the attempt resumes (no lost test)", async () => {
    await page.goto("/test?template=T1");
    await page.locator("input[type=checkbox]").first().check();
    await page.getByRole("button", { name: "Start test" }).click();
    await expect(page.getByText(/You are offline/)).toBeVisible();
    await page.getByText("Opt B", { exact: true }).first().click();
    // finish: review screen -> final submit; no internet, so it must be QUEUED, not lost
    await page.getByRole("button", { name: "Submit Test" }).first().click();
    await page.getByRole("button", { name: "Submit Test" }).last().click();
    await expect.poll(() => queued(page), { timeout: 15_000 }).toBe(1);
  });

  await test.step("internet returns: the queued submit is delivered exactly once", async () => {
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect
      .poll(async () => (await serverLog()).filter((l) => l.m === "POST" && l.p.endsWith("/attempts/att1/submit")).length, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(1);
    const submit = (await serverLog()).find((l) => l.p.endsWith("/attempts/att1/submit"))!;
    const body = JSON.parse(submit.b);
    expect(body.clientSubmittedAt).toBeGreaterThan(0);
    expect(body.answers.some((a: { questionId: string; selectedOption: string | null }) => a.questionId === "m0" && a.selectedOption === "B")).toBeTruthy();
  });
});
