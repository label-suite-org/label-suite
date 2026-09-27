import { describe, expect, it } from "vitest";
import {
  operatorJobsHealthSchema,
  operatorOperationsBriefInputSchema,
  operatorOperationsBriefSchema,
} from "./operator-diagnostics-contract";

describe("operator diagnostics contract", () => {
  it("accepts only bounded release or campaign identifiers", () => {
    expect(operatorOperationsBriefInputSchema.parse({
      resource_type: "release",
      resource_id: "release-1",
    })).toEqual({ resource_type: "release", resource_id: "release-1" });
    expect(operatorOperationsBriefInputSchema.safeParse({
      resource_type: "release",
      resource_id: "release-1",
      include_payloads: true,
    }).success).toBe(false);
    expect(operatorOperationsBriefInputSchema.safeParse({
      resource_type: "job",
      resource_id: "job-1",
    }).success).toBe(false);
  });

  it("rejects unsafe job fields and oversized brief output", () => {
    expect(operatorJobsHealthSchema.safeParse({
      queued: 1,
      running: 0,
      failed: 0,
      oldest_queued_at: null,
      expired_leases: 0,
      active_workers: 1,
      lease_owner: "worker-secret",
    }).success).toBe(false);
    expect(operatorOperationsBriefSchema.safeParse({
      resource_type: "release",
      record: {
        id: "release-1",
        title: "Release",
        artist_name: null,
        status: null,
        release_date: null,
        format: null,
        phase: null,
      },
      readiness: {
        state: "blocked",
        blockers: Array.from({ length: 21 }, (_, index) => `blocker-${index}`),
        next_action: { label: "Review release", href: "/releases/release-1" },
      },
    }).success).toBe(false);
  });
});
