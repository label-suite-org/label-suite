import { describe, expect, test } from "vitest";
import { createReleaseMilestoneSchema, updateReleaseMilestoneSchema } from "./release-timeline";

describe("release milestone validation", () => {
  test("rejects an update that contains no mutable fields", () => {
    expect(updateReleaseMilestoneSchema.safeParse({ id: "milestone-1" }).success).toBe(false);
  });

  test("accepts a status-only completion update", () => {
    expect(updateReleaseMilestoneSchema.safeParse({ id: "milestone-1", status: "done" }).success).toBe(true);
  });

  test("rejects an unknown phase on creation", () => {
    expect(createReleaseMilestoneSchema.safeParse({ release_id: "release-1", title: "Approve final master", phase: "unknown" }).success).toBe(false);
  });

  test("rejects release reassignment on update", () => {
    expect(updateReleaseMilestoneSchema.safeParse({ id: "milestone-1", release_id: "release-2" }).success).toBe(false);
  });

  test("rejects release reassignment alongside a valid update field", () => {
    expect(updateReleaseMilestoneSchema.safeParse({ id: "milestone-1", release_id: "release-2", status: "done" }).success).toBe(false);
  });
});
