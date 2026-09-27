import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../server/api";
import { generateISRC, getWorkspaceIsrcConfig } from "../../../../lib/isrc";
import { requireCapability } from "../../../../server/tenant";
import { generateIsrcSchema, getWorkspaceSettings } from "../../../../server/settings";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, generateIsrcSchema);
    const config = await getWorkspaceIsrcConfig(orgId);

    if (!config) {
      return json({ error: "ISRC settings are not configured for this workspace" }, 400);
    }

    const isrc = await generateISRC(orgId, input.year);
    const settings = await getWorkspaceSettings(orgId, input.year);

    return json({
      ok: true,
      isrc,
      prefix: config.prefix,
      sequence_year: settings.sequence_year,
      sequence_last_production_number: settings.sequence_last_production_number,
      next_isrc_preview: settings.next_isrc_preview,
    });
  } catch (err) {
    return handleApiError(err);
  }
};
