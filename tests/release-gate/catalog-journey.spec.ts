import { expect, test, type Page } from "@playwright/test";
import { assertDisposableReleaseGateTarget } from "../../scripts/release-gate-fixture-safety";
import { configuredReleaseGateFixtureWorld } from "../../scripts/release-gate-fixture-world";

const fixture = configuredReleaseGateFixtureWorld();
test.beforeAll(() => {
  assertDisposableReleaseGateTarget({
    databaseUrl: process.env.DATABASE_URL, fixtureDisposable: process.env.RELEASE_GATE_FIXTURE_DISPOSABLE,
    userEmail: process.env.E2E_USER_EMAIL, userPassword: process.env.E2E_USER_PASSWORD, ci: process.env.CI,
    analyticsFixtureDb: process.env.ANALYTICS_FIXTURE_DB, analyticsFixtureDisposable: process.env.ANALYTICS_FIXTURE_DISPOSABLE,
  });
  if (!new Set(["127.0.0.1", "localhost"]).has(new URL(process.env.E2E_BASE_URL!).hostname)) throw new Error("Local browser fixture required");
});

async function login(page: Page, readOnly = false) {
  const user = readOnly ? fixture.readOnlyUser : fixture.operator;
  await page.goto("/login");
  await page.locator("form[data-login-hydrated='true']").waitFor();
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await Promise.all([page.waitForURL("**/dashboard"), page.getByRole("button", { name: "Sign in", exact: true }).click()]);
}
async function hydratedList(page: Page, path: string) {
  const component = path === "artists" ? "ArtistRoster" : "ReleaseRoster";
  await page.locator(`astro-island[component-export="${component}"]:not([ssr])`).waitFor();
}
async function openList(page: Page, path: string) {
  await page.goto(`/${path}`);
  await hydratedList(page, path);
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const dialog = page.getByRole("dialog");
  if (await dialog.count()) {
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }
}
async function choose(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("create artist and linked release, recover a failed save, and return to filtered lists", async ({ page }, info) => {
  await login(page);
  const suffix = `${info.project.name} ${Date.now()}`;
  const artistName = `Catalog journey artist with a long readable name ${suffix}`;
  const releaseTitle = `Catalog journey release with a long readable title ${suffix}`;
  await openList(page, "artists");
  await page.getByRole("button", { name: "New Artist", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const name = dialog.getByRole("textbox", { name: "Name *", exact: true });
  await expect(name).toBeFocused();
  await dialog.getByRole("button", { name: "Create Artist", exact: true }).click();
  expect(await name.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
  await name.fill(artistName);
  await page.getByText("Profile details (optional)", { exact: true }).click();
  await choose(page, "Roster relationship", "Roster");
  await fits(page);
  await page.route("**/api/artists", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary fixture failure. Try again." }) }), { times: 1 });
  await dialog.getByRole("button", { name: "Create Artist", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Temporary fixture failure");
  await expect(name).toHaveValue(artistName);
  const artistSaved = page.waitForResponse(r => r.url().endsWith("/api/artists") && r.request().method() === "POST");
  await Promise.all([page.waitForEvent("load"), dialog.getByRole("button", { name: "Create Artist", exact: true }).click()]);
  await hydratedList(page, "artists");
  expect((await artistSaved).ok()).toBe(true);
  await expect(dialog).toHaveCount(0);
  const searchArtists = page.getByRole("textbox", { name: "Search artists" });
  await searchArtists.fill(artistName);
  await choose(page, "Filter artists by relationship", "Roster artists");
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await fits(page);
  await page.getByRole("link", { name: artistName }).click();
  await expect(page.getByRole("heading", { name: artistName, exact: true })).toBeVisible();
  await page.goBack();
  await expect(searchArtists).toHaveValue(artistName);
  await expect(page.getByRole("button", { name: "Compare", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("combobox", { name: "Filter artists by relationship" })).toContainText("Roster artists");
  await page.getByRole("button", { name: "Browse", exact: true }).click();
  await fits(page);
  await page.getByRole("button", { name: `Details for ${artistName}`, exact: true }).click();
  await expect(page.getByText("Evidence: Label Suite current value · no Airtable mapping")).toBeVisible();

  await openList(page, "releases");
  await page.getByRole("button", { name: "New Release", exact: true }).click();
  await dialog.getByRole("button", { name: "Create Release", exact: true }).click();
  expect(await dialog.getByRole("textbox", { name: "Title *", exact: true }).evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
  await dialog.getByRole("textbox", { name: "Title *", exact: true }).fill(releaseTitle);
  await choose(page, "Artist", artistName);
  await fits(page);
  await page.route("**/api/releases", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary fixture failure. Try again." }) }), { times: 1 });
  await dialog.getByRole("button", { name: "Create Release", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Temporary fixture failure");
  await expect(dialog.getByRole("textbox", { name: "Title *", exact: true })).toHaveValue(releaseTitle);
  await expect(dialog.getByRole("combobox", { name: "Artist", exact: true })).toContainText(artistName);
  const releaseSaved = page.waitForResponse(r => r.url().endsWith("/api/releases") && r.request().method() === "POST");
  await Promise.all([page.waitForEvent("load"), dialog.getByRole("button", { name: "Create Release", exact: true }).click()]);
  await hydratedList(page, "releases");
  expect((await releaseSaved).ok()).toBe(true);
  await expect(dialog).toHaveCount(0);
  const searchReleases = page.getByRole("textbox", { name: "Search releases" });
  await searchReleases.fill(releaseTitle);
  await choose(page, "Sort releases", "Title");
  await fits(page);
  await page.getByRole("link", { name: releaseTitle, exact: true }).click();
  await expect(page.getByRole("heading", { name: releaseTitle, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: releaseTitle, exact: true })).toBeVisible();
  await page.goBack();
  await expect(searchReleases).toHaveValue(releaseTitle);
  await expect(page.getByRole("combobox", { name: "Sort releases" })).toContainText("Title");
  await page.getByRole("button", { name: `Details for ${releaseTitle}`, exact: true }).click();
  await expect(page.getByText(/0 of 0 tracks ready/)).toBeVisible();
  await searchReleases.fill("No matching fixture title");
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(page.getByRole("link", { name: releaseTitle, exact: true })).toBeVisible();
  await fits(page);
});

test("create dialogs cancel without a mutation and return keyboard focus", async ({ page }) => {
  await login(page);
  let posts = 0;
  page.on("request", request => { if (request.method() === "POST" && /\/api\/(artists|releases)$/.test(request.url())) posts++; });
  for (const [path, entity, field] of [["artists", "Artist", "Name *"], ["releases", "Release", "Title *"]]) {
    await openList(page, path);
    const trigger = page.getByRole("button", { name: `New ${entity}`, exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: field, exact: true }).fill("Cancelled fixture draft");
    await fits(page);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(dialog.getByRole("textbox", { name: field, exact: true })).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  expect(posts).toBe(0);
});

test("read-only lists keep browsing available without create or edit controls", async ({ page }) => {
  await login(page, true);
  for (const path of ["artists", "releases"]) {
    await openList(page, path);
    await expect(page.getByText("Read-only for your role", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^New (Artist|Release)$/ })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: `Search ${path}` })).toBeVisible();
    if (path === "artists") await page.getByRole("button", { name: "Compare", exact: true }).click();
    else await page.getByRole("button", { name: /^Details for/ }).first().click();
    await expect(page.getByRole("button", { name: /^(Edit|Delete) / })).toHaveCount(0);
    await fits(page);
  }
});
