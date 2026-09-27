import { describe, expect, it } from "vitest";
import {
  buildManualDeliveryPayload,
  deliveryPayloadWarnings,
  hashDeliveryPayload,
} from "./delivery-export-core";

const release = {
  id: "rel-1",
  title: "A Release",
  artist_id: "artist-1",
  release_date: "2026-09-01",
  format: "single",
  upc_ean: "123456789012",
};

describe("manual delivery export payloads", () => {
  it("builds a deterministic, internally identified payload", () => {
    const first = buildManualDeliveryPayload(release, [
      { id: "track-2", title: "B", position: 2, version: null, isrc: "ISRC-B", duration: 200, work_id: null },
      { id: "track-1", title: "A", position: 1, version: "main", isrc: "ISRC-A", duration: 180, work_id: "work-1" },
    ]);
    const second = buildManualDeliveryPayload(release, [
      { id: "track-1", title: "A", position: 1, version: "main", isrc: "ISRC-A", duration: 180, work_id: "work-1" },
      { id: "track-2", title: "B", position: 2, version: null, isrc: "ISRC-B", duration: 200, work_id: null },
    ]);

    expect(first).toEqual(second);
    expect(first.schema).toBe("label-suite.delivery");
    expect(first.tracks.map((track) => track.id)).toEqual(["track-1", "track-2"]);
    expect(hashDeliveryPayload(first)).toBe(hashDeliveryPayload(second));
  });

  it("reports actionable metadata gaps without changing the export", () => {
    const payload = buildManualDeliveryPayload(
      { ...release, upc_ean: null },
      [{ id: "track-1", title: "A", position: 1, version: null, isrc: null, duration: null, work_id: null }],
    );

    expect(deliveryPayloadWarnings(payload)).toEqual([
      { code: "missing_release_upc", message: "Release has no UPC/EAN" },
      { code: "missing_track_isrc", message: "Track A has no ISRC", track_id: "track-1" },
    ]);
  });

  it("rejects an invalid payload contract version", () => {
    expect(() => buildManualDeliveryPayload(release, [], 0)).toThrow("payload_version must be a positive integer");
  });
});
