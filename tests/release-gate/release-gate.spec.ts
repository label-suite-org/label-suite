import { expect, test, type TestInfo, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { deriveCampaignDocument } from "../../src/lib/campaign-rich-text";
import {
  canonicalLeadEvidence,
  requireCompleteActivitySourceStates,
} from "../campaign-enrichment-release-evidence";
import { releaseGateFixtureWorld } from "../../scripts/release-gate-fixture-world";

test.describe.configure({ mode: "serial" });

const requiredFlows = [
  "sidebar-collapse-reopen",
  "mobile-primary-and-more-navigation",
  "analytics-artist-release-filter",
  "analytics-workspace-hierarchy",
  "artist-readiness-to-exact-field",
  "release-blocker-to-exact-field",
  "command-k-record-open",
  "campaign-preview-with-zero-unconfirmed-sends",
  "event-open-edit-and-project-context",
] as const;

function viewportWidth(page: Page): number {
  return page.viewportSize()?.width ?? 0;
}

function captureRenderLifecycleWarnings(page: Page): string[] {
  const warnings: string[] = [];
  const record = (text: string) => {
    if (
      text.includes("React error #418")
      || text.toLowerCase().includes("hydration")
      || text.includes("of chart should be greater than 0")
    ) {
      warnings.push(text);
    }
  };

  page.on("console", (message) => {
    if (message.type() !== "warning" && message.type() !== "error") return;
    record(message.text());
  });
  page.on("pageerror", (error) => record(error.message));

  return warnings;
}

type RequiredReleaseFixtureName = "E2E_ARTIST_ID" | "E2E_RELEASE_ID" | "E2E_TRACK_ID" | "E2E_EVENT_ID";

const RADIO_CAMPAIGN_ID = releaseGateFixtureWorld.relationships.campaign.id;
const RADIO_REVIEW_SLUG = releaseGateFixtureWorld.radio.reviewSlug;
const RADIO_PUBLIC_SLUG = releaseGateFixtureWorld.radio.publicSlug;
const ARTWORK_FIXTURE_URL = releaseGateFixtureWorld.radio.artworkUrl;
const RADIO_SUBJECT = releaseGateFixtureWorld.radio.subject;
const RADIO_BODY = releaseGateFixtureWorld.radio.body;
const ACTIVITY_CAMPAIGN_ID = RADIO_CAMPAIGN_ID;
const ACTIVITY_OPERATOR_LEAD_BY_PROJECT = {
  "desktop-gate": releaseGateFixtureWorld.ids.activityLeads.desktop,
  "mobile-390-gate": releaseGateFixtureWorld.ids.activityLeads.mobile390,
  "mobile-320-gate": releaseGateFixtureWorld.ids.activityLeads.mobile320,
} as const;
const ACTIVITY_READ_ONLY_EMAIL_SUFFIX = "+readonly";
const FOREIGN_TENANT_LEAD_ID = releaseGateFixtureWorld.foreignTenant.lead;

type AxeNodeEvidence = {
  impact?: string | null;
  target: unknown;
};

type AxeRuleEvidence = {
  id: string;
  impact?: string | null;
  tags: string[];
  description: string;
  help: string;
  helpUrl: string;
  nodes: AxeNodeEvidence[];
};

function requiredFixture(name: RequiredReleaseFixtureName, reason: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(reason);
  }

  return value ?? "";
}

async function login(page: Page) {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;

  if (!email?.trim() || !password?.trim()) {
    throw new Error("Release-gate auth preconditions missing: set E2E_USER_EMAIL and E2E_USER_PASSWORD.");
  }

  await page.goto("/login");
  await page.getByRole("heading", { name: "Suite", exact: true }).waitFor();
  await page.locator("form[data-login-hydrated='true']").waitFor();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await Promise.all([
    page.waitForURL("**/dashboard", { waitUntil: "domcontentloaded" }),
    page.getByRole("button", { name: "Sign in", exact: true }).click(),
  ]);
  await expect(page.getByRole("main")).toBeVisible({ timeout: 30_000 });
}

function releaseGateReadOnlyEmail() {
  const email = process.env.E2E_USER_EMAIL?.trim() ?? "";
  const at = email.indexOf("@");
  return at > 0 ? `${email.slice(0, at)}${ACTIVITY_READ_ONLY_EMAIL_SUFFIX}${email.slice(at)}` : `${email}${ACTIVITY_READ_ONLY_EMAIL_SUFFIX}@example.test`;
}

async function loginReadOnly(page: Page) {
  const password = process.env.E2E_USER_PASSWORD;
  const email = releaseGateReadOnlyEmail();

  if (!email.trim() || !password?.trim()) {
    throw new Error("Release-gate read-only auth preconditions missing: base E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");
  }

  await page.goto("/login");
  await page.getByRole("heading", { name: "Suite", exact: true }).waitFor();
  await page.locator("form[data-login-hydrated='true']").waitFor();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await Promise.all([
    page.waitForURL("**/dashboard", { waitUntil: "domcontentloaded" }),
    page.getByRole("button", { name: "Sign in", exact: true }).click(),
  ]);
  await expect(page.getByRole("main")).toBeVisible({ timeout: 30_000 });
}

function forbiddenActivityRequest(url: URL, method: string) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method) && (
    /\/api\/email\/send$/.test(url.pathname)
    || /\/api\/ops-tasks(?:\/|$)/.test(url.pathname)
    || /\/api\/campaign-leads\/[^/]+\/(?:stage-override|record-sent)$/.test(url.pathname)
    || /\/api\/campaign-(?:communicator|enrichment|editor-ai)/.test(url.pathname)
    || /(?:brevo|sendgrid|mailgun|postmark)/i.test(url.hostname)
  );
}

function forbiddenCampaignEnrichmentRequest(entry: { method: string; host: string; path: string }) {
  if (/(?:openrouter\.ai|api\.openai\.com|api\.brevo\.com|sendgrid|mailgun|postmark)/i.test(entry.host)) {
    return true;
  }
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(entry.method)) return false;
  return /\/api\/email\/send$/.test(entry.path)
    || /\/api\/ops-tasks(?:\/|$)/.test(entry.path)
    || /\/api\/campaign-leads(?:\/|$)/.test(entry.path)
    || /\/api\/campaign-enrichment-suggestions(?:\/|$)/.test(entry.path)
    || /\/api\/campaign-outreach-drafts(?:\/|$)/.test(entry.path)
    || /\/api\/campaigns\/[^/]+\/(?:editor-ai-runs|radio-update-drafts)/.test(entry.path)
    || /\/api\/campaigns\/[^/]+\/public-page(?:\/publish)?$/.test(entry.path)
    || /\/(?:approve|publish|record-sent|stage-override)$/.test(entry.path);
}

type BrowserJsonResult = { status: number; body: unknown };

async function browserJson(
  page: Page,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<BrowserJsonResult> {
  return page.evaluate(async ({ requestPath, requestInit }) => {
    const response = await fetch(requestPath, requestInit);
    return {
      status: response.status,
      body: await response.json().catch(() => null) as unknown,
    };
  }, { requestPath: path, requestInit: init });
}

async function localToolJson(
  page: Page,
  token: string,
  path: string,
  init: { method?: string; body?: string } = {},
): Promise<BrowserJsonResult> {
  return browserJson(page, path, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} was not an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} was not an array`);
  return value;
}

function requiredBoundedString(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
    throw new Error(`${label} was not a non-empty string up to ${maximumLength} characters`);
  }
  return value;
}

function localToolData(result: BrowserJsonResult, label: string): Record<string, unknown> {
  expect(result.status, `${label} response status`).toBe(200);
  return record(record(result.body, `${label} envelope`).data, `${label} data`);
}

async function campaignProposalOnlySnapshot(page: Page, token: string, leadId: string) {
  const [itemResult, communicatorResult, publicPageResult, activityResult] = await Promise.all([
    localToolJson(page, token, `/api/local-tools/v1/campaign-enrichment/items/${encodeURIComponent(leadId)}`),
    browserJson(page, `/api/campaigns/${RADIO_CAMPAIGN_ID}/communicator-prompt`),
    browserJson(page, `/api/campaigns/${RADIO_CAMPAIGN_ID}/public-page`),
    browserJson(page, `/api/campaigns/${RADIO_CAMPAIGN_ID}/activity`),
  ]);
  const item = localToolData(itemResult, "campaign enrichment item");
  expect(communicatorResult.status).toBe(200);
  expect(publicPageResult.status).toBe(200);
  expect(activityResult.status).toBe(200);
  const communicator = record(communicatorResult.body, "communicator context");
  const leadContext = record(record(communicator.leads, "communicator leads")[leadId], "lead context");
  const activityItems = array(record(activityResult.body, "campaign activity").items, "campaign activity items")
    .map((item, index) => record(item, `campaign activity item ${index}`));
  const activitySourceStates = requireCompleteActivitySourceStates(activityResult.body);
  const immutableActivityKinds = new Set([
    "email_status",
    "external_send_recorded",
    "reply_recorded",
    "outcome",
    "outcome_recorded",
    "publication_recorded",
  ]);

  return {
    canonicalLead: canonicalLeadEvidence(item),
    activitySourceStates,
    drafts: {
      focused: leadContext.draft_versions,
      radio: communicator.radio_drafts,
    },
    tasks: activityItems.filter((item) => item.category === "task"),
    publicPage: publicPageResult.body,
    deliveryAndOutreachEvidence: activityItems.filter((item) => (
      typeof item.kind === "string" && immutableActivityKinds.has(item.kind)
    )),
  };
}

async function routeFixtureArtwork(page: Page) {
  await page.route(ARTWORK_FIXTURE_URL, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200"><rect width="1200" height="1200" fill="#174a41"/><circle cx="600" cy="600" r="360" fill="#eee5d5"/><path d="M340 690c180-360 340 240 520-120" fill="none" stroke="#d55f42" stroke-width="70" stroke-linecap="round"/><text x="72" y="1120" fill="#eee5d5" font-family="sans-serif" font-size="72">FOUNTAIN EDITS</text></svg>`,
    });
  });
}

