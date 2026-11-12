import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { assertDisposableReleaseGateTarget } from "../../scripts/release-gate-fixture-safety";

test.beforeAll(() => {
  assertDisposableReleaseGateTarget({ databaseUrl: process.env.DATABASE_URL, fixtureDisposable: process.env.RELEASE_GATE_FIXTURE_DISPOSABLE,
    userEmail: process.env.E2E_USER_EMAIL, userPassword: process.env.E2E_USER_PASSWORD, ci: process.env.CI,
    analyticsFixtureDb: process.env.ANALYTICS_FIXTURE_DB, analyticsFixtureDisposable: process.env.ANALYTICS_FIXTURE_DISPOSABLE });
  if (!new Set(["127.0.0.1", "localhost"]).has(new URL(process.env.E2E_BASE_URL!).hostname)) throw new Error("Local browser fixture required");
});

test("reschedules a release task from Today and reviews relative dates without moving fixed or completed work", async ({ page }, info) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const releaseId = randomUUID(), taskId = randomUUID(), relativeId = randomUUID(), doneId = randomUUID();
  const route = `/releases/${releaseId}?section=timeline&task=${taskId}&returnTo=today#release-timeline`;
  try {
    const { rows: [fixture] } = await pool.query("select org_id,artist_id from label_suite.releases where id=$1", [process.env.E2E_RELEASE_ID]);
    await pool.query("insert into label_suite.releases(id,org_id,artist_id,title,release_date,status) values($1,$2,$3,'Fixture scheduling release','2026-12-04','In Production')", [releaseId, fixture.org_id, fixture.artist_id]);
    await pool.query(`insert into label_suite.ops_tasks(id,org_id,linked_release_id,task_name,due_date,priority,status,release_offset_days) values
      ($1,$4,$5,'Fixture fixed delivery','2000-01-01','P0','todo',null),
      ($2,$4,$5,'Fixture relative delivery','2026-11-06','P2','todo',-28),
      ($3,$4,$5,'Fixture completed approval','2000-01-03','P2','done',-35)`, [taskId, relativeId, doneId, fixture.org_id, releaseId]);
    await page.goto("/login");
    await page.locator("form[data-login-hydrated='true']").waitFor();
    await page.getByLabel("Email").fill(process.env.E2E_USER_EMAIL!);
    await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_USER_PASSWORD!);
    await Promise.all([page.waitForURL("**/dashboard"), page.getByRole("button", { name: "Sign in", exact: true }).click()]);
    await page.goto("/today#today-tasks");
    const todayTask = page.locator(`#today-tasks a[href="${route}"]`);
    await todayTask.click();
    const editor = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Edit task', exact: true }) });
    await expect(editor.getByLabel("Title", { exact: true })).toHaveValue("Fixture fixed delivery");
    await editor.getByLabel("Deadline", { exact: true }).fill("2000-01-02");
    page.once("dialog", dialog => dialog.dismiss());
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(editor.getByLabel("Deadline", { exact: true })).toHaveValue("2000-01-02");
    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("link", { name: "Overview", exact: true }).click();
    await expect(editor.getByLabel("Deadline", { exact: true })).toHaveValue("2000-01-02");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveText("Saved");
    await page.reload();
    await expect(editor.getByLabel("Deadline", { exact: true })).toHaveValue("2000-01-02");
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("link", { name: /Back to Today/ }).click();
    await expect(todayTask).toBeVisible();
    await todayTask.click();
    await expect(editor.getByLabel("Deadline", { exact: true })).toHaveValue("2000-01-02");
    await editor.getByRole("combobox", { name: /^Status/ }).selectOption("done");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await page.getByRole("link", { name: /Back to Today/ }).click();
    await expect(todayTask).toHaveCount(0);
    await page.goto(`/releases/${releaseId}?section=details#release-readiness`);
    await page.getByRole("button", { name: "Correct date", exact: true }).click();
    await page.getByLabel("Release date", { exact: true }).fill("2026-12-11");
    await page.getByRole("button", { name: "Save Release date", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Release date saved");
    await page.getByRole("button", { name: "Close correction", exact: true }).click();
    const timelineLink = page.getByRole("link", { name: "Timeline", exact: true });
    if (await timelineLink.isVisible()) await timelineLink.click();
    else {
      await page.getByRole("button", { name: "More release sections" }).click();
      await page.getByRole("menuitem", { name: "Timeline", exact: true }).click();
    }
    await page.getByRole("button", { name: "Review deadline changes", exact: true }).click();
    await expect(page.getByText("Fixture relative delivery: 2026-11-06 → 2026-11-13")).toBeVisible();
    await page.getByRole("button", { name: "Apply deadline changes", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("1 deadlines moved");
    const { rows } = await pool.query("select id,due_date::text,status from label_suite.ops_tasks where linked_release_id=$1 order by id", [releaseId]);
    expect(rows.find(row => row.id === taskId)).toMatchObject({ due_date: "2000-01-02", status: "done" });
    expect(rows.find(row => row.id === relativeId)).toMatchObject({ due_date: "2026-11-13", status: "todo" });
    expect(rows.find(row => row.id === doneId)).toMatchObject({ due_date: "2000-01-03", status: "done" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath("release-scheduling.png"), fullPage: true });
  } finally {
    await pool.query("delete from label_suite.ops_tasks where linked_release_id=$1", [releaseId]);
    await pool.query("delete from label_suite.releases where id=$1", [releaseId]);
    await pool.end();
  }
});
