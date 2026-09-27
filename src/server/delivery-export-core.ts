import { createHash } from "node:crypto";

export type DeliveryRelease = {
  id: string;
  title: string;
  artist_id: string | null;
  release_date: string | null;
  format: string | null;
  upc_ean: string | null;
};

export type DeliveryTrack = {
  id: string;
  title: string;
  position: number | null;
  version: string | null;
  isrc: string | null;
  duration: number | null;
  work_id: string | null;
};

export type ManualDeliveryPayload = {
  schema: "label-suite.delivery";
  payload_version: number;
  release: {
    id: string;
    title: string;
    artist_id: string | null;
    release_date: string | null;
    format: string | null;
    upc_ean: string | null;
  };
  tracks: Array<{
    id: string;
    title: string;
    position: number | null;
    version: string | null;
    isrc: string | null;
    duration: number | null;
    work_id: string | null;
  }>;
};

export function stableJsonStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJsonStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function hashDeliveryPayload(payload: ManualDeliveryPayload) {
  return createHash("sha256").update(stableJsonStringify(payload)).digest("hex");
}

export function buildManualDeliveryPayload(
  release: DeliveryRelease,
  tracks: DeliveryTrack[],
  payloadVersion = 1,
): ManualDeliveryPayload {
  if (!Number.isInteger(payloadVersion) || payloadVersion < 1) {
    throw new Error("payload_version must be a positive integer");
  }

  return {
    schema: "label-suite.delivery",
    payload_version: payloadVersion,
    release: {
      id: release.id,
      title: release.title,
      artist_id: release.artist_id,
      release_date: release.release_date,
      format: release.format,
      upc_ean: release.upc_ean,
    },
    tracks: [...tracks]
      .sort((left, right) => (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id))
      .map((track) => ({
        id: track.id,
        title: track.title,
        position: track.position,
        version: track.version,
        isrc: track.isrc,
        duration: track.duration,
        work_id: track.work_id,
      })),
  };
}

export function deliveryPayloadWarnings(payload: ManualDeliveryPayload) {
  const warnings: Array<{ code: string; message: string; track_id?: string }> = [];
  if (!payload.release.upc_ean) {
    warnings.push({ code: "missing_release_upc", message: "Release has no UPC/EAN" });
  }
  for (const track of payload.tracks) {
    if (!track.isrc) warnings.push({ code: "missing_track_isrc", message: `Track ${track.title} has no ISRC`, track_id: track.id });
  }
  return warnings;
}
