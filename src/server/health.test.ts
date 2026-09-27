import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildHealthResponse, type PublicAnalyticsHealth } from "./health";

describe("buildHealthResponse", () => {
  const revisionDirectories: string[] = [];

  function writeRevisionArtifact(content: string): string {
    const directory = mkdtempSync(path.join(tmpdir(), "label-suite-revision-"));
    revisionDirectories.push(directory);
    const revisionPath = path.join(directory, ".release-revision");
    writeFileSync(revisionPath, content, "utf8");
    return revisionPath;
  }

  afterEach(() => {
    delete process.env.APP_COMMIT_SHA;
    delete process.env.APP_REVISION_FILE;
    while (revisionDirectories.length > 0) rmSync(revisionDirectories.pop()!, { recursive: true, force: true });
  });

  it("reports only the immutable revision embedded in the image", async () => {
    process.env.APP_REVISION_FILE = writeRevisionArtifact("a4c4a42b2e60c0a16d489935ef651e093618d34b\n");
    process.env.APP_COMMIT_SHA = "b4c4a42b2e60c0a16d489935ef651e093618d34b";
    const health = buildHealthResponse({ web: "ok", database: "ok", worker: "ok" });
    expect(health.revision).toBe("a4c4a42b2e60c0a16d489935ef651e093618d34b");
    expect(JSON.stringify(health)).not.toContain("DATABASE_URL");
  });

  it("fails closed when the embedded revision artifact is absent", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "label-suite-revision-missing-"));
    revisionDirectories.push(directory);
    process.env.APP_REVISION_FILE = path.join(directory, ".release-revision");
    process.env.APP_COMMIT_SHA = "a4c4a42b2e60c0a16d489935ef651e093618d34b";

    expect(buildHealthResponse({ web: "ok", database: "ok", worker: "ok" }).revision).toBeNull();
  });

  it("fails closed when the embedded revision artifact is malformed", () => {
    process.env.APP_REVISION_FILE = writeRevisionArtifact("unknown\n");
    process.env.APP_COMMIT_SHA = "a4c4a42b2e60c0a16d489935ef651e093618d34b";

    expect(buildHealthResponse({ web: "ok", database: "ok", worker: "ok" }).revision).toBeNull();
  });

  it("returns null when no immutable revision was supplied", () => {
    delete process.env.APP_COMMIT_SHA;
    expect(buildHealthResponse({ web: "ok", database: "ok", worker: "unknown", analytics: analytics("ok") })).toMatchObject({
      status: "ok",
      revision: null,
    });
  });

  it.each(
    (["ok", "unavailable"] as const).flatMap((database) =>
      (["ok", "unavailable", "unknown"] as const).flatMap((worker) =>
        [false, true].flatMap((requireWorker) =>
          (["ok", "degraded", "unknown"] as const).map((analyticsStatus) => ({ database, worker, requireWorker, analyticsStatus })),
        ),
      ),
    ),
  )("derives stable aggregate and application states for matrix entry %#", ({ database, worker, requireWorker, analyticsStatus }) => {
    const response = buildHealthResponse({
      web: "ok",
      database,
      worker,
      requireWorker,
      analytics: analytics(analyticsStatus),
    });
    const applicationStatus = database === "unavailable"
      ? "unhealthy"
      : worker === "unavailable"
        ? requireWorker ? "unhealthy" : "degraded"
        : "ok";
    const status = database === "unavailable"
      ? "unhealthy"
      : applicationStatus !== "ok" || analyticsStatus !== "ok"
        ? "degraded"
        : "ok";

    expect(response).toMatchObject({
      status,
      application: { status: applicationStatus },
      analytics: analytics(analyticsStatus),
    });
  });

  it("degrades public health for stale analytics without exposing tenant evidence", () => {
    const response = buildHealthResponse({ web: "ok", database: "ok", worker: "ok", analytics: analytics("degraded") });
    expect(response).toMatchObject({ status: "degraded", application: { status: "ok" }, analytics: { status: "degraded", freshness: "stale", coverage: "partial" } });
    expect(JSON.stringify(response)).not.toMatch(/org|tenant|run|row/i);
  });

  it("does not report unknown analytics as healthy", () => {
    expect(buildHealthResponse({ web: "ok", database: "ok", worker: "ok", analytics: analytics("unknown") }).status).toBe("degraded");
  });
});

function analytics(status: PublicAnalyticsHealth["status"]): PublicAnalyticsHealth {
  if (status === "ok") return { status, freshness: "current", coverage: "complete" };
  if (status === "degraded") return { status, freshness: "stale", coverage: "partial" };
  return { status, freshness: "unknown", coverage: "unknown" };
}