async function captureReleaseGateScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const outputDirectory = path.join(process.cwd(), "output", "playwright");
  await mkdir(outputDirectory, { recursive: true });
  await page.screenshot({
    path: path.join(outputDirectory, `${name}-${testInfo.project.name}.png`),
    fullPage: true,
  });
}

async function expectNoHorizontalPageOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))).toMatchObject({ clientWidth: viewportWidth(page) });
  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  const overflow = geometry.scrollWidth > geometry.clientWidth
    ? await page.locator("body *").evaluateAll((elements) => elements
      .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth)
      .slice(0, 12)
      .map((element) => ({ tag: element.tagName, class: element.getAttribute("class"), right: element.getBoundingClientRect().right })))
    : [];
  expect(geometry.scrollWidth, `${page.url()} overflow: ${JSON.stringify(overflow)}`)
    .toBeLessThanOrEqual(geometry.clientWidth);
}

async function expectControlGeometry(container: ReturnType<Page["locator"]>, expectWrap: boolean) {
  await expect(container).toBeVisible();
  const geometry = await container.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const controls = [...element.querySelectorAll("button")]
      .map((button) => ({ button, bounds: button.getBoundingClientRect() }))
      .filter(({ bounds }) => bounds.width > 0 && bounds.height > 0)
      .map(({ bounds }) => ({
        top: Math.round(bounds.top),
        inside: bounds.left >= element.getBoundingClientRect().left - 0.5
          && bounds.right <= element.getBoundingClientRect().right + 0.5
          && bounds.top >= element.getBoundingClientRect().top - 0.5
          && bounds.bottom <= element.getBoundingClientRect().bottom + 0.5,
      }));
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      controls,
      distinctTops: [...new Set(controls.map((control) => control.top))].length,
      width: bounds.width,
    };
  });
  expect(geometry.width).toBeGreaterThan(0);
  expect(geometry.controls.length).toBeGreaterThan(0);
  expect(geometry.controls.every((control) => control.inside)).toBe(true);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  if (expectWrap) expect(geometry.distinctTops).toBeGreaterThan(1);
}

async function openCommandPalette(page: Page) {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("main")).toBeVisible({ timeout: 30_000 });

  if (viewportWidth(page) < 768) {
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("button", { name: "Open search" }).click({ force: true });
    return;
  }

  await page.getByRole("button", { name: "Open search" }).click();
}

async function scanSurface(page: Page, testInfo: TestInfo, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect.poll(() => `${new URL(page.url()).pathname}${new URL(page.url()).search}`).toBe(path);
  // Do not wait for network idle: the authenticated shell has health/worker activity by design.
  await expect(page.getByRole("main").first()).toBeVisible({ timeout: 30_000 });
  if (path.endsWith("?section=timeline")) {
    await expect(page.getByRole("tab", { name: "Timeline", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("region", { name: "Release schedule", exact: true })).toBeVisible();
  }
  await expectNoHorizontalPageOverflow(page);

  const theme = await page.evaluate(() => document.documentElement.classList.contains("dark") ? "dark" : "light");
  const screenshotName = `${testInfo.project.name}-${theme}-${path.replace(/[\\/]/g, "_")}.png`;
  await page.screenshot({
    path: testInfo.outputPath(screenshotName),
    fullPage: true,
    animations: "disabled",
  });

  const result = await new AxeBuilder({ page }).analyze();
  const sanitizeNodes = (nodes: AxeNodeEvidence[]) => nodes.map((node) => ({
    impact: node.impact ?? null,
    target: node.target,
  }));
  const sanitizeRules = (rules: AxeRuleEvidence[]) => rules.map((rule) => ({
    id: rule.id,
    impact: rule.impact ?? null,
    tags: rule.tags,
    description: rule.description,
    help: rule.help,
    helpUrl: rule.helpUrl,
    nodes: sanitizeNodes(rule.nodes),
  }));
  await testInfo.attach(`axe-${testInfo.project.name}-${theme}-${path.replace(/[\\/]/g, "_")}.json`, {
    body: JSON.stringify({
      url: page.url(),
      project: testInfo.project.name,
      theme,
      path,
      passes: sanitizeRules(result.passes),
      incomplete: sanitizeRules(result.incomplete),
      violations: sanitizeRules(result.violations),
      inapplicable: sanitizeRules(result.inapplicable),
    }, null, 2),
    contentType: "application/json",
  });
  expect(result.violations).toEqual([]);
}

async function setTheme(page: Page, dark: boolean) {
  await page.evaluate((isDark: boolean) => {
    localStorage.setItem("dark-mode", String(isDark));
  }, dark);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("main")).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
    .toBe(dark);
}

async function setAnalyticsFilter(
  page: Page,
  label: "artist" | "release",
  value: string,
  optionName: string,
) {
  const selects = page.getByRole("combobox");
  await expect(selects).toHaveCount(2);

  const select = label === "artist" ? selects.nth(0) : selects.nth(1);
  await expect(select).toBeVisible({ timeout: 5_000 });
  await select.click();

  const option = page.getByRole("option", { name: optionName, exact: true });
  await expect(option).toBeVisible({ timeout: 5_000 });
  await option.click();

  await expect
    .poll(async () => new URL(page.url()).searchParams.get(label))
    .toBe(value);
}

test("release workspace fits before hydration", async ({ page }) => {
  await login(page);
  await page.route("**/*", (route) => route.request().resourceType() === "script" ? route.abort() : route.continue());
  const releaseId = requiredFixture("E2E_RELEASE_ID", "Release layout requires a seeded release.");
  await page.goto(`/releases/${releaseId}?section=timeline`, { waitUntil: "load" });
  await expect(page.getByText("Release workspace map", { exact: true })).toBeVisible();
  await expectNoHorizontalPageOverflow(page);
});

test("core-surfaces-light-dark-a11y", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  expect(requiredFlows).toHaveLength(9);
  const renderLifecycleWarnings = captureRenderLifecycleWarnings(page);
  await login(page);
  const releaseId = requiredFixture("E2E_RELEASE_ID", "Schedule accessibility requires a seeded release.");
  const trackId = requiredFixture("E2E_TRACK_ID", "Catalog accessibility requires a seeded track.");
  const surfaces = ["/dashboard", "/analytics", "/artists", "/releases", `/catalog?track=${trackId}`, `/releases/${releaseId}?section=timeline`, "/campaigns", "/events", "/settings"];

  for (const path of surfaces) {
    await scanSurface(page, testInfo, path);
  }

  await setTheme(page, true);
  for (const path of surfaces) {
    await scanSurface(page, testInfo, path);
  }

  await setTheme(page, false);
  expect(renderLifecycleWarnings).toEqual([]);
});

test("release-blocker-to-exact-field", async ({ page }) => {
  const releaseId = requiredFixture(
    "E2E_RELEASE_ID",
    "Release blocker contract requires seeded E2E_RELEASE_ID.",
  );
  const trackId = requiredFixture(
    "E2E_TRACK_ID",
    "Release blocker contract requires seeded E2E_TRACK_ID.",
  );

  await login(page);
  await page.goto(`/releases/${releaseId}`);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Operations brief" })).toBeVisible({ timeout: 8_000 });

  const hasTrackBlocker = page.getByRole("button", { name: "Review tracks" }).first();
  await expect(
    hasTrackBlocker,
    "E2E_RELEASE_ID must point to a release with a visible Review tracks blocker.",
  ).toBeVisible({ timeout: 8_000 });

  await Promise.all([
    page.waitForURL(new RegExp(`^.*\\/releases\\/${releaseId}\\/tracks(?:[?#].*)?$`)),
    hasTrackBlocker.click(),
  ]);
  await expect(page).toHaveURL(new RegExp(`/releases/${releaseId}/tracks`));
  await expect(page).toHaveURL(new RegExp(`[?&]track=${encodeURIComponent(trackId)}`));
  await expect(page).toHaveURL(/[?&]focus=audio(?:&|$)/);
  await expect(page.locator("#track-audio")).toBeFocused({ timeout: 8_000 });
});

test("command-k-record-open", async ({ page }) => {
  const releaseId = requiredFixture(
    "E2E_RELEASE_ID",
    "Command-K record contract requires seeded E2E_RELEASE_ID.",
  );

  await login(page);

  await openCommandPalette(page);
  const dialog = page.getByRole("dialog", { name: "Command palette", exact: true });
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  const query = page.getByRole("combobox", { name: "Search commands" });
  await query.fill("Release Gate Single");
  await expect(page.getByRole("listbox", { name: "Search results" })).toHaveAttribute("aria-busy", "false", { timeout: 15_000 });
  const option = page.getByRole("option", { name: /Release Gate Single/ }).first();
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
  await expect(page).toHaveURL(new RegExp(`/releases/${releaseId}$`));
});

