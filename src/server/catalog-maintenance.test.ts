import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../lib/db", () => ({ db: database, pool: { query: vi.fn(), connect: vi.fn() } }));

import { triggerCatalogSweep } from "./catalog-maintenance";

describe("catalog maintenance scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.transaction.mockImplementation(async (operation: (tx: typeof database) => Promise<unknown>) => operation(database));
    database.execute.mockResolvedValue({ rows: [] });
  });

  it("awaits a contextual nested transaction before returning", async () => {
    // Break caught: a fire-and-forget raw-pool enqueue can race the outer
    // request commit and cannot see the mutation that triggered the sweep.
    const result = triggerCatalogSweep("org-a", "release update");

    expect(result).toBeInstanceOf(Promise);
    await result;
    expect(database.transaction).toHaveBeenCalledOnce();
    expect(database.execute).toHaveBeenCalledOnce();
  });

  it("keeps a best-effort enqueue failure from replacing the user mutation", async () => {
    database.transaction.mockRejectedValueOnce(new Error("queue unavailable"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(triggerCatalogSweep("org-a", "track create")).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
