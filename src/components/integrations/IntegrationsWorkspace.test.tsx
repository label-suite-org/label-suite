import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import IntegrationsWorkspace, { type IntegrationsWorkspaceData } from "./IntegrationsWorkspace";

const data: IntegrationsWorkspaceData = {
  providers: [], connections: [], errors: [],
  syncJobs: [{ id: "fixture", connection_id: "fixture", provider_key: "fixture", job_type: "pull", status: "queued", records_seen: 0, records_created: 0, records_updated: 0, records_failed: 0, error_summary: null, created_at: "2026-09-28T05:24:41.000Z", finished_at: null }],
};
afterEach(() => vi.unstubAllEnvs());
it("renders the same clearly labelled timestamp in different runtime time zones", () => {
  vi.stubEnv("TZ", "UTC");
  const server = renderToStaticMarkup(<IntegrationsWorkspace initialData={data} />);
  vi.stubEnv("TZ", "Europe/Copenhagen");
  const browser = renderToStaticMarkup(<IntegrationsWorkspace initialData={data} />);
  expect(browser).toBe(server);
  expect(server).toContain("2026-09-28 05:24:41 UTC");
});
