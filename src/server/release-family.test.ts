import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectedRows: Array<Array<Record<string, unknown>>> = [];
  const inserted: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  const tx = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(async () => selectedRows.shift() ?? []) })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((value: Record<string, unknown>) => ({
        onConflictDoNothing: vi.fn(async () => inserted.push(value)),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((value: Record<string, unknown>) => {
        updated.push(value);
        return {
          where: vi.fn(() => ({ returning: vi.fn(async () => [{ id: "release-1" }]) })),
        };
      }),
    })),
  };
  const db = { transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
  return { db, inserted, selectedRows, tx, updated };
});

vi.mock("../lib/db", () => ({ db: mocks.db }));
vi.mock("../lib/readiness", () => ({ persistReleaseReadiness: vi.fn(async () => undefined) }));

import { createRelease, updateRelease } from "./releases";

describe("release family relationships", () => {
  beforeEach(() => {
    mocks.inserted.length = 0;
    mocks.selectedRows.length = 0;
    mocks.updated.length = 0;
    vi.clearAllMocks();
  });

  test("accepts a single whose parent is an EP", async () => {
    mocks.selectedRows.push([{ id: "ep-1", format: "EP" }]);
    await expect(createRelease("org-1", { title: "Lead single", format: "single", parent_release_id: "ep-1" })).resolves.toMatchObject({ ok: true });
    expect(mocks.inserted[0]).toMatchObject({ format: "single", parent_release_id: "ep-1" });
  });

  test("rejects a non-single child with a parent", async () => {
    await expect(createRelease("org-1", { title: "Second EP", format: "EP", parent_release_id: "ep-1" })).rejects.toThrow("Only singles can have a parent release");
    expect(mocks.tx.insert).not.toHaveBeenCalled();
  });

  test("rejects a parent that is not an EP or album", async () => {
    mocks.selectedRows.push([{ id: "single-2", format: "single" }]);
    await expect(createRelease("org-1", { title: "Lead single", format: "single", parent_release_id: "single-2" })).rejects.toThrow("Parent release must be an EP or album");
    expect(mocks.tx.insert).not.toHaveBeenCalled();
  });

  test("clears an existing parent when format changes away from single", async () => {
    mocks.selectedRows.push([{ id: "release-1", format: "single", parent_release_id: "ep-1" }]);
    await updateRelease("org-1", { id: "release-1", format: "album" });
    expect(mocks.updated[0]).toMatchObject({ format: "album", parent_release_id: null });
  });

  test("rejects assigning a parent to an existing non-single release", async () => {
    mocks.selectedRows.push([{ id: "release-1", format: "album", parent_release_id: null }]);
    await expect(updateRelease("org-1", { id: "release-1", parent_release_id: "ep-1" })).rejects.toThrow("Only singles can have a parent release");
    expect(mocks.tx.update).not.toHaveBeenCalled();
  });
});