test("sidebar-collapse-reopen", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard");

  const width = viewportWidth(page);
  if (width < 768) {
    const more = page.getByRole("button", { name: "More" });
    await expect(more).toBeVisible({ timeout: 5_000 });
    await more.click();
    // Campaigns is also a primary bottom-tab destination now, so scope this to the
    // opened More sheet instead of matching both links in strict mode.
    const moreSheet = page.getByRole("dialog", { name: "More", exact: true });
    const campaigns = moreSheet.getByRole("link", { name: "Campaigns", exact: true });
    await expect(campaigns).toBeVisible({ timeout: 5_000 });
    await Promise.all([page.waitForURL("**/campaigns"), campaigns.click()]);
    await expect(page).toHaveURL(/\/campaigns$/);
    return;
  }

  const sidebar = page.locator("div[data-slot='sidebar'][data-state]").first();
  const toggle = page.locator("[data-sidebar='trigger']").first();
  await expect(sidebar).toHaveAttribute("data-state", "expanded");

  await toggle.click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");

  await toggle.click();
  await expect(sidebar).toHaveAttribute("data-state", "expanded");

  const artists = page.getByRole("link", { name: "Artists" });
  await expect(artists).toBeVisible({ timeout: 5_000 });
  await Promise.all([page.waitForURL("**/artists"), artists.click()]);
  await expect(page).toHaveURL(/\/artists$/);

  const analytics = page.getByRole("link", { name: "Analytics" });
  await Promise.all([page.waitForURL("**/analytics"), analytics.click()]);
  await expect(page).toHaveURL(/\/analytics$/);
});

test("mobile-primary-and-more-navigation", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("main")).toBeVisible({ timeout: 30_000 });

  if (viewportWidth(page) < 768) {
    const dashboard = page.locator("nav a[href='/dashboard']");
    await expect(dashboard).toBeVisible();
    await expect(page.getByRole("button", { name: "More" })).toBeVisible();
    await page.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("button", { name: "Open search" })).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("button", { name: "More" })).toBeVisible();
    return;
  }

  await expect(page.locator("div[data-slot='sidebar'][data-state]").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Dashboard" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "More" })).toHaveCount(0);
});

test("analytics-artist-release-filter", async ({ page }) => {
  const artistId = requiredFixture(
    "E2E_ARTIST_ID",
    "Analytics filter contract requires seeded E2E_ARTIST_ID.",
  );
  const releaseId = requiredFixture(
    "E2E_RELEASE_ID",
    "Analytics filter contract requires seeded E2E_RELEASE_ID.",
  );

  await login(page);
  await page.goto("/analytics?section=trends");

  const baseline = page.url();
  await setAnalyticsFilter(page, "artist", artistId, "Release Gate Artist");
  expect(new URL(page.url()).searchParams.get("artist")).toBe(artistId);
  expect(new URL(page.url()).searchParams.get("section")).toBe("trends");
  await setAnalyticsFilter(page, "release", releaseId, "Release Gate Single");
  expect(new URL(page.url()).searchParams.get("release")).toBe(releaseId);
  expect(new URL(page.url()).searchParams.get("section")).toBe("trends");

  await expect(page).not.toHaveURL(baseline);
});

test("analytics-workspace-hierarchy", async ({ page }) => {
  await login(page);
  const renderLifecycleWarnings = captureRenderLifecycleWarnings(page);

  await page.goto("/analytics?section=overview", { waitUntil: "domcontentloaded" });
  const analyticsSections = page.getByRole("navigation", { name: "Analytics sections" });
  await expect(analyticsSections).toBeVisible();

  const operations = page.locator("details").filter({ has: page.getByRole("heading", { name: "Royalties, campaigns, and tasks", exact: true }) });
  const summary = operations.locator("summary");
  await expect(summary).toBeVisible();
  await expect(operations.locator(".recharts-responsive-container")).toHaveCount(0);
  for (let cycle = 0; cycle < 2; cycle += 1) {
    await summary.press("Enter");
    await expect(operations.getByRole("heading", { name: "Campaign pipeline", exact: true })).toBeVisible();
    await expect.poll(() => operations.locator(".recharts-responsive-container").count()).toBeGreaterThan(0);
    await summary.press("Enter");
    await expect(operations.locator(".recharts-responsive-container")).toHaveCount(0);
  }

  const expected = [
    ["Overview", "overview", () => page.getByRole("heading", { name: "Overview", exact: true })],
    ["Trends", "trends", () => page.getByRole("heading", { name: "Trends", exact: true })],
    ["Audience", "audience", () => page.getByRole("heading", { name: "Audience", exact: true })],
    ["Discovery", "discovery", () => page.getByRole("heading", { name: "Discovery", exact: true })],
    ["Forecast", "forecast", () => page.getByRole("button", { name: "Cumulative streams", exact: true })],
    ["Data Health", "data-health", () => page.getByRole("heading", { name: "Analytics data health", exact: true })],
  ] as const;

  for (const [label, section, clientIslandReady] of expected) {
    const sectionLink = analyticsSections.getByRole("link", { name: label, exact: true });
    await sectionLink.click();
    await expect.poll(() => new URL(page.url()).searchParams.get("section")).toBe(section);
    await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
    await expect(sectionLink).toHaveAttribute("aria-current", "page");
    await expect(clientIslandReady()).toBeVisible();
    if (section === "data-health") {
      await expect(page.getByText("Complete batched evidence: 1,832 rows reviewed.")).toBeVisible();
      await expect(page.getByText("Same source identity")).toBeVisible();
      await expect(page.getByRole("button", { name: "keep separate", exact: true }).first()).toBeEnabled();
    }
  }

  expect(renderLifecycleWarnings).toEqual([]);
});

