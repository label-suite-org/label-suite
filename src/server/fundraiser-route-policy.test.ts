import { describe, expect, it, vi } from "vitest";
import type { APIRoute } from "astro";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertBudgetMutationLinks } from "./budget-mutations";
import { assertWorkspaceLinks, type WorkspaceLinkKind } from "./grants-workspace";

vi.mock("../lib/db", () => ({ db: {}, pool: {} }));

process.env.PUBLIC_SITE_URL ??= "https://labels.example";

vi.mock("./budget-dashboard", () => ({
  listBudgetProjects: vi.fn().mockResolvedValue([]),
  getBudgetProject: vi.fn().mockResolvedValue(null),
}));
vi.mock("./budget-line-documents", () => ({
  listDocumentsForLine: vi.fn().mockResolvedValue([]),
  linkDocumentToLine: vi.fn().mockResolvedValue({ ok: true }),
  linkDocumentSchema: { parse: vi.fn() },
}));
vi.mock("./image-storage", () => ({ optimizeStoredImage: vi.fn().mockResolvedValue({ skipped: true }) }));

type RouteCase = {
  label: string;
  load: () => Promise<Record<string, unknown>>;
  method: string;
  capability: "read" | "fundraiser" | "owner";
  params?: Record<string, string>;
};

const approvedRoutes: RouteCase[] = [
  { label: "budget projects GET", load: () => import("../pages/api/budget-projects/index"), method: "GET", capability: "read" },
  { label: "budget projects POST", load: () => import("../pages/api/budget-projects/index"), method: "POST", capability: "fundraiser" },
  { label: "budget projects PATCH", load: () => import("../pages/api/budget-projects/index"), method: "PATCH", capability: "fundraiser" },
  { label: "budget dashboard GET", load: () => import("../pages/api/budget-projects/[projectId]/dashboard"), method: "GET", capability: "read", params: { projectId: "project-1" } },
  { label: "budget export GET", load: () => import("../pages/api/budget-projects/[projectId]/export"), method: "GET", capability: "read", params: { projectId: "project-1" } },
  { label: "budget items POST", load: () => import("../pages/api/budget-items"), method: "POST", capability: "fundraiser" },
  { label: "budget items PUT", load: () => import("../pages/api/budget-items"), method: "PUT", capability: "fundraiser" },
  { label: "budget lines POST", load: () => import("../pages/api/budget-line-items/index"), method: "POST", capability: "fundraiser" },
  { label: "budget lines PATCH", load: () => import("../pages/api/budget-line-items/index"), method: "PATCH", capability: "fundraiser" },
  { label: "budget line DELETE", load: () => import("../pages/api/budget-line-items/[id]"), method: "DELETE", capability: "fundraiser", params: { id: "line-1" } },
  { label: "budget documents GET", load: () => import("../pages/api/budget-line-items/[id]/documents"), method: "GET", capability: "read", params: { id: "line-1" } },
  { label: "budget documents POST", load: () => import("../pages/api/budget-line-items/[id]/documents"), method: "POST", capability: "fundraiser", params: { id: "line-1" } },
  { label: "budget variance POST", load: () => import("../pages/api/budget-line-items/[id]/variance"), method: "POST", capability: "fundraiser", params: { id: "line-1" } },
  { label: "funding source POST", load: () => import("../pages/api/funding-sources/index"), method: "POST", capability: "fundraiser" },
  { label: "funding source PATCH", load: () => import("../pages/api/funding-sources/index"), method: "PATCH", capability: "fundraiser" },
  { label: "funding source DELETE", load: () => import("../pages/api/funding-sources/[id]"), method: "DELETE", capability: "fundraiser", params: { id: "funding-1" } },
  { label: "funding source status PATCH", load: () => import("../pages/api/funding-sources/[id]/status"), method: "PATCH", capability: "fundraiser", params: { id: "funding-1" } },
  { label: "funding need POST", load: () => import("../pages/api/funding-needs"), method: "POST", capability: "fundraiser" },
  { label: "funding need PUT", load: () => import("../pages/api/funding-needs"), method: "PUT", capability: "fundraiser" },
  { label: "grant POST", load: () => import("../pages/api/grants"), method: "POST", capability: "fundraiser" },
  { label: "grant PUT", load: () => import("../pages/api/grants"), method: "PUT", capability: "fundraiser" },
  { label: "grant DELETE", load: () => import("../pages/api/grants"), method: "DELETE", capability: "fundraiser" },
  { label: "grant application POST", load: () => import("../pages/api/grant-applications"), method: "POST", capability: "fundraiser" },
  { label: "grant application PUT", load: () => import("../pages/api/grant-applications"), method: "PUT", capability: "fundraiser" },
  { label: "grant application DELETE", load: () => import("../pages/api/grant-applications"), method: "DELETE", capability: "fundraiser" },
  { label: "application funding needs PUT", load: () => import("../pages/api/grant-applications/[id]/funding-needs"), method: "PUT", capability: "fundraiser", params: { id: "application-1" } },
  { label: "application requirements PUT", load: () => import("../pages/api/grant-applications/[id]/requirements"), method: "PUT", capability: "fundraiser", params: { id: "application-1" } },
  { label: "contacts POST", load: () => import("../pages/api/contacts"), method: "POST", capability: "fundraiser" },
  { label: "contacts PUT", load: () => import("../pages/api/contacts"), method: "PUT", capability: "fundraiser" },
  { label: "contacts DELETE", load: () => import("../pages/api/contacts"), method: "DELETE", capability: "fundraiser" },
  { label: "organizations POST", load: () => import("../pages/api/organizations"), method: "POST", capability: "fundraiser" },
  { label: "organizations PUT", load: () => import("../pages/api/organizations"), method: "PUT", capability: "fundraiser" },
  { label: "organizations DELETE", load: () => import("../pages/api/organizations"), method: "DELETE", capability: "fundraiser" },
  { label: "contact organizations POST", load: () => import("../pages/api/contact-organizations"), method: "POST", capability: "fundraiser" },
  { label: "contact organizations PUT", load: () => import("../pages/api/contact-organizations"), method: "PUT", capability: "fundraiser" },
  { label: "contact organizations DELETE", load: () => import("../pages/api/contact-organizations"), method: "DELETE", capability: "fundraiser" },
  { label: "variance approve POST", load: () => import("../pages/api/variance-requests/[id]/approve"), method: "POST", capability: "owner", params: { id: "variance-1" } },
  { label: "variance reject POST", load: () => import("../pages/api/variance-requests/[id]/reject"), method: "POST", capability: "owner", params: { id: "variance-1" } },
];

