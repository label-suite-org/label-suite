import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../drizzle/0051_job_worker_heartbeats.sql", import.meta.url), "utf8");

describe("job worker heartbeat migration", () => {
  it("tracks worker liveness without storing queue payloads", () => {
    expect(migration).toContain('"label_suite"."job_workers"');
    expect(migration).toContain('"last_seen_at"');
    expect(migration).toContain('"stopped_at"');
    expect(migration).toContain('"job_workers_status_check"');
    expect(migration).not.toContain("payload");
  });
});
