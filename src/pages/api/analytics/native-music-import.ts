import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../server/api";
import { HttpError } from "../../../server/errors";
import { importNativeMusicSnapshot } from "../../../server/native-music-import";
import { NATIVE_MUSIC_MAX_BYTES, parseNativeMusicSnapshot } from "../../../server/native-music-snapshot";
import { requireCapability } from "../../../server/tenant";
import { boundedMultipartRequest } from "../../../server/upload-security";

export const prerender = false;
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const form = await (await boundedMultipartRequest(request, NATIVE_MUSIC_MAX_BYTES + 65536)).formData();
    const file = form.get("file");
    const artistId = form.get("artist_id");
    const action = form.get("action");
    if (!(file instanceof File) || !file.name.endsWith(".json") || typeof artistId !== "string" || !artistId.trim()) {
      throw new HttpError("An artist and native music snapshot JSON file are required", 400);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = parseNativeMusicSnapshot(bytes);
    if (action === "preview") return json({ kind: "preview", sha256: parsed.sha256, provider: parsed.snapshot.provider,
      artistName: parsed.snapshot.artistName, dateFrom: parsed.snapshot.dateFrom, dateThrough: parsed.snapshot.dateThrough,
      rowCount: parsed.snapshot.rows.length, total: parsed.total });
    const expectedSha256 = form.get("expected_sha256");
    if (action !== "apply" || typeof expectedSha256 !== "string") throw new HttpError("Preview is required before import", 400);
    return json(await importNativeMusicSnapshot({ orgId, artistId, bytes, fileName: file.name, expectedSha256 }));
  } catch (error) { return handleApiError(error); }
};