test("event-open-edit-and-project-context", async ({ page }) => {
  const eventId = requiredFixture(
    "E2E_EVENT_ID",
    "Seeded event seam flow requires E2E_EVENT_ID.",
  );

  await login(page);
  await page.goto(`/events/${eventId}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("main")).toBeVisible({ timeout: 30_000 });

  const editEvent = page.getByRole("button", { name: "Edit event" });
  await expect(editEvent).toBeVisible({ timeout: 8_000 });
  await expect(page.getByLabel("Attach or move")).toBeVisible({ timeout: 8_000 });
  await editEvent.click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 8_000 });
  await page.getByRole("button", { name: /Cancel|Close/ }).first().click();

  const campaignLinks = page.locator("section:has(h2:has-text('Campaign seam links')) a[href^='/campaigns/']");
  const campaignLink = campaignLinks.first();
  await expect(
    campaignLink,
    "E2E_EVENT_ID must point to an event with a visible linked campaign seam.",
  ).toBeVisible({ timeout: 8_000 });
  const campaignPath = await campaignLink.getAttribute("href");
  expect(campaignPath).toBeTruthy();
  expect(campaignPath).toMatch(/^\/campaigns\/[^/]+$/);

  await campaignLink.click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(campaignPath);
  await expect(page.getByRole("main")).toBeVisible({ timeout: 30_000 });
});

test("artist-readiness-to-exact-field", async ({ page }) => {
  const artistId = requiredFixture(
    "E2E_ARTIST_ID",
    "Roster-to-editor contract requires seeded E2E_ARTIST_ID.",
  );

  await login(page);
  await page.goto("/artists");

  const rosterLink = page.locator(`a[href="/artists/${artistId}"]`).first();
  await expect(rosterLink).toBeVisible({ timeout: 8_000 });
  await Promise.all([page.waitForURL(`**/artists/${artistId}`), rosterLink.click()]);
  await expect(page).toHaveURL(new RegExp(`/artists/${artistId}$`));
  await expect(page.getByRole("main")).toBeVisible();

  const readinessAction = page.getByRole("button", { name: /Edit .* Bio$/ }).first();
  await expect(readinessAction).toBeVisible({ timeout: 8_000 });
  await readinessAction.click();
  const artistDialog = page.getByRole("dialog");
  await expect(artistDialog).toBeVisible({ timeout: 8_000 });
  await expect(artistDialog.getByLabel("Bio", { exact: true })).toBeFocused({ timeout: 8_000 });
});

test("release-editor-tracks-contract", async ({ page }) => {
  const releaseId = requiredFixture(
    "E2E_RELEASE_ID",
    "Release editor tracks contract requires seeded E2E_RELEASE_ID.",
  );

  await login(page);
  await page.goto(`/releases/${releaseId}`);
  await expect(page).toHaveURL(new RegExp(`/releases/${releaseId}(?:/|$)`));

  const manageTracks = page.getByRole("link", { name: "Manage tracks" });
  await expect(manageTracks).toBeVisible({ timeout: 8_000 });
  const targetHref = await manageTracks.getAttribute("href");
  expect(targetHref).toBe(`/releases/${releaseId}/tracks`);
  await Promise.all([page.waitForURL("**/tracks"), manageTracks.click()]);
  await expect(page).toHaveURL(new RegExp(`/releases/${releaseId}/tracks$`));
});

test("campaign-preview-with-zero-unconfirmed-sends", async ({ page }, testInfo) => {
  await login(page);

  // Campaign preview without send
  const requestLedger: Array<{ method: string; path: string; confirmed: boolean }> = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/email\/send$/.test(request.url())) {
      requestLedger.push({ method: request.method(), path: new URL(request.url()).pathname, confirmed: false });
    }
  });

  await page.goto("/radio-stations", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("main")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Read-only for fundraiser")).toHaveCount(0);
  const stationCheckbox = page.locator("input[type='checkbox']").first();
  await expect(stationCheckbox).toBeVisible({ timeout: 8_000 });
  await stationCheckbox.check();

  const sendButton = page.getByRole("button", { name: /Send Email/i }).first();
  await expect(sendButton).toBeVisible({ timeout: 5_000 });
  await sendButton.click();
  const subject = page.getByPlaceholder("Email subject line…");
  const body = page.getByPlaceholder("Email body — HTML supported…");

  await subject.fill("Test {{artist_name}}");
  await body.fill("<p>{{station_name}} hello {{campaign_name}}</p>");

  const reviewSendButton = page.getByRole("button", { name: /Send to 1 station/i }).first();
  await reviewSendButton.click();
  await expect(page.getByText(/Preview \(for/)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("button", { name: /Cancel/ })).toBeVisible();
  expect(requestLedger).toEqual([]);

  await page.getByRole("button", { name: /Cancel/ }).click();
  await expect(page).toHaveURL(/\/radio-stations$/);
  await expect.poll(() => requestLedger.length).toBe(0);
  await testInfo.attach("release-gate-request-ledger.json", {
    body: JSON.stringify({ emailSendPostRequests: requestLedger, unconfirmedCount: requestLedger.length }, null, 2),
    contentType: "application/json",
  });
});

test("campaign-outreach-radio-workbench-keeps-review-and-send-authority-separate", async ({ page }, testInfo) => {
  const campaignId = RADIO_CAMPAIGN_ID;
  const manualDraftRequests: Array<{ method: string; path: string; body: unknown }> = [];
  const aiDraftRequests: Array<{ method: string; path: string }> = [];
  const publicationRequests: Array<{ method: string; path: string }> = [];
  let activeRevisionId = "";

  await routeFixtureArtwork(page);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname === `/api/campaigns/${campaignId}/radio-update-drafts`) {
      aiDraftRequests.push({ method: request.method(), path: url.pathname });
    }
    if (request.method() === "POST" && url.pathname === `/api/campaigns/${campaignId}/public-page/publish`) {
      publicationRequests.push({ method: request.method(), path: url.pathname });
    }
  });
  await page.route("**/api/campaign-outreach-drafts/*", async (route) => {
    const request = route.request();
    if (request.method() !== "PATCH") return route.continue();
    const url = new URL(request.url());
    const payload = request.postDataJSON() as { subject: string | null; body: string; body_document: unknown };
    const focused = url.pathname.includes("e2e-focused-draft-release-gate");
    manualDraftRequests.push({ method: request.method(), path: url.pathname, body: payload });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: url.pathname.split("/").at(-1),
        campaign_id: campaignId,
        lead_id: focused ? releaseGateFixtureWorld.ids.lead : null,
        enrichment_run_id: null,
        scope: focused ? "focused" : "radio_update",
        version: 2,
        status: "draft",
        subject: payload.subject,
        body: payload.body,
        context_snapshot: {
          scope: "radio_update",
          page_revision_id: activeRevisionId,
          page_revision_version: 1,
          campaign_id: campaignId,
        },
        approval_hash: null,
        approved_by: null,
        approved_at: null,
        created_at: "2026-08-05T08:00:00.000Z",
        updated_at: "2026-08-05T08:00:00.000Z",
      }),
    });
  });

  await login(page);
  await page.goto(`/campaigns/${campaignId}?tab=outreach`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("main").first()).toBeVisible({ timeout: 30_000 });

  const laneTabs = page.getByRole("tablist", { name: "Outreach lanes" });
  await expect(laneTabs).toBeVisible();
  await expect(laneTabs.getByRole("tab", { name: "Focused", exact: true })).toHaveAttribute("aria-selected", "true");
  const focusedPanel = page.getByRole("tabpanel", { name: "Focused", exact: true });
  await expect(focusedPanel).toBeVisible();
  await expect(focusedPanel.getByRole("heading", { name: "Release Gate FM", exact: true })).toBeVisible();
  const focusedBody = focusedPanel.getByRole("textbox", { name: "Outreach body", exact: true });
  await expect(focusedBody).toHaveAttribute("contenteditable", "true");
  await focusedBody.fill("Focused fixture copy saved as a distinct version.");
  await page.getByRole("button", { name: "Save as new draft", exact: true }).click();
  const savedDraftNotice = "Saved as a new draft version. Any earlier approval is no longer current.";
  await expect(page.getByRole("status").filter({ hasText: savedDraftNotice })).toHaveText(savedDraftNotice);
  await expectControlGeometry(focusedPanel.getByRole("toolbar", { name: "Outreach body formatting" }), viewportWidth(page) < 768);

  await laneTabs.getByRole("tab", { name: "Radio update", exact: true }).click();
  await expect(laneTabs.getByRole("tab", { name: "Radio update", exact: true })).toHaveAttribute("aria-selected", "true");
  const radioDesk = page.getByLabel("Radio update operator desk");
  await expect(radioDesk).toBeVisible();
  const sequence = radioDesk.getByRole("list", { name: "Radio update sequence" });
  await expect(sequence.getByRole("listitem")).toHaveCount(5);
  await expect(sequence).toContainText("Page draft");
  await expect(sequence).toContainText("Page reviewed");
  await expect(sequence).toContainText("Audience preview");
  await expect(sequence).toContainText("Email reviewed");
  await expect(sequence).toContainText("Delivery preview");

  await expect(page.getByText("Structured fields only · revision v1 · reviewed", { exact: true })).toBeVisible();
  await expect(page.getByText("Reviewed preview is available in this editor; it is not public.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Authenticated preview · not public")).toBeVisible();
  await expect(page.getByText("Preview · not public · reviewed revision", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fountain Edits — Radio Release Gate", exact: true })).toBeVisible();

  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Fountain Edits — unsaved operator edit");
  await expect(page.getByText("Unsaved page changes · save before review or publication.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark page reviewed", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Publish (owner)", exact: true })).toBeDisabled();
  await title.fill("Fountain Edits — Radio Release Gate");
  await expect(page.getByText("Unsaved page changes · save before review or publication.", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Publish (owner)", exact: true }).click();
  const publishConfirmationNotice = "Type publish to confirm the owner-only page action.";
  await expect(page.getByRole("status").filter({ hasText: publishConfirmationNotice })).toHaveText(publishConfirmationNotice);
  expect(publicationRequests).toEqual([]);

  await expect(radioDesk.getByLabel("AI assist")).toHaveCount(2);
  await expectControlGeometry(radioDesk.getByRole("toolbar", { name: "Release note formatting" }), viewportWidth(page) < 768);
  await expectControlGeometry(radioDesk.getByRole("toolbar", { name: "Radio email body formatting" }), viewportWidth(page) < 768);
  await expectControlGeometry(page.getByRole("button", { name: "Save page draft", exact: true }).locator("xpath=.."), viewportWidth(page) < 768);
  activeRevisionId = await page.getByLabel("Revision").inputValue();
  const subject = radioDesk.getByRole("textbox", { name: "Subject", exact: true });
  const body = radioDesk.getByRole("textbox", { name: "Radio email body", exact: true });
  await expect(subject).toHaveValue(RADIO_SUBJECT);
  await body.fill(`${RADIO_BODY}\n\nManual operator note.`);
  await page.getByRole("button", { name: "Save manual version", exact: true }).click();
  const radioDraftSavedNotice = "Radio draft v2 saved. Approval is the next action.";
  await expect(page.getByRole("status").filter({ hasText: radioDraftSavedNotice })).toHaveText(radioDraftSavedNotice);
  expect(manualDraftRequests).toEqual([
    {
      method: "PATCH",
      path: "/api/campaign-outreach-drafts/e2e-focused-draft-release-gate",
      body: {
        subject: "Fountain Edits — focused fixture",
        body: "Focused fixture copy saved as a distinct version.",
        body_document: expect.objectContaining({ type: "doc" }),
      },
    },
    {
      method: "PATCH",
      path: expect.stringMatching(/^\/api\/campaign-outreach-drafts\//),
      body: {
        subject: RADIO_SUBJECT,
        body: expect.stringContaining("Manual operator note."),
        body_document: expect.objectContaining({ type: "doc" }),
      },
    },
  ]);
  const radioDraftPayload = manualDraftRequests[1]?.body as { body: string; body_document: unknown };
  expect(radioDraftPayload.body).toBe(deriveCampaignDocument(radioDraftPayload.body_document, 10_000).plainText);
  expect(aiDraftRequests).toEqual([]);

  await page.getByRole("button", { name: "Approve email draft", exact: true }).click();
  const approvalConfirmationNotice = "Type approve to confirm this radio draft approval.";
  await expect(page.getByRole("status").filter({ hasText: approvalConfirmationNotice })).toHaveText(approvalConfirmationNotice);
  await expect(page.getByText("Recipient target: Independent radio network · no personalization · no delivery control", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(send|confirm send|deliver)/i })).toHaveCount(0);

  await expectNoHorizontalPageOverflow(page);
  await captureReleaseGateScreenshot(page, testInfo, "fountain-radio-workbench");
  await testInfo.attach("radio-workbench-request-ledger.json", {
    body: JSON.stringify({ manualDraftRequests, aiDraftRequests, publicationRequests }, null, 2),
    contentType: "application/json",
  });
});

test("campaign-discovery-pilot-keeps-evidence-review-and-promotion-bounded", async ({ page }, testInfo) => {
  const campaignId = RADIO_CAMPAIGN_ID;
  const discoveryRequests: Array<{ method: string; body: unknown }> = [];
  const forbiddenRequests: Array<{ method: string; url: string }> = [];

  const evidence = {
    provider_item_id: "video-fountain",
    provider: "youtube_data_api_v3",
    title: "Fountain — Cascade (Edit)",
    url: "https://youtube.test/video-fountain",
    query: "Fountain Cascade edit",
    published_at: "2026-08-14T10:00:00.000Z",
    retrieved_at: "2026-08-15T10:00:00.000Z",
  };
  const channel = (state: "unreviewed" | "shortlisted" | "promoted") => ({
    provider_channel_id: "fountain-channel",
    title: "Fountain Selectors",
    url: "https://youtube.test/channel-fountain",
    evidence: [evidence],
    exact_match_evidence: [evidence],
    prospective_fit: { qualifies: true, signals: ["matching_content_format", "recent_relevant_activity"] },
    activity_freshness: { state: "fresh", latest_activity_at: evidence.published_at, expires_at: "2026-11-15T10:00:00.000Z" },
    relevance: { exactness: 1, editorial_fit: 1, activity: 1, evidence_strength: 1, total: 4 },
    review: {
      state,
      reason: null,
      actor_user_id: state === "unreviewed" ? null : "e2e-operator",
      decided_at: state === "unreviewed" ? null : "2026-08-15T10:05:00.000Z",
      revision: state === "unreviewed" ? 0 : state === "shortlisted" ? 1 : 2,
      history: state === "unreviewed" ? [] : [{ state, reason: null, actor_user_id: "e2e-operator", decided_at: "2026-08-15T10:05:00.000Z", revision: state === "shortlisted" ? 1 : 2 }],
      promoted_lead_id: state === "promoted" ? "lead-fountain-1" : null,
      promotion_outcome: state === "promoted" ? "created" : null,
      promoted_evidence: state === "promoted" ? [evidence] : [],
      prior_campaign_decisions: [],
    },
  });
  const buildWorkspace = (state: "empty" | "unreviewed" | "shortlisted" | "promoted") => {
    const run = {
      id: "run-fountain-1",
      status: "partial" as const,
      created_at: "2026-08-15T10:00:00.000Z",
      estimated_cost_units: 200,
      queries: [
        { query: "Fountain Cascade edit", enabled: true, status: "completed" as const, error: null },
        { query: "Fountain selector", enabled: true, status: "failed" as const, error: "Provider quota exhausted; retry later." },
      ],
      channels: [channel(state === "empty" ? "unreviewed" : state)],
      exact_match_channels: [channel(state === "empty" ? "unreviewed" : state)],
      prospective_fit_channels: [channel(state === "empty" ? "unreviewed" : state)],
    };
    return {
      availability: { available: true, reason: null },
      query_preview: [
        { query: "Fountain Cascade edit", enabled: true, editable: true },
        { query: "Fountain selector", enabled: true, editable: true },
      ],
      estimated_cost_units: 200,
      runs: state === "empty" ? [] : [run],
    };
  };
  let workspace = buildWorkspace("empty");

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === `/api/campaigns/${campaignId}/discovery`) {
      discoveryRequests.push({ method: request.method(), body: request.method() === "POST" ? request.postDataJSON() : null });
    }
    if (forbiddenActivityRequest(url, request.method())) forbiddenRequests.push({ method: request.method(), url: request.url() });
  });
  await page.route(`**/api/campaigns/${campaignId}/discovery`, async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(workspace) });
      return;
    }
    const body = request.postDataJSON() as { type: string; channel_id?: string; expected_revision?: number; evidence_ids?: string[] };
    if (body.type === "run") {
      workspace = buildWorkspace("unreviewed");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(workspace.runs[0]!) });
      return;
    }
    if (body.type === "shortlist") {
      expect(body).toMatchObject({ channel_id: "fountain-channel", expected_revision: 0 });
      workspace = buildWorkspace("shortlisted");
    } else if (body.type === "promote") {
      expect(body).toMatchObject({ channel_id: "fountain-channel", expected_revision: 1, evidence_ids: ["video-fountain"] });
      workspace = buildWorkspace("promoted");
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(workspace) });
  });

  await login(page);
  await page.goto(`/campaigns/${campaignId}?tab=outreach`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("main").first()).toBeVisible({ timeout: 30_000 });
  const laneTabs = page.getByRole("tablist", { name: "Outreach lanes" });
  await expect(laneTabs.getByRole("tab", { name: "Discovery", exact: true })).toBeVisible();
  await laneTabs.getByRole("tab", { name: "Discovery", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Discovery", exact: true })).toBeVisible();
  await expect(page.getByText("Estimated quota cost: 200 units", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run discovery", exact: true })).toBeEnabled();

  await page.getByRole("button", { name: "Run discovery", exact: true }).click();
  await expect(page.getByRole("heading", { name: /partial run/i }).first()).toBeVisible();
  await expect(page.getByText(/Provider quota exhausted; retry later\./)).toBeVisible();
  await expect(page.getByRole("region", { name: "Exact-match evidence" }).first()).toContainText("Fountain Selectors");
  await expect(page.getByRole("region", { name: "Prospective fit" }).first()).toContainText("fresh");

  await page.getByRole("button", { name: "Shortlist", exact: true }).first().click();
  await expect(page.getByText("shortlisted", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Promote to Campaign Lead", exact: true }).first().click();
  await expect(page.getByText("promoted", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Campaign Lead: lead-fountain-1/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Send|Draft|Approve|Publish)/i })).toHaveCount(0);
  await expectNoHorizontalPageOverflow(page);
  expect(discoveryRequests.filter(({ method }) => method === "GET").length).toBeGreaterThan(0);
  expect(discoveryRequests.filter(({ method }) => method === "POST").length).toBe(3);
  expect(forbiddenRequests).toEqual([]);
  await captureReleaseGateScreenshot(page, testInfo, "fountain-campaign-discovery");
  await testInfo.attach("campaign-discovery-request-ledger.json", {
    body: JSON.stringify({ discoveryRequests, forbiddenRequests, externalCommunicationCount: forbiddenRequests.length }, null, 2),
    contentType: "application/json",
  });
});

test("campaign enrichment MCP is proposal-only across token lifecycle and tenant boundaries", async ({ page }, testInfo) => {
  const leadId = ACTIVITY_OPERATOR_LEAD_BY_PROJECT[testInfo.project.name as keyof typeof ACTIVITY_OPERATOR_LEAD_BY_PROJECT];
  if (!leadId) throw new Error(`No synthetic campaign enrichment lead is configured for ${testInfo.project.name}.`);

  const requestLedger: Array<{ method: string; host: string; path: string }> = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() !== "GET"
      || url.pathname.startsWith("/api/local-tools/")
      || url.pathname.startsWith("/api/settings/local-tool-tokens")
      || url.hostname !== new URL(page.url()).hostname
    ) {
      requestLedger.push({ method: request.method(), host: url.hostname, path: url.pathname });
    }
  });

  const tokenName = `Release gate Codex ${testInfo.project.name} ${randomUUID().slice(0, 8)}`;
  const proposalValue = `Synthetic Codex MCP programming focus for ${testInfo.project.name}`;
  let token: string | null = null;
  let tokenId: string | null = null;
  let claimId: string | null = null;
  let revoked = false;

  await login(page);
  try {
    await page.goto("/settings?section=codex-tools", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Codex tools", exact: true })).toBeVisible();
    await page.locator("[data-local-tool-token-hydrated='true']").waitFor();
    await page.getByLabel("Token name", { exact: true }).fill(tokenName);
    await expect(page.getByRole("button", { name: "Create 30-day token", exact: true })).toBeEnabled();
    const createResponsePromise = page.waitForResponse((response) => (
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/settings/local-tool-tokens"
    ));
    await page.getByRole("button", { name: "Create 30-day token", exact: true }).click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBe(201);
    const created = record(await createResponse.json() as unknown, "created token response");
    const createdRecord = record(created.record, "created token record");
    token = typeof created.token === "string" ? created.token : null;
    tokenId = typeof createdRecord.id === "string" ? createdRecord.id : null;
    expect(token).toMatch(/^lsmcp_[A-Za-z0-9-]+_[A-Za-z0-9_-]{43}$/);
    expect(tokenId).toBeTruthy();

    const oneTimePanel = page.locator("[aria-labelledby='one-time-token-title']");
    await expect(oneTimePanel).toBeVisible();
    await expect(oneTimePanel.locator("code")).toHaveText(token!);
    await oneTimePanel.getByRole("button", { name: "I stored this", exact: true }).click();
    await expect(oneTimePanel).toHaveCount(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(token!, { exact: true })).toHaveCount(0);
    await expect(page.locator("article").filter({ hasText: tokenName })).toBeVisible();

    const queueResult = await localToolJson(
      page,
      token!,
      `/api/local-tools/v1/campaign-enrichment/queue?campaign_id=${RADIO_CAMPAIGN_ID}&limit=50`,
    );
    const queue = localToolData(queueResult, "campaign enrichment queue");
    expect(array(queue.items, "campaign enrichment queue items")).toContainEqual(
      expect.objectContaining({ item_id: leadId, campaign_id: RADIO_CAMPAIGN_ID }),
    );

    const foreignItem = await localToolJson(
      page,
      token!,
      `/api/local-tools/v1/campaign-enrichment/items/${FOREIGN_TENANT_LEAD_ID}`,
    );
    expect(foreignItem.status).toBe(404);
    expect(record(record(foreignItem.body, "foreign tenant envelope").error, "foreign tenant error")).toMatchObject({
      code: "not_found",
      retryable: false,
    });

    const initialItem = localToolData(
      await localToolJson(page, token!, `/api/local-tools/v1/campaign-enrichment/items/${leadId}`),
      "initial campaign enrichment item",
    );
    const leadRevision = requiredBoundedString(initialItem.lead_revision, "lead revision", 64);
    expect(leadRevision).toMatch(/^[a-f0-9]{64}$/);
    const beforeSnapshot = await campaignProposalOnlySnapshot(page, token!, leadId);

    const claim = localToolData(await localToolJson(
      page,
      token!,
      `/api/local-tools/v1/campaign-enrichment/items/${leadId}/claim`,
      {
        method: "POST",
        body: JSON.stringify({ expected_lead_revision: leadRevision, lease_minutes: 1 }),
      },
    ), "campaign enrichment claim");
    claimId = typeof claim.id === "string" ? claim.id : null;
    expect(claimId).toBeTruthy();
    expect(claim.lead_id).toBe(leadId);

    const proposalResult = await localToolJson(
      page,
      token!,
      `/api/local-tools/v1/campaign-enrichment/items/${leadId}/proposals`,
      {
        method: "POST",
        body: JSON.stringify({
          claim_id: claimId,
          expected_lead_revision: leadRevision,
          idempotency_key: randomUUID(),
          proposals: [{
            field: "programming_focus",
            value: proposalValue,
            rationale: "Synthetic release-gate evidence verifies proposal intake without external research.",
            evidence: [{
              title: "Synthetic release-gate evidence",
              url: `https://example.test/campaign-enrichment/${testInfo.project.name}`,
              retrieved_at: "2026-08-10T12:00:00.000Z",
              citation_text: "Synthetic fixture citation; no external provider or delivery action occurred.",
            }],
          }],
          client: { name: "label-suite-codex", version: "release-gate", session_label: testInfo.project.name },
        }),
      },
    );
    expect(proposalResult.status).toBe(201);
    const proposal = record(record(proposalResult.body, "proposal envelope").data, "proposal data");
    const submittedSuggestions = array(proposal.suggestions, "submitted suggestions");
    expect(submittedSuggestions).toHaveLength(1);
    const submittedSuggestion = record(submittedSuggestions[0], "submitted suggestion");
    const submittedSuggestionId = requiredBoundedString(submittedSuggestion.id, "submitted suggestion ID", 128);
    claimId = null;

    const afterSnapshot = await campaignProposalOnlySnapshot(page, token!, leadId);
    expect(afterSnapshot).toEqual(beforeSnapshot);

    await page.goto(`/campaigns/${RADIO_CAMPAIGN_ID}?tab=outreach&lead=${leadId}`, { waitUntil: "domcontentloaded" });
    const researchLane = page.locator("#lead-research");
    await expect(researchLane).toContainText("Work this lead in Codex MCP");
    const pendingProposal = researchLane.locator("article").filter({ hasText: proposalValue });
    await expect(pendingProposal).toBeVisible();
    await expect(pendingProposal.getByText("pending", { exact: true })).toBeVisible();
    const communicatorAfterProposal = await browserJson(page, `/api/campaigns/${RADIO_CAMPAIGN_ID}/communicator-prompt`);
    expect(communicatorAfterProposal.status).toBe(200);
    const communicatorContext = record(communicatorAfterProposal.body, "communicator context after proposal");
    const proposalLeadContext = record(record(communicatorContext.leads, "communicator leads after proposal")[leadId], "proposal lead context");
    const storedProposal = array(proposalLeadContext.suggestions, "stored campaign suggestions")
      .map((suggestion, index) => record(suggestion, `stored campaign suggestion ${index}`))
      .find((suggestion) => suggestion.id === submittedSuggestionId);
    expect(storedProposal, "submitted proposal must be projected into communicator context").toBeTruthy();
    expect(storedProposal).toMatchObject({
      id: submittedSuggestionId,
      source_kind: "codex_mcp",
      status: "pending",
      suggested_value: {
        value: proposalValue,
        rationale: "Synthetic release-gate evidence verifies proposal intake without external research.",
      },
    });
    const storedProvenance = record(storedProposal!.provenance, "stored Codex MCP provenance");
    const submittingOperator = record(storedProvenance.submitting_operator, "submitting operator");
    const submittingOperatorId = requiredBoundedString(submittingOperator.id, "submitting operator ID", 128);
    const submittingOperatorName = requiredBoundedString(submittingOperator.name, "submitting operator name", 120);
    expect(submittingOperatorId).toBeTruthy();
    expect(storedProvenance.lead_revision).toBe(leadRevision);
    expect(storedProvenance.created_at).toBe(storedProposal!.created_at);
    expect(storedProvenance.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(array(storedProposal!.evidence, "stored proposal evidence")).toEqual([{
      title: "Synthetic release-gate evidence",
      url: `https://example.test/campaign-enrichment/${testInfo.project.name}`,
      retrieved_at: "2026-08-10T12:00:00.000Z",
      citation_text: "Synthetic fixture citation; no external provider or delivery action occurred.",
    }]);
    const provenanceLabel = pendingProposal.getByText("Submitted through Codex MCP", { exact: true });
    await expect(provenanceLabel).toBeVisible();
    const uiProvenance = await provenanceLabel.textContent();
    expect(uiProvenance).toBe("Submitted through Codex MCP");
    await expect(pendingProposal.getByText(`Submitted by ${submittingOperatorName}`, { exact: true })).toBeVisible();
    await expect(pendingProposal.locator("time").filter({ hasText: "Created" }))
      .toHaveAttribute("datetime", String(storedProvenance.created_at));
    await expect(pendingProposal.locator("code").filter({ hasText: leadRevision })).toHaveText(leadRevision);
    await expect(pendingProposal.getByText("Proposed value", { exact: true })).toBeVisible();
    await expect(pendingProposal.getByText(proposalValue, { exact: true })).toBeVisible();
    await expect(pendingProposal.getByText("Rationale", { exact: true })).toBeVisible();
    await expect(pendingProposal.getByText("Synthetic release-gate evidence verifies proposal intake without external research.", { exact: true })).toBeVisible();
    await expect(pendingProposal.getByRole("link", { name: "Source: Synthetic release-gate evidence", exact: true }))
      .toHaveAttribute("href", `https://example.test/campaign-enrichment/${testInfo.project.name}`);
    await expect(pendingProposal.locator("time").filter({ hasText: "10 Aug 2026" }))
      .toHaveAttribute("datetime", "2026-08-10T12:00:00.000Z");
    await expect(pendingProposal.getByRole("button", { name: "Accept fact", exact: true })).toBeVisible();
    await expect(pendingProposal.getByRole("button", { name: "Reject fact", exact: true })).toBeVisible();
    await captureReleaseGateScreenshot(page, testInfo, "campaign-enrichment-codex-mcp-pending");

    await page.goto("/settings?section=codex-tools", { waitUntil: "domcontentloaded" });
    const tokenArticle = page.locator("article").filter({ hasText: tokenName });
    const revokeResponsePromise = page.waitForResponse((response) => (
      response.request().method() === "DELETE"
      && new URL(response.url()).pathname === `/api/settings/local-tool-tokens/${tokenId}`
    ));
    await tokenArticle.getByRole("button", { name: `Revoke ${tokenName}`, exact: true }).click();
    const revokeResponse = await revokeResponsePromise;
    expect(revokeResponse.status()).toBe(200);
    await expect(tokenArticle).toContainText("Revoked");

    const revokedQueue = await localToolJson(
      page,
      token!,
      `/api/local-tools/v1/campaign-enrichment/queue?campaign_id=${RADIO_CAMPAIGN_ID}&limit=1`,
    );
    expect(revokedQueue.status).toBe(401);
    expect(record(record(revokedQueue.body, "revoked token envelope").error, "revoked token error"))
      .toMatchObject({ code: "authentication_failed", retryable: false });
    revoked = true;

    const forbiddenRequests = requestLedger.filter(forbiddenCampaignEnrichmentRequest);
    expect(forbiddenRequests).toEqual([]);
    await testInfo.attach("campaign-enrichment-codex-mcp-ledger.json", {
      body: JSON.stringify({
        project: testInfo.project.name,
        leadId,
        foreignTenant: { leadId: FOREIGN_TENANT_LEAD_ID, responseStatus: foreignItem.status },
        proposal: { uiProvenance, status: "pending", suggestionCount: 1 },
        noMutation: { equal: true, before: beforeSnapshot, after: afterSnapshot },
        revokedRequest: { status: revokedQueue.status, code: "authentication_failed" },
        requests: requestLedger,
        forbiddenRequests,
      }, null, 2),
      contentType: "application/json",
    });
  } finally {
    if (token && claimId) {
      await localToolJson(
        page,
        token,
        `/api/local-tools/v1/campaign-enrichment/items/${leadId}/claim/${claimId}`,
        { method: "DELETE" },
      ).catch(() => undefined);
    }
    if (tokenId && !revoked) {
      await browserJson(page, `/api/settings/local-tool-tokens/${encodeURIComponent(tokenId)}`, { method: "DELETE" })
        .catch(() => undefined);
    }
  }
});

