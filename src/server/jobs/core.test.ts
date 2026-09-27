import { describe, expect, it } from "vitest";
import { publicJob, retryDelayMs, sanitizeJobError } from "./core";
import type { DurableJob } from "./types";

describe("durable job core", () => {
  it("uses bounded exponential retry delays", () => {
    expect(retryDelayMs(1)).toBe(1_000);
    expect(retryDelayMs(2)).toBe(2_000);
    expect(retryDelayMs(20)).toBe(15 * 60_000);
  });

  it("sanitizes secrets and connection credentials", () => {
    const error = new Error("token=abc failed at postgres://user:password@db.example/labels");
    const sanitized = sanitizeJobError(error);

    expect(sanitized.message).not.toContain("abc");
    expect(sanitized.message).not.toContain("user:password");
    expect(sanitized.message).toContain("[redacted]");
    expect(sanitized.metadata).toEqual({ name: "Error", retryable: true });
  });

  it("preserves a non-retryable classification", () => {
    const error = Object.assign(new Error("unsupported payload"), { retryable: false, code: "BAD_SCHEMA" });
    expect(sanitizeJobError(error).metadata).toEqual({
      name: "Error",
      code: "BAD_SCHEMA",
      retryable: false,
    });
  });

  it("returns an operator-safe job view without payload or result leakage", () => {
    const job = {
      id: "job-1",
      orgId: "org-1",
      jobType: "validation_sweep",
      trigger: "scheduled" as const,
      status: "failed",
      schemaVersion: 1,
      attempt: 3,
      maxAttempts: 5,
      payload: { internal_token: "redacted" },
      result: { provider_response: "secret" },
      error: "validation failed",
      errorMetadata: { name: "ValidationError", retryable: false },
      availableAt: new Date("2026-01-01T00:00:00.000Z"),
      startedAt: new Date("2026-01-01T00:01:00.000Z"),
      heartbeatAt: new Date("2026-01-01T00:01:10.000Z"),
      finishedAt: new Date("2026-01-01T00:01:15.000Z"),
      leaseOwner: "label-suite-worker",
      leaseExpiresAt: new Date("2026-01-01T00:02:00.000Z"),
      idempotencyKey: "scheduled:2026-01-01",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:01:15.000Z"),
    } satisfies DurableJob;

    const view = publicJob(job);

    expect(view).toMatchObject({
      id: "job-1",
      org_id: "org-1",
      job_type: "validation_sweep",
      trigger: "scheduled",
      status: "failed",
      attempt: 3,
      max_attempts: 5,
      error: "validation failed",
      error_metadata: { name: "ValidationError", retryable: false },
      lease_owner: "label-suite-worker",
      lease_expires_at: new Date("2026-01-01T00:02:00.000Z"),
      idempotency_key: "scheduled:2026-01-01",
    });
    expect((view as Record<string, unknown>)).not.toHaveProperty("payload");
    expect((view as Record<string, unknown>)).not.toHaveProperty("result");
  });
});
