import { beforeEach, describe, expect, it, vi } from "vitest";

const tenant = vi.hoisted(() => ({
  requireCapability: vi.fn(() => "org-1"),
}));

const dbState = vi.hoisted(() => ({
  db: {
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../../../server/tenant", () => tenant);
vi.mock("../../../lib/db", () => dbState);

function buildChain(returnValue: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => Promise.resolve(returnValue)),
  };
  return chain;
}

describe("email templates route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invalidates reviewed metadata when template content changes", async () => {
    dbState.db.select.mockReturnValueOnce(
      buildChain([
        {
          subject: "Old subject",
          body: "Old body",
          current_version: 2,
          review_status: "reviewed",
          source_references: {
            release_id: null,
            artist_id: null,
            document_ids: [],
            media_asset_ids: [],
          },
        },
      ]),
    );
    dbState.db.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const { PUT } = await import("./templates");
    const response = await PUT({
      request: new Request("https://labels.example/api/email/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "template-1",
          subject: "New subject",
        }),
      }),
      locals: { orgId: "org-1", membershipRole: "owner" },
    } as never);

    expect(response.status).toBe(200);
    const updateCall = dbState.db.update.mock.results[0].value;
    expect(updateCall.set).toHaveBeenCalledWith(expect.objectContaining({
      subject: "New subject",
      current_version: 3,
      review_status: "draft",
      reviewed_at: null,
      reviewed_by: null,
      source_version: null,
    }));
  });
});
