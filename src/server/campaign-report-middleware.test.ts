import { beforeEach, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getSession: vi.fn(), resolveOrg: vi.fn(), transactionOptions: [] as unknown[], failCommit: false }));
vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
vi.mock("../lib/auth", () => ({ auth: { api: { getSession: auth.getSession } } }));
vi.mock("./tenant", () => ({ ACTIVE_ORG_COOKIE: "org", resolveActiveOrgForUser: auth.resolveOrg }));
vi.mock("../lib/db", async () => {
  const { createRequestScopedDatabase } = await import("../lib/db-context");
  type FakeDatabase = { transaction<T>(callback: (database: FakeDatabase) => Promise<T>, options?: unknown): Promise<T> };
  const root: FakeDatabase = {
    async transaction(callback, options) {
      auth.transactionOptions.push(options);
      const result = await callback(root);
      if (auth.failCommit && typeof options === "object" && options !== null && "isolationLevel" in options && options.isolationLevel === "repeatable read") {
        throw new Error("query failed", { cause: Object.assign(new Error("could not serialize"), { code: "40001" }) });
      }
      return result;
    },
  };
  const scoped = createRequestScopedDatabase<FakeDatabase, { userId: string; orgId?: string }>(root, async () => undefined);
  return { db: scoped.database, runWithDatabaseContext: scoped.run };
});
import { onRequest } from "../middleware";

function context(path: string) {
  const url = new URL(path, "https://label.example");
  return { url, request: new Request(url, { method: "POST", headers: { origin: url.origin } }), locals: {}, cookies: { get: vi.fn(), set: vi.fn() }, redirect: vi.fn(() => new Response(null, { status: 302 })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.transactionOptions.length = 0;
  auth.failCommit = false;
  process.env.PUBLIC_SITE_URL = "https://label.example";
  auth.getSession.mockResolvedValue({ user: { id: "actor-1" }, session: { id: "session-1" } });
  auth.resolveOrg.mockResolvedValue({ org: { id: "org-1", name: "Test", slug: "test", plan: null }, role: "operator" });
});

it("allows Campaign report finalisation to use the request-scoped repeatable-read transaction", async () => {
  const next = vi.fn(async () => {
    const { db } = await import("../lib/db");
    await db.transaction(async () => undefined, { isolationLevel: "repeatable read" });
    return new Response("ok");
  });
  const response = await onRequest(context("/api/campaigns/campaign-1/os") as never, next) as Response;
  expect(response.status).toBe(200);
  expect(next).toHaveBeenCalledOnce();
  expect(auth.transactionOptions).toContainEqual({ isolationLevel: "repeatable read" });
});

it("keeps unrelated Campaign POST requests at their existing transaction level", async () => {
  const response = await onRequest(context("/api/campaigns/campaign-1/content") as never, async () => new Response("ok")) as Response;
  expect(response.status).toBe(200);
  expect(auth.transactionOptions).not.toContainEqual({ isolationLevel: "repeatable read" });
});

it("returns a retryable conflict when the outer Campaign report transaction fails at commit", async () => {
  auth.failCommit = true;
  const response = await onRequest(context("/api/campaigns/campaign-1/os") as never, async () => new Response("ok")) as Response;
  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({ error: "Concurrent Campaign change; refresh and try again" });
});