test("campaign relationship activity is complete, filterable, and navigation-only", async ({ page }, testInfo) => {
  const forbiddenRequests: Array<{ method: string; url: string }> = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (forbiddenActivityRequest(url, request.method())) forbiddenRequests.push({ method: request.method(), url: request.url() });
  });

  await login(page);
  await page.goto(`/campaigns/${ACTIVITY_CAMPAIGN_ID}?tab=outreach`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("main").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
  await expect(page.getByText("Partial activity", { exact: true })).toHaveCount(0);

  const proposal = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Prepare outreach draft", exact: true }) }).first();
  await expect(proposal).toBeVisible();
  await expect(proposal).toContainText("Rationale:");
  await expect(proposal).toContainText("Evidence");
  const workflow = proposal.getByRole("link", { name: "Open workflow", exact: true });
  const workflowHref = await workflow.getAttribute("href");
  expect(workflowHref).toBeTruthy();
  const workflowUrl = new URL(workflowHref!, "https://suite.test");
  expect(workflowUrl.searchParams.get("tab")).toBe("outreach");
  expect(workflowUrl.searchParams.get("lead")).toMatch(/^e2e-activity-lead-/);
  expect(workflowUrl.hash).toBe("#lead-drafting");
  await captureReleaseGateScreenshot(page, testInfo, "campaign-relationship-activity");

  const chronology = page.getByRole("list", { name: "Activity chronology", exact: true });
  const allRows = chronology.getByRole("listitem");
  await expect(allRows).not.toHaveCount(0);
  const allCount = await allRows.count();
  await page.getByRole("button", { name: "Research", exact: true }).click();
  await expect(chronology.getByRole("listitem")).not.toHaveCount(0);
  expect(await chronology.getByRole("listitem").count()).toBeLessThan(allCount);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(chronology.getByRole("listitem")).not.toHaveCount(0);
  await expect(chronology).toContainText("Release-gate activity review");

  await Promise.all([
    page.waitForURL(new RegExp(`/campaigns/${ACTIVITY_CAMPAIGN_ID}\\?tab=outreach&lead=[^#]+#lead-drafting$`)),
    workflow.click(),
  ]);
  await expect(page.locator("#lead-drafting")).toBeVisible();
  expect(forbiddenRequests).toEqual([]);
});

