import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "../../../server/errors";

const integrations = vi.hoisted(() => ({
  assertDataQualityTarget: vi.fn(),
  getDataQualityIssue: vi.fn(),
  listIntegrationConnections: vi.fn(),
  recordAuditEvent: vi.fn(),
  updateDataQualityIssue: vi.fn(),
  upsertExternalObjectLink: vi.fn(),
}));
const tenant = vi.hoisted(() => ({ requireCapability: vi.fn(() => "org-a") }));
const opsTasks = vi.hoisted(() => ({ createOpsTask: vi.fn() }));

vi.mock("../../../server/integrations", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../server/integrations")>(),
  ...integrations,
}));
vi.mock("../../../server/tenant", () => tenant);
vi.mock("../../../server/ops-tasks", () => opsTasks);

import { POST as LINK } from "./data-quality/[id]/link";
import { POST as CREATE_TASK } from "./data-quality/[id]/task";

const issue = {
  id: "dq-1",
  connection_id: "connection-1",
  source: "warm",
  issue_type: "unmatched_track",
  priority: "P1",
  status: "open",
  label_suite_object_type: null,
  label_suite_object_id: null,
  details: {},
};
const locals = { user: { id: "user-a" } } as never;

function linkRequest() {
  return new Request("https://suite.test/api/integrations/data-quality/dq-1/link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      connection_id: "connection-1",
      external_object_type: "track",
      external_object_id: "external-track-1",
      label_suite_object_type: "track",
      label_suite_object_id: "track-1",
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  integrations.getDataQualityIssue.mockResolvedValue(issue);
  integrations.listIntegrationConnections.mockResolvedValue([{ id: "connection-1", provider_key: "warm" }]);
  integrations.assertDataQualityTarget.mockResolvedValue({ id: "track-1" });
});

describe("integration data-quality actions", () => {
  it("does not link an issue outside the authenticated organization", async () => {
    integrations.getDataQualityIssue.mockRejectedValue(new NotFoundError("Data quality issue not found in active workspace"));
    const response = await LINK({ params: { id: "dq-other-org" }, request: linkRequest(), locals } as never);
    expect(response.status).toBe(404);
    expect(integrations.upsertExternalObjectLink).not.toHaveBeenCalled();
  });

  it("does not link through a connection outside the authenticated organization", async () => {
    integrations.listIntegrationConnections.mockResolvedValue([]);
    const response = await LINK({ params: { id: "dq-1" }, request: linkRequest(), locals } as never);
    expect(response.status).toBe(404);
    expect(integrations.assertDataQualityTarget).not.toHaveBeenCalled();
    expect(integrations.upsertExternalObjectLink).not.toHaveBeenCalled();
  });

  it("does not link to a canonical target outside the authenticated organization", async () => {
    integrations.assertDataQualityTarget.mockRejectedValue(new NotFoundError("Target track was not found in active workspace"));
    const response = await LINK({ params: { id: "dq-1" }, request: linkRequest(), locals } as never);
    expect(response.status).toBe(404);
    expect(integrations.assertDataQualityTarget).toHaveBeenCalledWith("org-a", "track", "track-1");
    expect(integrations.upsertExternalObjectLink).not.toHaveBeenCalled();
  });

  it("does not create a task for an issue outside the authenticated organization", async () => {
    integrations.getDataQualityIssue.mockRejectedValue(new NotFoundError("Data quality issue not found in active workspace"));
    const response = await CREATE_TASK({
      params: { id: "dq-other-org" },
      request: new Request("https://suite.test/api/integrations/data-quality/dq-other-org/task", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      locals,
    } as never);
    expect(response.status).toBe(404);
    expect(opsTasks.createOpsTask).not.toHaveBeenCalled();
  });
});