const deniedRoutes: RouteCase[] = [
  { label: "releases", load: () => import("../pages/api/releases"), method: "POST", capability: "owner" },
  { label: "tracks", load: () => import("../pages/api/tracks"), method: "POST", capability: "owner" },
  { label: "works", load: () => import("../pages/api/works"), method: "POST", capability: "owner" },
  { label: "royalties", load: () => import("../pages/api/royalties"), method: "POST", capability: "owner" },
  { label: "radio", load: () => import("../pages/api/radio-stations"), method: "POST", capability: "owner" },
  { label: "email", load: () => import("../pages/api/email/send"), method: "POST", capability: "owner" },
  { label: "Gmail", load: () => import("../pages/api/gmail/connect"), method: "POST", capability: "owner" },
  { label: "Samply", load: () => import("../pages/api/releases/[id]/samply/link"), method: "POST", capability: "owner", params: { id: "release-1" } },
  { label: "settings", load: () => import("../pages/api/settings/workspace"), method: "PATCH", capability: "owner" },
  { label: "sweeps", load: () => import("../pages/api/sweep"), method: "POST", capability: "owner" },
  { label: "generic documents", load: () => import("../pages/api/documents"), method: "POST", capability: "owner" },
  { label: "member administration", load: () => import("../pages/api/members/[userId]"), method: "PATCH", capability: "owner", params: { userId: "member-1" } },
];

function routeRequest(method: string) {
  const origin = new URL(process.env.PUBLIC_SITE_URL ?? "https://labels.example").origin;
  return new Request(`${origin}/api/test`, {
    method,
    headers: { "content-type": "application/json", origin },
    body: method === "GET" || method === "HEAD" ? undefined : "{}",
  });
}

async function callRoute(route: RouteCase, role: string) {
  const module = await route.load();
  const handler = module[route.method] as APIRoute | undefined;
  expect(handler, `${route.label} must export ${route.method}`).toBeTypeOf("function");
  const request = routeRequest(route.method);
  return handler!({
    request,
    url: new URL(request.url),
    params: route.params ?? {},
    locals: { orgId: "org-1", membershipRole: role, user: { id: "user-1" } },
  } as never);
}