test("campaign relationship activity lets an operator dismiss one proposal without workflow side effects", async ({ page }, testInfo) => {
  const forbiddenRequests: Array<{ method: string; url: string }> = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (forbiddenActivityRequest(url, request.method())) forbiddenRequests.push({ method: request.method(), url: request.url() });
  });

  await login(page);
  await page.goto(`/campaigns/${ACTIVITY_CAMPAIGN_ID}?tab=outreach`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
  const leadId = ACTIVITY_OPERATOR_LEAD_BY_PROJECT[testInfo.project.name as keyof typeof ACTIVITY_OPERATOR_LEAD_BY_PROJECT];
  const proposal = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Prepare outreach draft", exact: true }) }).filter({ has: page.locator(`a[href*="lead=${leadId}"]`) }).first();
  await expect(proposal).toBeVisible();
  await proposal.getByRole("button", { name: "Dismiss recommendation", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recommendation dismissed." })).toHaveText("Recommendation dismissed.");
  expect(forbiddenRequests).toEqual([]);
});

test("campaign relationship activity hides decision controls for a read-only member", async ({ page }) => {
  const forbiddenRequests: Array<{ method: string; url: string }> = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (forbiddenActivityRequest(url, request.method())) forbiddenRequests.push({ method: request.method(), url: request.url() });
  });

  await loginReadOnly(page);
  await page.goto(`/campaigns/${ACTIVITY_CAMPAIGN_ID}?tab=outreach`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recommendations", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dismiss recommendation", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mark handled", exact: true })).toHaveCount(0);
  expect(forbiddenRequests).toEqual([]);
});

