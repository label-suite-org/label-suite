import { beforeEach, describe, expect, it, vi } from "vitest";

const readiness = vi.hoisted(() => ({
  lockWorkRoles: vi.fn(async () => undefined),
  persistAfterRoleChange: vi.fn(async () => undefined),
}));

const mocks = vi.hoisted(() => {
  const selectedRows: Array<Record<string, unknown>>[] = [];

  const inserted = vi.fn(async () => [{ id: "new-role" }]);
  const tx = {
    execute: vi.fn(async () => undefined),
    select: vi.fn((fields?: Record<string, unknown>) => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const rows = fields && Object.keys(fields).length === 1 && "work_id" in fields ? selectedRows[0] ?? [] : selectedRows.shift() ?? [];
          return Object.assign(Promise.resolve(rows), { for: vi.fn(async () => rows) });
        }),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({ returning: inserted })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Object.assign(Promise.resolve(undefined), { returning: vi.fn(async () => []) })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Object.assign(Promise.resolve(undefined), { returning: vi.fn(async () => []) })),
    })),
  };

  const db = {
    transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };

  return { db, tx, selectedRows, inserted };
});

vi.mock("../lib/readiness", () => readiness);
vi.mock("../lib/db", () => ({ db: mocks.db }));

import { createRole, updateRole, deleteRole } from "./roles";
import { NotFoundError } from "./errors";

describe("role mutations persist readiness for affected work/release pairs", () => {
  beforeEach(() => {
    mocks.selectedRows.length = 0;
    readiness.persistAfterRoleChange.mockClear();
    vi.clearAllMocks();
  });

  it("recomputes readiness after creating a linked role", async () => {
    mocks.selectedRows.push([{ id: "work-1" }], [{ id: "person-1" }], [], [], []);

    await expect(createRole("org-1", {
      work_id: "work-1",
      contact_id: "person-1",
      role: "Songwriter",
      ownership_type: "Rights",
      scope: "Publishing",
      percent_share: 100,
      clearance_status: "Signed",
    })).resolves.toMatchObject({ ok: true, id: expect.any(String) });

    expect(readiness.persistAfterRoleChange).toHaveBeenCalledTimes(1);
    expect(readiness.persistAfterRoleChange).toHaveBeenCalledWith("work-1", expect.any(Object), "org-1");
  });

  it("rejects duplicate role IDs before readiness or Work timestamp changes", async () => {
    mocks.selectedRows.push([{ id: "work-1" }]);
    mocks.inserted.mockResolvedValueOnce([]);
    await expect(createRole("org-1", { id: "duplicate", work_id: "work-1", role: "Credit", ownership_type: "Credit", clearance_status: "Unknown" }))
      .rejects.toMatchObject({ status: 409 });
    expect(readiness.persistAfterRoleChange).not.toHaveBeenCalled();
    expect(mocks.tx.update).not.toHaveBeenCalled();
  });

  it("accepts only a person contact from the same tenant for a credit role", async () => {
    mocks.selectedRows.push([{ id: "work-1" }], [{ id: "person-1" }], [], [], []);

    await expect(createRole("org-1", {
      work_id: "work-1",
      contact_id: "person-1",
      role: "Songwriter",
      ownership_type: "Credit",
      scope: "Publishing",
      percent_share: null,
      clearance_status: "Unknown",
    })).resolves.toMatchObject({ ok: true });
  });

  it("rejects an organization or radio-station id in the person-only credit slot", async () => {
    mocks.selectedRows.push([{ id: "work-1" }], [], [], [], []);

    await expect(createRole("org-1", {
      work_id: "work-1",
      contact_id: "radio-station-1",
      role: "Broadcaster",
      ownership_type: "Credit",
      scope: "Master",
      percent_share: null,
      clearance_status: "Unknown",
    })).rejects.toBeInstanceOf(NotFoundError);
  });

  it.each([
    ["legacy organization contact", [ { id: "organization-1" } ], [], []],
    ["legacy artist contact", [], [ { id: "artist-1" } ], []],
    ["legacy radio-station contact", [], [], [ { id: "station-1" } ]],
  ])("rejects a contact id duplicated by a canonical %s record", async (_label, organizationRows, artistRows, stationRows) => {
    mocks.selectedRows.push(
      [{ id: "work-1" }],
      [{ id: "legacy-entity-1" }],
      organizationRows,
      artistRows,
      stationRows,
    );

    await expect(createRole("org-1", {
      work_id: "work-1",
      contact_id: "legacy-entity-1",
      role: "Credit",
      ownership_type: "Credit",
      scope: "Master",
      percent_share: null,
      clearance_status: "Unknown",
    })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("recomputes readiness after updating a linked role", async () => {
    mocks.selectedRows.push([{
      id: "role-1",
      work_id: "work-2",
      contact_id: "person-1",
      ownership_type: "Rights",
      scope: "Publishing",
      percent_share: 100,
      clearance_status: "Signed",
      role: "Songwriter",
    }]);

    await expect(updateRole("org-1", { id: "role-1", clearance_status: "Confirmed" })).resolves.toMatchObject({ ok: true });

    expect(readiness.persistAfterRoleChange).toHaveBeenCalledTimes(1);
    expect(readiness.persistAfterRoleChange).toHaveBeenCalledWith("work-2", expect.any(Object), "org-1");
  });

  it.each([
    { contact_id: null },
    { scope: null },
    { scope: "Bogus" },
    { percent_share: null },
    { clearance_status: "Misspelled" },
    { ownership_type: "Misspelled" },
  ])("rejects incomplete or invalid web rights on create and update: %j", async (invalid) => {
    const valid = { work_id: "work-1", role: "Songwriter", contact_id: "person-1", ownership_type: "Rights", scope: "Publishing", percent_share: 100, clearance_status: "Signed" };
    mocks.selectedRows.push([{ id: "work-1" }]);
    await expect(createRole("org-1", { ...valid, ...invalid })).rejects.toMatchObject({ status: 400 });
    mocks.selectedRows.push([{ id: "role-1", ...valid }]);
    await expect(updateRole("org-1", { id: "role-1", ...invalid })).rejects.toMatchObject({ status: 400 });
    expect(mocks.tx.insert).not.toHaveBeenCalled();
    expect(mocks.tx.update).not.toHaveBeenCalled();
    expect(readiness.persistAfterRoleChange).not.toHaveBeenCalled();
  });

  it("recomputes readiness after deleting a linked role", async () => {
    mocks.selectedRows.push([{
      id: "role-2",
      work_id: "work-3",
      ownership_type: "Rights",
      scope: "Publishing",
      percent_share: 100,
      clearance_status: "Signed",
      role: "Songwriter",
    }]);

    await expect(deleteRole("org-1", { id: "role-2" })).resolves.toMatchObject({ ok: true });

    expect(readiness.persistAfterRoleChange).toHaveBeenCalledTimes(1);
    expect(readiness.persistAfterRoleChange).toHaveBeenCalledWith("work-3", expect.any(Object), "org-1");
  });
});
