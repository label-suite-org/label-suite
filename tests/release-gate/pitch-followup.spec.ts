import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
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

test("Today opens the pitch follow-up, preserves edits, and removes closed or cleared actions", async ({ page }, info) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const id = randomUUID(), contactId = randomUUID(), taskId = randomUUID();
  try {
    const { rows: [release] } = await pool.query("select org_id from label_suite.releases where id=$1", [process.env.E2E_RELEASE_ID]);
    await pool.query("insert into label_suite.contacts(id,org_id,name) values($1,$2,'Fixture pitch recipient')", [contactId, release.org_id]);
    await pool.query("insert into label_suite.ops_tasks(id,org_id,task_name,due_date,priority) values($1,$2,'Review fixture pitch reply','2000-01-01','P0')", [taskId, release.org_id]);
    await pool.query(`insert into label_suite.pitches(id,org_id,campaign_id,release_id,contact_id,task_id,title,message,credits,rights_note,reply_email,artist_name,remote_project_id,recordings,token,status,sent_date,link_state)
      values($1,$2,'e2e-campaign-release-gate',$3,$4,$5,'Fixture pitch follow-up','Fixture message','','','reply@example.test','Fixture artist','fixture-project','[]',$1,'sent','2026-01-01','revoked')`, [id, release.org_id, process.env.E2E_RELEASE_ID, contactId, taskId]);
    await page.goto("/login");
    await page.locator("form[data-login-hydrated='true']").waitFor();
    await page.getByLabel("Email").fill(process.env.E2E_USER_EMAIL!);
    await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_USER_PASSWORD!);
    await Promise.all([page.waitForURL("**/dashboard"), page.getByRole("button", { name: "Sign in", exact: true }).click()]);
    await page.goto("/today#today-tasks");
    const task = page.locator(`#today-tasks a[href^="/pitches/${id}"]`);
    await task.click();
    await expect(page).toHaveURL(new RegExp(`/pitches/${id}\\?returnTo=today#pitch-followup$`));
    await page.locator('astro-island[component-export="PitchEditor"]:not([ssr])').waitFor({ state: "attached" });
    await expect(page.getByRole("link", { name: "Manage the follow-up in Tasks" })).toHaveAttribute("href", `/ops-tasks?task=${taskId}`);
    await page.getByLabel("Response / internal notes").fill("Fixture recipient replied; review the requested version.");
    await page.getByLabel("Status", { exact: true }).selectOption("replied");
    let warned = false;
    page.once("dialog", async dialog => { warned = true; await dialog.dismiss(); });
    await page.getByRole("link", { name: "Back to Today" }).click();
    await expect.poll(() => warned).toBe(true);
    await expect(page.getByLabel("Response / internal notes")).toHaveValue("Fixture recipient replied; review the requested version.");
    await page.getByRole("button", { name: "Save follow-up", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Follow-up saved");
    await page.reload();
    await page.locator('astro-island[component-export="PitchEditor"]:not([ssr])').waitFor({ state: "attached" });
    await expect(page.getByLabel("Status", { exact: true })).toHaveValue("replied");
    await expect(page.getByLabel("Response / internal notes")).toHaveValue("Fixture recipient replied; review the requested version.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath("pitch-followup.png"), fullPage: true });
    await page.getByLabel("Status", { exact: true }).selectOption("closed");
    await page.getByRole("button", { name: "Save follow-up", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Pitch closed");
    await page.getByRole("link", { name: "Back to Today" }).click();
    await expect(task).toHaveCount(0);
    await page.goto(`/pitches/${id}?returnTo=today#pitch-followup`);
    await page.locator('astro-island[component-export="PitchEditor"]:not([ssr])').waitFor({ state: "attached" });
    await page.getByLabel("Status", { exact: true }).selectOption("replied");
    await page.getByRole("button", { name: "Save follow-up", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Follow-up saved");
    await page.getByRole("link", { name: "Back to Today" }).click();
    await task.click();
    await page.locator('astro-island[component-export="PitchEditor"]:not([ssr])').waitFor({ state: "attached" });
    await page.getByLabel("Next action", { exact: true }).fill("");
    await page.getByLabel("Follow-up date", { exact: true }).fill("");
    await page.getByRole("button", { name: "Save follow-up", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("No next action is scheduled");
    await page.reload();
    await expect(page.getByLabel("Next action", { exact: true })).toHaveValue("");
    await page.getByRole("link", { name: "Back to Today" }).click();
    await expect(task).toHaveCount(0);
  } finally {
    await pool.query("delete from label_suite.pitches where id=$1", [id]);
    await pool.query("delete from label_suite.ops_tasks where id=$1", [taskId]);
    await pool.query("delete from label_suite.contacts where id=$1", [contactId]);
    await pool.end();
  }
});
