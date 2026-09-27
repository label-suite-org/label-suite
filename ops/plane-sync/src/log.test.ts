import { describe, expect, it } from "vitest";
import { logSyncEvent } from "./log.js";
import type { SanitizedLogEvent } from "./types.js";

type ForbiddenLogField = "payload" | "body" | "header" | "token" | "key" | "environment" | "error";
type AssertNever<T extends never> = T;
type LogTypeExcludesSecrets = AssertNever<Extract<keyof SanitizedLogEvent, ForbiddenLogField>>;

const typeSurfaceCheck: LogTypeExcludesSecrets | undefined = undefined;
void typeSurfaceCheck;

describe("logSyncEvent", () => {
  it("writes only allowlisted structured fields", () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (value: unknown) => lines.push(String(value));
    try {
      logSyncEvent({
        level: "warn",
        code: "plane_request_failed",
        revision: "a1b2c3d",
        deliveryId: "b00c6c06-8888-4b6a-b3f9-911605477e51",
        event: "issues",
        action: "opened",
        subjectNumber: 129,
        planeWorkItemId: "plane-129",
        outcome: "mutated",
        durationMs: 42,
      });
    } finally {
      console.log = original;
    }

    expect(lines).toEqual([
      JSON.stringify({
        level: "warn",
        code: "plane_request_failed",
        revision: "a1b2c3d",
        deliveryId: "b00c6c06-8888-4b6a-b3f9-911605477e51",
        event: "issues",
        action: "opened",
        subjectNumber: 129,
        planeWorkItemId: "plane-129",
        outcome: "mutated",
        durationMs: 42,
      }),
    ]);
  });
});
