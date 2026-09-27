import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../../../../../server/api";
import { resolveReleaseSamplyDownload } from "../../../../../../../server/samply-release";
import { requireOrgId } from "../../../../../../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals, request }) => {
  try {
    const orgId = requireOrgId(locals);
    const releaseId = params.id;
    const fileId = params.fileId;

    if (!releaseId) {
      return json({ error: "Release id is required" }, 400);
    }
    if (!fileId) {
      return json({ error: "File id is required" }, 400);
    }

    const { url } = await resolveReleaseSamplyDownload(orgId, releaseId, fileId);
    const upstream = await fetch(url, {
      headers: request.headers.get("range")
        ? { Range: request.headers.get("range")! }
        : undefined,
    });

    if (!upstream.ok && upstream.status !== 206) {
      return json({ error: `Samply download failed with ${upstream.status}` }, 502);
    }

    const headers = new Headers();
    for (const header of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const value = upstream.headers.get(header);
      if (value) headers.set(header, value);
    }
    if (!headers.has("content-type")) headers.set("content-type", "audio/mpeg");
    headers.set("cache-control", "private, max-age=300");

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err) {
    return handleApiError(err);
  }
};
