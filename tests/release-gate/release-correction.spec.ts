import { expect, test, type Page } from "@playwright/test";
import { assertDisposableReleaseGateTarget } from "../../scripts/release-gate-fixture-safety";

test.beforeAll(() => {
  assertDisposableReleaseGateTarget({
    databaseUrl: process.env.DATABASE_URL, fixtureDisposable: process.env.RELEASE_GATE_FIXTURE_DISPOSABLE,
    userEmail: process.env.E2E_USER_EMAIL, userPassword: process.env.E2E_USER_PASSWORD, ci: process.env.CI,
    analyticsFixtureDb: process.env.ANALYTICS_FIXTURE_DB,
    analyticsFixtureDisposable: process.env.ANALYTICS_FIXTURE_DISPOSABLE,
  });
  if (!new Set(["127.0.0.1", "localhost"]).has(new URL(process.env.E2E_BASE_URL!).hostname)) throw new Error("Local browser fixture required");
});

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("form[data-login-hydrated='true']").waitFor();
  await page.getByLabel("Email").fill(process.env.E2E_USER_EMAIL!);
  await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_USER_PASSWORD!);
  await Promise.all([page.waitForURL("**/dashboard"), page.getByRole("button", { name: "Sign in", exact: true }).click()]);
  await page.goto(`/releases/${process.env.E2E_RELEASE_ID}?section=overview&returnTo=today#release-readiness`);
  await page.locator('astro-island[component-export="ReleaseWorkspace"]:not([ssr])').waitFor();
  await page.getByRole("button", { name: "Review checks", exact: true }).click();
  await page.getByRole("heading", { name: /Required release checks pass|Release needs attention/ }).waitFor();
}

test("correction saves one field, returns focus, and retains the Today link", async ({ page }) => {
  await login(page);
  const trigger = page.getByRole("button", { name: "Correct UPC/EAN", exact: true });
  await trigger.click();
  const input = page.getByLabel("UPC/EAN", { exact: true });
  await expect(input).toBeFocused();
  const value = input.inputValue().then(current => current === "193436442374" ? "193436442375" : "193436442374");
  await input.fill(await value);
  const saveRequest = page.waitForRequest(request => request.method() === "PUT" && request.url().endsWith("/readiness"));
  await page.getByRole("button", { name: "Save UPC/EAN", exact: true }).click();
  expect(Object.keys((await saveRequest).postDataJSON()).sort()).toEqual(["expected_updated_at", "field", "value"]);
  await expect(page.getByRole("status").filter({ hasText: "UPC/EAN saved." })).toBeVisible();
  await page.getByRole("button", { name: "Close correction", exact: true }).click();
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("link", { name: "Back to Today", exact: true })).toHaveAttribute("href", "/today");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("an expired session preserves the correction and cannot confirm a save", async ({ page, context }) => {
  await login(page);
  await page.getByRole("button", { name: "Correct UPC/EAN", exact: true }).click();
  const input = page.getByLabel("UPC/EAN", { exact: true });
  await input.fill("193436442376");
  await context.clearCookies();
  await page.getByRole("button", { name: "Save UPC/EAN", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Your correction is retained." })).toBeVisible();
  await expect(input).toHaveValue("193436442376");
  await expect(page.getByRole("button", { name: "Save UPC/EAN", exact: true })).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "UPC/EAN saved." })).toHaveCount(0);
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Close correction", exact: true }).click();
  await expect(input).toHaveValue("193436442376");
});

test("cancelling navigation through Today, tracks and brief evidence preserves an unsaved correction", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Correct UPC/EAN", exact: true }).click();
  const input = page.getByLabel("UPC/EAN", { exact: true });
  await input.fill("193436442377");
  const currentUrl = page.url();
  const evidence = page.getByRole("link", { name: /^Evidence:/ }).first();
  for (const control of [
    page.getByRole("link", { name: "Back to Today", exact: true }),
    page.getByRole("link", { name: "Manage tracks", exact: true }).first(),
    evidence,
    evidence.locator("xpath=ancestor::article").getByRole("button"),
  ]) {
    let asked = false;
    page.once("dialog", async dialog => { asked = true; await dialog.dismiss(); });
    await control.click();
    await expect.poll(() => asked).toBe(true);
    await expect(input).toHaveValue("193436442377");
    await expect(page).toHaveURL(currentUrl);
  }
});

