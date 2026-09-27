import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../../../../../../server/api";
import { listReleaseSamplyFileComments } from "../../../../../../../../server/samply-release";
import { requireOrgId } from "../../../../../../../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
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

    const comments = await listReleaseSamplyFileComments(orgId, releaseId, fileId);
    return json({
      comments: comments.map((comment) => ({
        id: comment.id,
        message: comment.message,
        completed: Boolean(comment.completed),
        audioTimestamp: comment.audioTimestamp ?? null,
        audioTimestampEnd: comment.audioTimestampEnd ?? null,
        timeCreated: comment.timeCreated ?? null,
        timeModified: comment.timeModified ?? null,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
};
