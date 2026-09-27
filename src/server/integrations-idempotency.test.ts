import { beforeAll, describe, expect, it } from "vitest";

let integrations: typeof import("./integrations");

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://label_suite:label_suite@127.0.0.1:5432/label_suite";
  integrations = await import("./integrations");
});

describe("integration idempotency helpers", () => {
  it("hashes provider payloads deterministically regardless of object key order", () => {
    expect(integrations.hashIntegrationPayload({ title: "Track", ids: { isrc: "DK123" } }))
      .toBe(integrations.hashIntegrationPayload({ ids: { isrc: "DK123" }, title: "Track" }));
  });

  it("keeps data-quality replay keys stable when review details change", () => {
    const base = {
      source: "warm",
      issue_type: "station_unmatched",
      idempotency_key: null,
      label_suite_object_type: null,
      label_suite_object_id: null,
      external_object_type: "station",
      external_object_id: "station-1",
    };

    expect(integrations.deriveDataQualityIssueIdempotencyKey({
      ...base,
      details: { note: "first import" },
    })).toBe(integrations.deriveDataQualityIssueIdempotencyKey({
      ...base,
      details: { note: "second import with richer context" },
    }));
  });

  it("uses an explicit data-quality idempotency key when supplied", () => {
    expect(integrations.deriveDataQualityIssueIdempotencyKey({
      source: "manual",
      issue_type: "rights_missing",
      idempotency_key: "dq:manual:rights:release-1",
      label_suite_object_type: null,
      label_suite_object_id: null,
      external_object_type: null,
      external_object_id: null,
      details: { note: "ignored for explicit keys" },
    })).toBe("dq:manual:rights:release-1");
  });
});
