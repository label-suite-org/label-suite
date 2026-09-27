import { expect, test, type Page } from "@playwright/test";
import { assertDisposableReleaseGateTarget } from "../../scripts/release-gate-fixture-safety";

test.beforeAll(() => {
  assertDisposableReleaseGateTarget({
    databaseUrl: process.env.DATABASE_URL, fixtureDisposable: process.env.RELEASE_GATE_FIXTURE_DISPOSABLE,
    userEmail: process.env.E2E_USER_EMAIL, userPassword: process.env.E2E_USER_PASSWORD, ci: process.env.CI,
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
