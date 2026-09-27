import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../server/api";
import { requireCapability, requireOrgId } from "../../../server/tenant";
import { listBudgetProjects } from "../../../server/budget-dashboard";
import {
  createBudgetProject,
  createBudgetProjectSchema,
  updateBudgetProject,
  updateBudgetProjectSchema,
} from "../../../server/budget-mutations";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    const orgId = requireOrgId(locals);
    const projects = await listBudgetProjects(orgId);
    return json({ projects });
  } catch (err) {
    return handleApiError(err);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "projects.mutate");
    return json(await createBudgetProject(orgId, await parseJson(request, createBudgetProjectSchema)), 201);
  } catch (err) {
    return handleApiError(err);
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "projects.mutate");
    return json(await updateBudgetProject(orgId, await parseJson(request, updateBudgetProjectSchema)));
  } catch (err) {
    return handleApiError(err);
  }
};
