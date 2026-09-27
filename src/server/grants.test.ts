import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectedRows: Array<Array<Record<string, unknown>>> = [];
  const inserted: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  const tx = {
    update: vi.fn(() => ({
      set: vi.fn((value: Record<string, unknown>) => {
        updated.push(value);
        return { where: vi.fn(async () => undefined) };
      }),
    })),
    delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    insert: vi.fn(() => ({ values: vi.fn(async (value: Record<string, unknown>) => inserted.push(value)) })),
  };
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => selectedRows.shift() ?? []) })),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn(async (value: Record<string, unknown>) => inserted.push(value)) })),
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { db, inserted, selectedRows, tx, updated };
});

vi.mock("../lib/db", () => ({ db: mocks.db }));
import {
  assertApplicationFundingSourceProject,
  assertApplicationOwner,
  createGrantApplication,
  createGrantApplicationSchema,
  effectiveApplicationFundingLinks,
  grantApplicationEventsForUpdate,
  updateGrantApplication,
} from "./grants";

describe("grant application operating fields", () => {
  beforeEach(() => {
    mocks.selectedRows.length = 0;
    mocks.inserted.length = 0;
    mocks.updated.length = 0;
    vi.clearAllMocks();
  });

  const existingApplication = (ownerUserId: string | null = null) => ({
    grant_id: null,
    project_id: null,
    funding_source_id: null,
    workflow_stage: "idea",
    outcome: "unknown",
    owner_contact_id: null,
    owner_user_id: ownerUserId,
    amount_awarded: null,
    submitted_at: null,
    reporting_due: null,
  });

  it("createGrantApplication accepts an active workspace member owner", async () => {
    mocks.selectedRows.push([{ id: "membership-1" }]);

    await expect(createGrantApplication("org-1", { owner_user_id: "user-member" })).resolves.toMatchObject({ ok: true });

    expect(mocks.db.select).toHaveBeenCalled();
    expect(mocks.inserted[0]).toMatchObject({ org_id: "org-1", owner_user_id: "user-member" });
  });

  it("createGrantApplication rejects a member from another organization", async () => {
    mocks.selectedRows.push([]);

    await expect(createGrantApplication("org-1", { owner_user_id: "user-other-org" }))
      .rejects.toThrow("Application owner must be an active workspace member");

    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it("createGrantApplication preserves a legacy contact-only owner", async () => {
    mocks.selectedRows.push([{ id: "contact-1" }]);

    await expect(createGrantApplication("org-1", { owner_contact_id: "contact-1" })).resolves.toMatchObject({ ok: true });

    expect(mocks.inserted[0]).toMatchObject({ org_id: "org-1", owner_contact_id: "contact-1", owner_user_id: null });
  });

  it("updateGrantApplication accepts an active workspace member owner", async () => {
    mocks.selectedRows.push([{ id: "membership-1" }], [existingApplication("user-member")]);
    const input = { id: "application-1", owner_user_id: "user-member" };

    await expect(updateGrantApplication("org-1", input))
      .resolves.toMatchObject({ ok: true });

    expect(mocks.db.select).toHaveBeenCalledTimes(2);
    expect(mocks.updated[0]).toMatchObject({ owner_user_id: "user-member" });
  });

  it("updateGrantApplication rejects a member from another organization", async () => {
    mocks.selectedRows.push([]);
    const input = { id: "application-1", owner_user_id: "user-other-org" };

    await expect(updateGrantApplication("org-1", input))
      .rejects.toThrow("Application owner must be an active workspace member");

    expect(mocks.db.select).toHaveBeenCalledTimes(1);
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("updateGrantApplication preserves a legacy contact-only owner", async () => {
    mocks.selectedRows.push([{ id: "contact-1" }], [existingApplication()]);
    const input = { id: "application-1", owner_contact_id: "contact-1" };

    await expect(updateGrantApplication("org-1", input))
      .resolves.toMatchObject({ ok: true });

    expect(mocks.db.select).toHaveBeenCalledTimes(2);
    expect(mocks.updated[0]).toMatchObject({ owner_contact_id: "contact-1" });
    expect(mocks.updated[0]).not.toHaveProperty("owner_user_id");
  });

  it("accepts an application owner who is an active workspace member", async () => {
    const lookup = vi.fn().mockResolvedValue(true);
    await expect(assertApplicationOwner("org-1", "user-member", lookup)).resolves.toBeUndefined();
    expect(lookup).toHaveBeenCalledWith("org-1", "user-member");
  });

  it("rejects an application owner who is not an active member of the organization", async () => {
    const lookup = vi.fn().mockResolvedValue(false);
    await expect(assertApplicationOwner("org-1", "user-other-org", lookup))
      .rejects.toThrow("Application owner must be an active workspace member");
  });

  it("preserves a legacy contact owner when no member mapping exists", async () => {
    const parsed = createGrantApplicationSchema.parse({ owner_contact_id: "contact-1", owner_user_id: null });
    await expect(assertApplicationOwner("org-1", parsed.owner_user_id)).resolves.toBeUndefined();
    expect(parsed).toMatchObject({ owner_contact_id: "contact-1", owner_user_id: null });
  });

  it("stores workflow stage independently from outcome", () => {
    const parsed = createGrantApplicationSchema.parse({
      workflow_stage: "decision_pending",
      outcome: "unknown",
      priority: "high",
      next_action: "Call the funder",
      next_action_due: "2026-08-01",
    });

    expect(parsed).toMatchObject({
      workflow_stage: "decision_pending",
      outcome: "unknown",
      priority: "high",
    });
  });

  it("derives durable events for material workflow and funding changes", () => {
    expect(grantApplicationEventsForUpdate({
      workflow_stage: "writing", outcome: "unknown", owner_contact_id: "owner-1",
      amount_awarded: 0, submitted_at: null, reporting_due: null,
    }, {
      workflow_stage: "submitted", outcome: "approved", owner_contact_id: "owner-2",
      amount_awarded: 25_000, submitted_at: "2026-08-30", reporting_due: "2027-01-01",
    })).toEqual([
      expect.objectContaining({ event_type: "workflow_stage", from_value: "writing", to_value: "submitted" }),
      expect.objectContaining({ event_type: "outcome", from_value: "unknown", to_value: "approved" }),
      expect.objectContaining({ event_type: "owner", from_value: "owner-1", to_value: "owner-2" }),
      expect.objectContaining({ event_type: "award", from_value: "0", to_value: "25000" }),
      expect.objectContaining({ event_type: "submission", from_value: null, to_value: "2026-08-30" }),
      expect.objectContaining({ event_type: "reporting", from_value: null, to_value: "2027-01-01" }),
    ]);
  });

  it("records completion of a next action as an auditable note event", () => {
    expect(grantApplicationEventsForUpdate({
      workflow_stage: "writing", outcome: "unknown", owner_contact_id: null,
      amount_awarded: 0, submitted_at: null, reporting_due: null, next_action: "Finish treatment",
    } as any, {
      next_action: null,
      next_action_due: null,
    })).toEqual([
      expect.objectContaining({ event_type: "note", from_value: "Finish treatment", to_value: null, note: "Completed next action" }),
    ]);
  });

  it("rejects a funding source from a different project on create or effective partial update", async () => {
    const lookup = vi.fn().mockResolvedValue("project-2");
    await expect(assertApplicationFundingSourceProject(
      "org-1", "project-1", "funding-1", lookup,
    )).rejects.toThrow("Funding source and grant application must belong to the same project");
    expect(lookup).toHaveBeenCalledWith("org-1", "funding-1");
  });

  it("allows a funding source belonging to the effective application project", async () => {
    const lookup = vi.fn().mockResolvedValue("project-1");
    await expect(assertApplicationFundingSourceProject(
      "org-1", "project-1", "funding-1", lookup,
    )).resolves.toBeUndefined();
  });

  it("computes effective project links for partial application updates", () => {
    const before = { project_id: "project-1", funding_source_id: "funding-1" };
    expect(effectiveApplicationFundingLinks(before, { id: "application-1", project_id: "project-2" }))
      .toEqual({ projectId: "project-2", fundingSourceId: "funding-1" });
    expect(effectiveApplicationFundingLinks(before, { id: "application-1", funding_source_id: "funding-2" }))
      .toEqual({ projectId: "project-1", fundingSourceId: "funding-2" });
  });
});