test("track audio and work corrections return to updated release readiness", async ({ page, browserName }, info) => {
  await login(page);
  const created: Array<{ endpoint: string; id: string }> = [];
  const headers = { origin: new URL(process.env.E2E_BASE_URL!).origin };
  async function create(endpoint: string, data: Record<string, unknown>) {
    const response = await page.request.post(`/api/${endpoint}`, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    const record = await response.json();
    created.unshift({ endpoint, id: record.id });
    return record;
  }
  const hydrated = (component: string) => page.locator(`astro-island[component-export="${component}"]:not([ssr])`).waitFor();
  try {
    const suffix = `${info.project.name} ${Date.now()}`;
    const work = await create("works", { title: `Readiness work ${suffix}` });
    const contact = await create("contacts", { name: `Readiness writer ${suffix}` });
    await create("roles", { work_id: work.id, contact_id: contact.id, role: "Writer", ownership_type: "Rights", scope: "Publishing", percent_share: 100, clearance_status: "Pending" });
    const release = await create("releases", { title: `Readiness release ${suffix}`, format: "Single", upc_ean: Date.now().toString(), cover_art_url: "https://example.test/cover.jpg", release_date: "2027-01-15" });
    const track = await create("tracks", { title: `Readiness track ${suffix}`, release_id: release.id, work_id: work.id, auto_isrc: false });
    const unlinked = await page.request.put("/api/tracks", { headers, data: { id: track.id, work_id: null, isrc: null } });
    expect(unlinked.ok()).toBe(true);
    await page.goto(`/releases/${release.id}/tracks?track=${track.id}&focus=audio&returnTo=today`);
    await hydrated("TrackEditorWorkspace");

    // Storage transport is stubbed here; the server contract tests exercise the
    // real multipart size boundary. Track and rights saves use the fixture DB.
    let uploadBytes = 0;
    let uploads = 0;
    await page.route("**/api/storage/upload?kind=track-audio", async route => {
      uploads += 1;
      uploadBytes = route.request().postDataBuffer()!.byteLength;
      await route.fulfill({ json: { key: `fixture/releases/${release.id}/audio/master.wav`, url: null } });
    });
    await page.locator('input[type="file"]').setInputFiles({ name: "master.wav", mimeType: "audio/wav", buffer: Buffer.alloc(31_752_044) });
    expect(await page.locator('input[type="file"]').evaluate((input: HTMLInputElement) => input.files?.[0]?.size)).toBe(31_752_044);
    await page.locator("#track-work").selectOption(work.id);
    await page.locator("#track-isrc").fill(`ZZZZZ${Date.now().toString().slice(-7)}`);
    await expect(page.getByText("Select a work and save this track to edit its rights.")).toBeVisible();
    const trackSave = page.waitForResponse(response => response.url().endsWith("/api/tracks") && response.request().method() === "PUT");
    const trackReload = page.waitForEvent("load");
    await page.getByRole("button", { name: "Save track", exact: true }).click();
    const trackResponse = await trackSave;
    expect(trackResponse.ok()).toBe(true);
    await trackReload;
    await hydrated("TrackEditorWorkspace");
    expect(uploads).toBe(1);
    // WebKit omits file bytes from its intercepted request body.
    if (browserName === "chromium") expect(uploadBytes).toBeGreaterThan(31_752_044);
    await expect(page.locator("#track-audio")).toHaveValue(`fixture/releases/${release.id}/audio/master.wav`);
    await expect(page.locator("#track-work")).toHaveValue(work.id);
    await expect(page.getByRole("link", { name: "Edit work and rights", exact: true })).toHaveAttribute("href", `/works/${work.id}?release=${release.id}&track=${track.id}&returnTo=today`);

    await page.getByRole("link", { name: "Back to release", exact: true }).click();
    await hydrated("ReleaseWorkspace");
    const evidence = page.getByRole("link", { name: "Evidence: Publishing clearance", exact: true });
    if (!(await evidence.isVisible())) await page.getByRole("button", { name: "Review checks", exact: true }).click();
    await expect(evidence).toHaveAttribute("href", `/works/${work.id}?scope=publishing&focus=publishing&release=${release.id}&track=${track.id}&returnTo=today`);
    await evidence.click();
    await hydrated("WorkClearanceWorkspace");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath("rights-correction.png"), fullPage: true });
    const status = page.getByRole("combobox", { name: "Clearance status", exact: true });
    await status.selectOption("Signed");
    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("link", { name: "Back to track", exact: true }).click();
    await expect(status).toHaveValue("Signed");
    await expect(page).toHaveURL(new RegExp(`/works/${work.id}`));
    const save = page.waitForResponse(response => response.url().endsWith("/api/roles") && response.request().method() === "PUT");
    await page.getByRole("button", { name: "Save split", exact: true }).click();
    expect((await save).ok()).toBe(true);
    await expect(page.getByRole("button", { name: "Save split", exact: true })).toBeDisabled();
    await page.getByRole("link", { name: "Back to track", exact: true }).click();
    await hydrated("TrackEditorWorkspace");
    await expect(page).toHaveURL(new RegExp(`track=${track.id}.*returnTo=today`));
    await expect(page.getByText("1 tracks · 1 ready", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Back to release", exact: true }).click();
    await hydrated("ReleaseWorkspace");
    await expect(page.getByRole("heading", { name: "Required release checks pass", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to Today", exact: true })).toHaveAttribute("href", "/today");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  } finally {
    // Clear the isolated records in dependency order, including on assertion failure.
    for (const endpoint of ["tracks", "roles", "releases", "contacts", "works"]) {
      for (const record of created.filter(record => record.endpoint === endpoint)) {
        const response = await page.request.delete(`/api/${endpoint}`, { headers, data: { id: record.id } });
        expect(response.ok(), `Cleanup ${endpoint}: ${await response.text()}`).toBe(true);
      }
    }
  }
});
