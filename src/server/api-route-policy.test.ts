import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { relative } from "node:path";

const ROOT = new URL("../pages/", import.meta.url);
const MIDDLEWARE = new URL("../middleware.ts", import.meta.url);
const MUTATION_EXPORT = /export const (?:(?:POST|PUT|PATCH|DELETE)\b|\{[^}]*\b(?:POST|PUT|PATCH|DELETE)\b[^}]*\})/;
const NAMED_CAPABILITY = /requireCapability\(locals, "[^"]+"\)/;

const JUSTIFIED_EXCEPTIONS = new Map([
  ["api/native/data-quality/[id].ts", "scoped native bearer data-quality actions with fresh integrations.manage membership, revision and atomic audit"],
  ["api/native/notifications/preferences.ts", "native bearer self-owned notification consent with fresh workspace membership, role-limited categories and generation CAS"],
  ["api/native/notifications/devices.ts", "native bearer self-owned session registration/cancellation; registration additionally requires current workspace membership and explicit notification consent"],
  ["api/native/grants.ts", "scoped native bearer Grant changes with fundraising.mutate or grant_documents.mutate, exact revisions and atomic audit"],
  ["api/native/budget.ts", "scoped native bearer Budget mutation with budgets.mutate or owner variance.decide, exact revisions and atomic audit"],
  ["api/native/uploads.ts", "scoped native upload preparation with operations.mutate and actor-bound idempotency"],
  ["api/native/uploads/[id].ts", "bounded native private upload with operations.mutate and completion authorization"],
  ["api/native/campaigns/[id]/public-page.ts", "native scoped review, owner-only publication, fresh membership and exact snapshot checks"],
  ["api/native/campaigns/[id]/radio/[stationId].ts", "scoped native radio preparation with operations.mutate, exact revision and atomic audit; no delivery fields"],
  ["api/native/resources/[kind]/[id]/context.ts", "scoped native resource link/unlink with operations.mutate, exact revision and atomic audit"],
  ["api/native/works/[id]/roles.ts", "scoped native bearer role creation with operations.mutate and Work revision"],
  ["api/native/works/[id]/roles/[roleId].ts", "scoped native bearer role update with operations.mutate and exact revision"],
  ["api/artist-portal.ts", "revocable artist-link bearer with archive-scoped RLS and same-origin intake"],
  ["api/invitations/accept.ts", "authenticated invitation token exchange"],
  ["api/local-tools/v1/campaign-enrichment/items/[id]/claim.ts", "scoped local-tool bearer claim"],
  ["api/local-tools/v1/campaign-enrichment/items/[id]/claim/[claimId].ts", "scoped local-tool bearer release"],
  ["api/local-tools/v1/campaign-enrichment/items/[id]/proposals.ts", "scoped local-tool bearer propose"],
  ["api/native/session.ts", "scoped native bearer session selection"],
  ["api/native/sign-in.ts", "native bearer sign-in boundary"],
  ["api/native/browser-sign-in.ts", "same-origin authenticated browser authorization and single-use S256 proof exchange for a separate native session"],
  ["api/native/sign-out.ts", "scoped native bearer session revocation"],
  ["api/native/artists.ts", "scoped native bearer Artist creation with operations.mutate"],
  ["api/native/artists/[id].ts", "scoped native bearer Artist update with operations.mutate"],
  ["api/native/tracks/[trackId].ts", "scoped native bearer standalone Track update with operations.mutate, null Release context and exact revision"],
  ["api/native/releases/[id]/tracks/[trackId].ts", "scoped native bearer Track update with operations.mutate and exact revision"],
  ["api/native/releases/[id].ts", "scoped native bearer Release update with operations.mutate and explicit revision"],
  ["api/native/tasks/[id].ts", "scoped native bearer Task actions with operations.mutate"],
  ["api/native/campaign-leads/[id]/preparation.ts", "scoped native bearer preparation mutation"],
  ["api/native/campaign-leads/[id]/drafts/[draftId].ts", "scoped native bearer plain draft mutation"],
  ["api/native/campaign-leads/[id]/drafts/[draftId]/approve.ts", "scoped native bearer draft approval mutation"],
  ["api/native/campaigns/[id]/sections.ts", "scoped native bearer section selection with operations.mutate and revision guard"],
  ["api/native/campaigns/[id]/discovery.ts", "scoped native bearer discovery review mutation with operations.mutate"],
  ["api/native/contacts.ts", "scoped native bearer contact creation with contacts.mutate"],
  ["api/native/contacts/[id].ts", "scoped native bearer typed contact update/proposal decision with contacts.mutate and revision CAS"],
  ["api/native/events.ts", "scoped native bearer Event/Project mutation with projects.mutate"],
  ["api/native/events/[id].ts", "scoped native bearer Event/Project mutation with projects.mutate"],
  ["api/native/projects.ts", "scoped native bearer Event/Project mutation with projects.mutate"],
  ["api/native/projects/[id].ts", "scoped native bearer Event/Project mutation with projects.mutate"],
  ["api/storage/download-url.ts", "tenant-scoped signed read URL"],
  ["api/storage/download-urls.ts", "tenant-scoped signed read URLs"],
  ["invite/exchange.ts", "same-origin invitation token continuation"],
]);

function walk(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    return entry.isDirectory() ? walk(child) : [child];
  });
}

const mutationRoutes = walk(ROOT)
  .filter((file) => file.pathname.endsWith(".ts"))
  .map((file) => ({
    path: relative(new URL(".", ROOT).pathname, file.pathname),
    source: readFileSync(file, "utf8"),
  }))
  .filter(({ source }) => MUTATION_EXPORT.test(source));

describe("API route policy", () => {
  it("keeps the mutation-route inventory non-empty", () => {
    expect(mutationRoutes.length).toBeGreaterThan(50);
  });

  it("inventories factory-exported analytics mutation routes", () => {
    const routePaths = mutationRoutes.map(({ path }) => path);
    expect(routePaths).toContain("api/analytics/spotify-import.ts");
    expect(routePaths).toContain("api/analytics/sisense-track-import.ts");
  });

  it.each(mutationRoutes)("$path declares a named capability or approved exception", ({ path, source }) => {
    const exception = JUSTIFIED_EXCEPTIONS.get(path);
    expect(
      NAMED_CAPABILITY.test(source) || Boolean(exception),
      `${path} needs requireCapability(locals, "...") or a documented exception`,
    ).toBe(true);
  });

  it.each(mutationRoutes)("$path does not use the broad role mutation guard", ({ source }) => {
    expect(source).not.toContain("requireMutateRole");
  });

  it("does not retain stale exceptions", () => {
    const routePaths = new Set(mutationRoutes.map(({ path }) => path));
    for (const [path, reason] of JUSTIFIED_EXCEPTIONS) {
      expect(reason).toBeTruthy();
      expect(routePaths.has(path), `${path} is no longer a mutation route`).toBe(true);
    }
  });

  it("does not trust caller-supplied request IDs in route code", () => {
    for (const { path, source } of mutationRoutes) {
      expect(source, path).not.toMatch(/headers\.get\(["']x-request-id["']\)/i);
    }
  });

  it("enforces same-origin policy and response request IDs in middleware", () => {
    const source = readFileSync(MIDDLEWARE, "utf8");
    expect(source).toContain("requireSameOrigin(context.request)");
    expect(source).toContain('response.headers.set("X-Request-ID", requestId)');
    expect(source).toContain("context.locals.requestId = requestId");
  });
});