test("campaign-radio-delivery-preview-is-deduplicated-versioned-and-no-send", async ({ page }, testInfo) => {
  const campaignId = RADIO_CAMPAIGN_ID;
  const requestLedger: Array<{ method: string; path: string; previewOnly: boolean; radioUpdate: boolean }> = [];
  const externalProviderRequests: string[] = [];

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (/api\.brevo\.com$/.test(url.hostname)) externalProviderRequests.push(request.url());
    if (request.method() !== "POST" || url.pathname !== "/api/email/send") return;
    const payload = request.postDataJSON() as { preview_only?: boolean; radio_update?: boolean };
    requestLedger.push({
      method: request.method(),
      path: url.pathname,
      previewOnly: payload.preview_only === true,
      radioUpdate: payload.radio_update === true,
    });
  });

  await login(page);
  await page.goto(`/campaigns/${campaignId}?tab=channels`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("main").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Saved audience targeting", exact: true })).toBeVisible();
  await expect(page.getByText("Release Gate independent-radio network", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Included stations", { exact: true }).first()).toBeVisible();

  const savedAudienceSection = page.getByRole("heading", { name: "Saved audience targeting", exact: true }).locator("xpath=ancestor::section[1]");
  const excludedDetails = savedAudienceSection.locator("details").filter({ hasText: "Excluded stations" });
  await excludedDetails.locator("summary").click();
  const focusedExclusion = excludedDetails.getByRole("listitem").filter({ hasText: "Release Gate FM" });
  await expect(focusedExclusion).toBeVisible();
  await expect(focusedExclusion).toContainText("Focused outreach");

  const previewResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "POST" && url.pathname === "/api/email/send";
  });
  await page.getByRole("button", { name: "Generate no-send delivery preview", exact: true }).click();
  const previewResponse = await previewResponsePromise;
  expect(previewResponse.status()).toBe(200);
  const previewPayload = await previewResponse.json() as {
    can_send: boolean;
    status: string;
    ready_count: number;
    skipped_count: number;
    deduped_count: number;
    preview_hash: string;
    reviewed_email: { version: number; approval_hash: string };
    reviewed_page: { version: number; content_hash: string; status: string };
    audience_counts: { included_stations: number; excluded_stations: number };
    excluded_stations: Array<{ name: string; reason: string }>;
    blockers: Array<{ code: string; message: string }>;
  };
  expect(previewPayload).toMatchObject({
    can_send: false,
    status: "no-send",
    ready_count: 1,
    skipped_count: 2,
    deduped_count: 1,
    reviewed_email: { version: 1 },
    reviewed_page: { version: 1, status: "reviewed" },
    audience_counts: { included_stations: 2, excluded_stations: 1 },
  });
  expect(previewPayload.reviewed_email.approval_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(previewPayload.reviewed_page.content_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(previewPayload.preview_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(previewPayload.excluded_stations).toContainEqual(expect.objectContaining({ name: "Release Gate FM", reason: "Focused outreach" }));
  expect(previewPayload.blockers).toContainEqual(expect.objectContaining({ code: "batch_compliance_unavailable" }));

  await expect(page.getByText("Reviewed email:", { exact: true }).locator("..")).toContainText("version 1");
  await expect(page.getByText("Reviewed page:", { exact: true }).locator("..")).toContainText("v1 · reviewed");
  await expect(page.getByText("Audience counts:", { exact: true }).locator("..")).toContainText("2 included · 1 excluded");
  await expect(page.getByText("Preview hash:", { exact: true }).locator("..")).toContainText(previewPayload.preview_hash);
  await expect(page.getByText("Deduplicated:", { exact: true }).locator("..")).toContainText("1");
  await expect(page.getByRole("alert")).toContainText("Batch compliance is unavailable until suppression and unsubscribe controls are reviewed");
  await expect(page.getByRole("button", { name: /^(send|confirm send|deliver)/i })).toHaveCount(0);

  const secondResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/email/send" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Generate no-send delivery preview", exact: true }).click();
  const secondPayload = await (await secondResponsePromise).json() as { preview_hash: string };
  expect(secondPayload.preview_hash).toBe(previewPayload.preview_hash);
  expect(requestLedger).toEqual([
    { method: "POST", path: "/api/email/send", previewOnly: true, radioUpdate: true },
    { method: "POST", path: "/api/email/send", previewOnly: true, radioUpdate: true },
  ]);
  expect(externalProviderRequests).toEqual([]);

  await testInfo.attach("radio-delivery-preview-ledger.json", {
    body: JSON.stringify({ requestLedger, externalProviderRequests, previewPayload, secondPreviewHash: secondPayload.preview_hash }, null, 2),
    contentType: "application/json",
  });
});