describe("fundraiser route policy", () => {
  it.each([
    ["../pages/api/budget-projects/index.ts", ["requireOrgId(locals)", "requireCapability(locals, \"projects.mutate\")"]],
    ["../pages/api/budget-projects/[projectId]/dashboard.ts", ["requireOrgId(locals)"]],
    ["../pages/api/budget-projects/[projectId]/export.ts", ["requireOrgId(locals)"]],
    ["../pages/api/budget-items.ts", ["requireCapability(locals, \"budgets.mutate\")"]],
    ["../pages/api/budget-line-items/index.ts", ["requireCapability(locals, \"budgets.mutate\")"]],
    ["../pages/api/budget-line-items/[id].ts", ["requireCapability(locals, \"budgets.mutate\")"]],
    ["../pages/api/budget-line-items/[id]/documents.ts", ["requireOrgId(locals)", "requireCapability(locals, \"grant_documents.mutate\")"]],
    ["../pages/api/budget-line-items/[id]/variance.ts", ["requireCapability(locals, \"budgets.mutate\")"]],
    ["../pages/api/funding-sources/index.ts", ["requireCapability(locals, \"budgets.mutate\")"]],
    ["../pages/api/funding-sources/[id].ts", ["requireCapability(locals, \"budgets.mutate\")"]],
    ["../pages/api/funding-sources/[id]/status.ts", ["requireCapability(locals, \"budgets.mutate\")"]],
    ["../pages/api/funding-needs.ts", ["requireCapability(locals, \"fundraising.mutate\")"]],
    ["../pages/api/grants.ts", ["requireCapability(locals, \"fundraising.mutate\")"]],
    ["../pages/api/grant-applications.ts", ["requireCapability(locals, \"fundraising.mutate\")"]],
    ["../pages/api/grant-applications/[id]/funding-needs.ts", ["requireCapability(locals, \"fundraising.mutate\")"]],
    ["../pages/api/grant-applications/[id]/requirements.ts", ["requireCapability(locals, \"fundraising.mutate\")"]],
    ["../pages/api/contacts.ts", ["requireCapability(locals, \"contacts.mutate\")"]],
    ["../pages/api/organizations.ts", ["requireCapability(locals, \"contacts.mutate\")"]],
    ["../pages/api/contact-organizations.ts", ["requireCapability(locals, \"contacts.mutate\")"]],
    ["../pages/api/storage/upload.ts", ["requireCapability(locals, \"grant_documents.mutate\")", "requireCapability(locals, \"operations.mutate\")"]],
    ["../pages/api/storage/upload-url.ts", ["requireCapability(locals, \"operations.mutate\")"]],
    ["../pages/api/storage/optimize-image.ts", ["requireCapability(locals, \"grant_documents.mutate\")", "requireCapability(locals, \"operations.mutate\")"]],
    ["../pages/api/variance-requests/[id]/approve.ts", ["requireCapability(locals, \"variance.decide\")"]],
    ["../pages/api/variance-requests/[id]/reject.ts", ["requireCapability(locals, \"variance.decide\")"]],
  ] as Array<[string, string[]]>) ("uses the exact classified guard in %s", (path, expectedGuards) => {
    const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
    for (const guard of expectedGuards) expect(source).toContain(guard);
    if (!expectedGuards.includes("requireMutateRole(locals)")) expect(source).not.toContain("requireMutateRole");
    expect(source).not.toContain("requireOwnerRole");
  });

  it.each(approvedRoutes.filter((route) => route.capability === "fundraiser"))(
    "allows fundraiser through $label and denies a read-only member",
    async (route) => {
      expect((await callRoute(route, "fundraiser")).status).not.toBe(403);
      expect((await callRoute(route, "member")).status).toBe(403);
    },
  );

  it.each(approvedRoutes.filter((route) => route.capability === "read"))(
    "allows organization members through $label",
    async (route) => {
      expect((await callRoute(route, "fundraiser")).status).not.toBe(403);
      expect((await callRoute(route, "member")).status).not.toBe(403);
    },
  );

  it.each([...approvedRoutes.filter((route) => route.capability === "owner"), ...deniedRoutes])(
    "denies fundraiser through $label",
    async (route) => {
      expect((await callRoute(route, "fundraiser")).status).toBe(403);
    },
  );

  it.each(["project", "budgetLine", "grant", "contact", "document"] as WorkspaceLinkKind[])(
    "rejects a cross-organization %s relationship",
    async (kind) => {
      const lookup = vi.fn().mockResolvedValue(false);
      await expect(assertWorkspaceLinks("org-1", { [kind]: "foreign-id" }, lookup))
        .rejects.toThrow("not found in active workspace");
      expect(lookup).toHaveBeenCalledWith("org-1", kind, "foreign-id");
    },
  );

  it("rejects cross-organization references in budget mutations", async () => {
    const lookup = vi.fn().mockResolvedValue(false);
    await expect(assertBudgetMutationLinks("org-1", { project: "foreign-project" }, lookup))
      .rejects.toThrow("Project not found in active workspace");
  });

  it("rejects a funding source from another budget project", async () => {
    const { assertSameBudgetProject } = await import("./budget-mutations");
    expect(() => assertSameBudgetProject("project-1", "project-2", "Funding source and budget line"))
      .toThrow("Funding source and budget line must belong to the same project");
  });
});
