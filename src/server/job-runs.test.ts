import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const inserted: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];

  return {
    inserted,
    updated,
    db: {
      insert: vi.fn(() => ({
        values: vi.fn(async (value: Record<string, unknown>) => {
          inserted.push(value);
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((value: Record<string, unknown>) => {
          updated.push(value);
          return { where: vi.fn(async () => undefined) };
        }),
      })),
    },
  };
});

vi.mock("../lib/db", () => ({ db: mocks.db }));

import { runTrackedJob } from "./job-runs";

describe("runTrackedJob", () => {
  beforeEach(() => {
    mocks.inserted.length = 0;
    mocks.updated.length = 0;
    vi.clearAllMocks();
  });

  it("records successful job results", async () => {
    const result = await runTrackedJob(
      {
        orgId: "true-nature",
        jobType: "validation_sweep",
        trigger: "manual",
        payload: { reason: "test" },
      },
      async () => ({ created: 2, closed: 1 }),
    );

    expect(result).toEqual({ created: 2, closed: 1 });
    expect(mocks.inserted[0]).toMatchObject({
      org_id: "true-nature",
      job_type: "validation_sweep",
      trigger: "manual",
      status: "running",
      payload: { reason: "test" },
    });
    expect(mocks.updated[0]).toMatchObject({
      status: "succeeded",
      result: { created: 2, closed: 1 },
      error: null,
    });
  });

  it("records failures and rethrows the original error", async () => {
    const failure = new Error("sweep failed");

    await expect(runTrackedJob(
      { orgId: "true-nature", jobType: "validation_sweep", trigger: "api" },
      async () => {
        throw failure;
      },
    )).rejects.toBe(failure);

    expect(mocks.updated[0]).toMatchObject({
      status: "failed",
      error: "sweep failed",
    });
  });
});
