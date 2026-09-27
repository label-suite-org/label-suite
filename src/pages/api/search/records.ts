import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../server/api";
import { searchRecords } from "../../../server/record-search";
import { requireOrgId } from "../../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ locals, url }) => {
  try {
    const records = await searchRecords(requireOrgId(locals), url.searchParams.get("q"));
    return json({ records });
  } catch (error) {
    return handleApiError(error);
  }
};
