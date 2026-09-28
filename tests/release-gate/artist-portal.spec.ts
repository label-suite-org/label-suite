import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { assertDisposableReleaseGateTarget } from "../../scripts/release-gate-fixture-safety";

const origin = process.env.E2E_BASE_URL ?? "";
const enabled = process.env.ARTIST_PORTAL_BROWSER_TEST === "1";

test("artist agreement archive and credits submission", async ({ page, browser }, testInfo) => {
  test.skip(!enabled, "Requires an explicitly disposable local portal fixture");
  expect(new URL(origin).protocol).toBe("http:");
  expect(new URL(origin).hostname).toBe("127.0.0.1");
  assertDisposableReleaseGateTarget({
    databaseUrl: process.env.DATABASE_URL, ci: process.env.CI,
    fixtureDisposable: process.env.RELEASE_GATE_FIXTURE_DISPOSABLE,
    userEmail: process.env.E2E_USER_EMAIL, userPassword: process.env.E2E_USER_PASSWORD,
    analyticsFixtureDb: process.env.ANALYTICS_FIXTURE_DB,
    analyticsFixtureDisposable: process.env.ANALYTICS_FIXTURE_DISPOSABLE,
  });
  const suffix = randomUUID();
  const headers = { origin };
  const signup = await page.request.post(`${origin}/api/auth/sign-up/email`, { headers, data: { name: "Portal reviewer", email: `portal-${suffix}@example.test`, password: "PortalFixture450!" } });
  expect(signup.ok()).toBeTruthy();
  const artistId = `portal-browser-${suffix}`;
  const artist = await page.request.post(`${origin}/api/artists`, { headers, data: { id: artistId, name: "Northern Fields" } });
  expect(artist.ok()).toBeTruthy();
  const documentId = `agreement-${suffix}`;
  const documentResponse = await page.request.post(`${origin}/api/documents`, { headers, data: { id: documentId, artist_id: artistId, name: "Recording agreement · Autumn EP", doc_type: "agreement", status: "signed", file_link: "https://example.test/agreement.pdf", notes: "Internal negotiation notes — never shared" } });
  expect(documentResponse.ok()).toBeTruthy();
  await page.goto(`${origin}/artists/${artistId}/portal`);
  await page.getByRole("button", { name: "Create private link", exact: true }).click();
  const linkField = page.getByLabel("Copy and send this link");
  await expect(linkField).toBeVisible();
  const link = await linkField.inputValue();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save archive", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Archive saved.");
  const guest = await browser.newContext({ viewport: testInfo.project.use.viewport, isMobile: Boolean(testInfo.project.use.isMobile), hasTouch: Boolean(testInfo.project.use.hasTouch) });
  const artistPage = await guest.newPage();
  const errors: string[] = [];
  artistPage.on("pageerror", (error) => errors.push(error.message));
  try {
    await artistPage.goto(link);
    await expect(artistPage.getByRole("heading", { name: "Northern Fields", exact: true })).toBeVisible();
    await expect(artistPage.getByRole("button", { name: /Recording agreement/ })).toBeVisible();
    await expect(artistPage.getByText("Internal negotiation notes — never shared")).toHaveCount(0);
    await artistPage.getByLabel("Your name", { exact: true }).fill("Alex Manager");
    await artistPage.getByLabel("Your email", { exact: true }).fill("alex@example.test");
    await artistPage.getByLabel("Track title", { exact: true }).fill("After the Rain");
    await artistPage.getByLabel("Release title", { exact: false }).fill("Autumn EP");
    await artistPage.getByLabel("Full name", { exact: true }).fill("Alex North");
    await artistPage.getByRole("button", { name: "Add contributor" }).click();
    await artistPage.getByLabel("Full name", { exact: true }).nth(1).fill("Sam Fields");
    await artistPage.getByLabel("Role", { exact: true }).nth(1).selectOption("Producer");
    await artistPage.getByLabel("Writing shares", { exact: false }).fill("Not agreed yet");
    // A rejected request must preserve the entered form so retry is possible.
    await artistPage.route("**/api/artist-portal", async (route) => {
      if (route.request().method() === "POST") await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Please try again"}' });
      else await route.continue();
    });
    await artistPage.getByRole("button", { name: "Send details", exact: true }).click();
    await expect(artistPage.getByRole("alert")).toHaveText("Please try again");
    await expect(artistPage.getByLabel("Track title", { exact: true })).toHaveValue("After the Rain");
    await artistPage.unroute("**/api/artist-portal");
    await artistPage.getByRole("button", { name: "Send details", exact: true }).click();
    await expect(artistPage.getByRole("status")).toContainText("Details received");
    await expect(artistPage.getByText("After the Rain", { exact: true })).toBeVisible();
    await expect(artistPage.getByLabel("Your name", { exact: true })).toHaveValue("Alex Manager");
    expect(await artistPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await artistPage.screenshot({ path: testInfo.outputPath("artist-archive.png"), fullPage: true });
    await page.reload();
    await expect(page.getByText("After the Rain", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Mark reviewed" }).click();
    await expect(page.getByRole("status")).toHaveText("Marked as reviewed.");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Revoke access" }).click();
    await expect(page.getByRole("status")).toHaveText("Private link revoked.");
    await artistPage.reload();
    await expect(artistPage.getByRole("alert")).toContainText("link is unavailable");
    expect(errors).toEqual([]);
  } finally { await guest.close(); }
});