test("campaign-radio-public-renderer-uses-an-isolated-fixture-and-unpublished-review-stays-404", async ({ page }, testInfo) => {
  await routeFixtureArtwork(page);

  const unpublishedResponse = await page.goto(`/press/${RADIO_REVIEW_SLUG}`, { waitUntil: "domcontentloaded" });
  expect(unpublishedResponse?.status()).toBe(404);
  await expect(page.getByText("Not Found", { exact: true })).toBeVisible();

  const publicResponse = await page.goto(`/press/${RADIO_PUBLIC_SLUG}`, { waitUntil: "domcontentloaded" });
  expect(publicResponse?.status()).toBe(200);
  await expect(page.getByRole("main")).toBeVisible();
  const introCopy = page.locator(".fountain-press-intro-copy");
  const publicTitle = page.getByRole("heading", { name: "Fountain Edits — Published Fixture", exact: true });
  const networkNote = page.getByText("Shared with our independent radio network.", { exact: true });
  const releaseActions = page.getByRole("navigation", { name: "Release actions", exact: true });
  await expect(introCopy).toHaveCSS("opacity", "1");
  await expect(publicTitle).toBeVisible();
  await expect(networkNote).toBeVisible();
  await expect(releaseActions).toBeVisible();
  await expect(releaseActions.getByRole("link")).toHaveCount(3);
  await expect(page.getByRole("link", { name: "Listen to Fountain Edits — Published Fixture", exact: true })).toHaveAttribute("href", "https://example.test/fountain-listen");
  await expect(page.getByRole("heading", { name: "Focus edits", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Release Gate Track", exact: true })).toBeVisible();
  await expect(page.getByText(/Published 05 Aug 2026/)).toBeVisible();
  await expect(page.locator("link[rel='canonical']")).toHaveAttribute("href", new RegExp(`/press/${RADIO_PUBLIC_SLUG}$`));

  await expect(introCopy.getByRole("heading", { name: "Fountain Edits", exact: true })).toBeVisible();
  await expect(introCopy.locator("strong")).toHaveText("isolated");
  await expect(introCopy.getByRole("link", { name: "safe listen link", exact: true })).toHaveAttribute("href", "https://example.test/fountain-listen");
  await expect(introCopy).toContainText("<script>window.fixture = true</script> onclick=\"fixture()\" javascript:alert(1) data:text/html,fixture.");
  const unsafePublicMarkup = await introCopy.evaluate((element) => ({
    scripts: element.querySelectorAll("script").length,
    eventAttributes: [...element.querySelectorAll("*")].flatMap((child) => [...child.attributes]
      .map((attribute) => attribute.name)
      .filter((name) => name.toLowerCase().startsWith("on"))),
    unsafeUrls: [...element.querySelectorAll("a[href]")]
      .map((anchor) => anchor.getAttribute("href") ?? "")
      .filter((href) => /^(?:javascript|data|vbscript):/i.test(href.trim())),
  }));
  expect(unsafePublicMarkup).toEqual({ scripts: 0, eventAttributes: [], unsafeUrls: [] });

  await expectNoHorizontalPageOverflow(page);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  await captureReleaseGateScreenshot(page, testInfo, "fountain-radio-public");
});

test("campaign rich editor keeps AI review local until an explicit save", async ({ page }, testInfo) => {
  const campaignUpdateRequests: unknown[] = [];
  const aiLedger: Array<{ method: string; host: string; path: string }> = [];
  let suggestedRun = 0;

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
      aiLedger.push({ method: request.method(), host: url.hostname, path: url.pathname });
    }
  });
  await page.route(`**/api/campaigns/${RADIO_CAMPAIGN_ID}/editor-ai-runs`, async (route) => {
    const request = route.request();
    const payload = request.postDataJSON() as { current_document: unknown; input_document_hash: string };
    suggestedRun += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        run_id: `release-gate-intercepted-${suggestedRun}`,
        input_document_hash: payload.input_document_hash,
        proposed_document: {
          type: "doc",
          content: [
            { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "AI accepted fixture copy" }] },
            { type: "paragraph", content: [{ type: "text", text: "Accepted locally and still unsaved." }] },
          ],
        },
        rationale: "Deterministic intercepted proposal for keyboard review.",
        citation_ids: [],
        status: "ready",
        comparison: { before_label: "Current", proposed_label: "Proposed", blocks: [{ index: 0, changed: true, before: "Current fixture copy", proposed: "AI accepted fixture copy" }] },
        display: { provider: "release-gate-intercept", model: "fixture", context_manifest: { campaign: { id: RADIO_CAMPAIGN_ID } }, citations: [] },
      }),
    });
  });
  await page.route("**/api/campaign-editor-ai-runs/*", async (route) => {
    const decision = (route.request().postDataJSON() as { decision: "accepted" | "rejected" }).decision;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ run_id: new URL(route.request().url()).pathname.split("/").at(-1), status: decision }),
    });
  });
  await page.route("**/api/campaigns", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    campaignUpdateRequests.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: RADIO_CAMPAIGN_ID }) });
  });

  await login(page);
  await page.goto(`/campaigns/${RADIO_CAMPAIGN_ID}`, { waitUntil: "domcontentloaded" });
  const moreSections = page.getByRole("button", { name: "More campaign sections", exact: true });
  await expect(moreSections.locator("xpath=ancestor::astro-island[1]")).not.toHaveAttribute("ssr", "");
  await moreSections.click();
  await page.getByRole("menuitem", { name: "Details", exact: true }).click();
  const editCampaign = page.getByRole("button", { name: "Edit Fountain Edits — Release Gate Campaign", exact: true });
  await expect(editCampaign.locator("xpath=ancestor::astro-island[1]")).not.toHaveAttribute("ssr", "");
  await editCampaign.click();
  const form = page.locator("form");
  const goal = form.getByRole("textbox", { name: "Campaign goal", exact: true });
  const notes = form.getByRole("textbox", { name: "Campaign notes", exact: true });
  await expect(goal).toBeVisible();
  await expect(notes).toBeVisible();

  await expect(goal).toHaveAttribute("contenteditable", "true");
  const goalHeading = form.getByRole("toolbar", { name: "Campaign goal formatting" }).getByRole("button", { name: "Heading 2", exact: true });
  const initialGoalHeading = goal.getByRole("heading", { level: 2, name: "Release-gate airplay goal", exact: true });
  await initialGoalHeading.selectText();
  await goalHeading.focus();
  await page.keyboard.press("Enter");
  await expect(initialGoalHeading).toHaveCount(0);
  const plainGoalBlock = goal.getByText("Release-gate airplay goal", { exact: true });
  await plainGoalBlock.selectText();
  await goalHeading.focus();
  await page.keyboard.press("Enter");
  await expect(goal.getByRole("heading", { level: 2, name: "Release-gate airplay goal", exact: true })).toBeVisible();
  await expect(notes).toHaveAttribute("contenteditable", "true");
  const notesItalic = form.getByRole("toolbar", { name: "Campaign notes formatting" }).getByRole("button", { name: "Italic", exact: true });
  const initialItalicText = notes.locator("em", { hasText: "Fixture notes remain local to release-gate verification." });
  await initialItalicText.selectText();
  await notesItalic.focus();
  await page.keyboard.press("Enter");
  await expect(initialItalicText).toHaveCount(0);
  const plainNotesText = notes.getByText("Fixture notes remain local to release-gate verification.", { exact: true });
  await plainNotesText.selectText();
  await notesItalic.focus();
  await page.keyboard.press("Enter");
  await expect(notes.locator("em")).toHaveText("Fixture notes remain local to release-gate verification.");
  await expectControlGeometry(form.getByRole("toolbar", { name: "Campaign goal formatting" }), viewportWidth(page) < 768);
  await expectControlGeometry(form.getByRole("toolbar", { name: "Campaign notes formatting" }), viewportWidth(page) < 768);
  await expectControlGeometry(form.getByRole("button", { name: "Save Changes", exact: true }).locator("xpath=.."), false);

  const goalAssist = form.getByLabel("AI assist").first();
  const suggest = goalAssist.getByRole("button", { name: "Suggest changes", exact: true });
  await suggest.focus();
  await page.keyboard.press("Enter");
  const reviewHeading = goalAssist.getByRole("heading", { name: "Review AI suggestion", exact: true });
  await expect(reviewHeading).toBeFocused();
  await goalAssist.getByRole("button", { name: "Accept suggestion", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(goal).toBeFocused();
  await expect(goal).toContainText("AI accepted fixture copy");
  await expect(form.getByRole("status").filter({ hasText: "Unsaved changes" }).first()).toBeVisible();
  expect(campaignUpdateRequests).toEqual([]);

  await suggest.focus();
  await page.keyboard.press("Enter");
  await expect(reviewHeading).toBeFocused();
  await goalAssist.getByRole("button", { name: "Reject suggestion", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(goal).toBeFocused();
  expect(campaignUpdateRequests).toEqual([]);

  const saveRequest = page.waitForRequest((request) => request.method() === "PUT" && new URL(request.url()).pathname === "/api/campaigns");
  const reload = page.waitForEvent("framenavigated", (frame) => frame === page.mainFrame());
  await form.getByRole("button", { name: "Save Changes", exact: true }).click();
  await saveRequest;
  expect(campaignUpdateRequests).toEqual([expect.objectContaining({
    id: RADIO_CAMPAIGN_ID,
    goal_document: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "AI accepted fixture copy" }] },
        { type: "paragraph", content: [{ type: "text", text: "Accepted locally and still unsaved." }] },
      ],
    },
    notes_document: expect.objectContaining({
      type: "doc",
      content: expect.arrayContaining([
        expect.objectContaining({
          content: expect.arrayContaining([
            expect.objectContaining({ marks: [{ type: "italic" }] }),
          ]),
        }),
      ]),
    }),
  })]);
  await reload;
  await page.waitForLoadState("domcontentloaded");

  const prohibited = aiLedger.filter((entry) => (
    /(?:\/public-page\/(?:publish|unpublish)$|\/approve$|\/record-sent$|\/stage-override$|\/api\/email\/send$)/.test(entry.path)
    || /(?:brevo|sendgrid|mailgun|postmark)/i.test(entry.host)
  ));
  expect(prohibited).toEqual([]);
  await expectNoHorizontalPageOverflow(page);
  await captureReleaseGateScreenshot(page, testInfo, "campaign-rich-editor-ai-review");
  await testInfo.attach("campaign-rich-editor-ai-ledger.json", {
    body: JSON.stringify({ aiLedger, campaignUpdateRequests: campaignUpdateRequests.length }, null, 2),
    contentType: "application/json",
  });
});

test("campaign overview and outreach have responsive accessible editor surfaces", async ({ page }, testInfo) => {
  await login(page);
  for (const path of [`/campaigns/${RADIO_CAMPAIGN_ID}`, `/campaigns/${RADIO_CAMPAIGN_ID}?tab=outreach`]) {
    await scanSurface(page, testInfo, path);
    await expectNoHorizontalPageOverflow(page);
  }
});

test("enabled campaign controls immediately regain full contrast", async ({ page }) => {
  await login(page);
  await page.goto(`/campaigns/${RADIO_CAMPAIGN_ID}?tab=outreach`);
  const focused = page.getByRole("tab", { name: "Focused", exact: true });
  await expect(focused).toBeEnabled();
  const opacities = await focused.evaluate(async (tab) => {
    const fieldset = tab.closest("fieldset")!;
    fieldset.disabled = true;
    await Promise.all(fieldset.getAnimations({ subtree: true }).map((animation) => animation.finished));
    fieldset.disabled = false;
    // The same native state change happens when this island hydrates.
    await new Promise(requestAnimationFrame);
    return [...fieldset.querySelectorAll("button:not(:disabled)")].map((button) => getComputedStyle(button).opacity);
  });
  expect(opacities.length).toBeGreaterThan(0);
  expect(opacities.every((opacity) => opacity === "1")).toBe(true);
});
