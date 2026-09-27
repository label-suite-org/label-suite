import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import { requireCapability } from "../../server/tenant";
import {
  createOpsTask,
  createOpsTaskSchema,
  deleteOpsTask,
  deleteOpsTaskSchema,
  updateOpsTask,
  updateOpsTaskSchema,
} from "../../server/ops-tasks";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, createOpsTaskSchema);
    return json(await createOpsTask(orgId, input), 201);
  } catch (err) {
    return handleApiError(err);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, updateOpsTaskSchema);
    return json(await updateOpsTask(orgId, input));
  } catch (err) {
    return handleApiError(err);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, deleteOpsTaskSchema);
    return json(await deleteOpsTask(orgId, input));
  } catch (err) {
    return handleApiError(err);
  }
};
