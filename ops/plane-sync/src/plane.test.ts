import { describe, expect, it, vi } from "vitest";
import { PermanentSyncError, RetryableSyncError } from "./errors.js";
import { PlaneClient, PlaneModuleMembershipInventory } from "./plane.js";

interface RemoteItem {
  id: string;
  name: string;
  description_html: string;
  state: string;
  priority: string;
  labels: string[];
  module_ids: string[];
  updated_at?: string;
}

interface RemoteComment {
  id: string;
  comment_html: string;
  external_source?: string | null;
  external_id?: string | null;
}

function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
}

async function observedRateLimitDelay(retryAfter: string, now: number): Promise<number> {
  const waits: number[] = [];
  let attempts = 0;
  const client = new PlaneClient({
    baseUrl: new URL("https://plane.example.test"),
    apiToken: "plane-test-token",
    workspace: "label-suite",
    projectId: "project-id",
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return json({ detail: "rate limited" }, 429, { "retry-after": retryAfter });
      return json({
        id: "work-item-128",
        name: "Recovered item",
        description_html: "",
        state: "todo-state",
        priority: "none",
        labels: [],
        module_ids: [],
      });
    },
    sleep: async (delayMs) => { waits.push(delayMs); },
    now: () => now,
  });

  await client.getWorkItem("work-item-128");
  return waits[0]!;
}

function statefulPlane(
  initialItems: RemoteItem[] = [],
  options: {
    failNextModuleAssociation?: boolean;
    applyThenFailModuleAssociation?: boolean;
    failModuleDeleteAttempt?: number;
    notFoundModuleDeleteAttempt?: number;
    bodylessModuleMutations?: boolean;
    malformedCreateResponse?: boolean;
    moduleMode?: "move" | "additive";
    omitModuleIdsFromWorkItemResponses?: boolean;
    moduleIssuePageSize?: number;
    extraModules?: Array<{ id: string; name: string }>;
  } = {},
): {
  fetchImpl: typeof fetch;
  items: RemoteItem[];
  moduleIssues: Array<{ moduleId: string; itemId: string }>;
  moduleDeletes: Array<{ moduleId: string; itemId: string }>;
  comments: RemoteComment[];
  requests: Array<{ method: string; path: string; body: Record<string, unknown> | null }>;
} {
  let revision = 0;
  const nextUpdatedAt = () => `2026-08-01T00:00:${String(revision++).padStart(2, "0")}.000Z`;
  const items: RemoteItem[] = initialItems.map((item) => ({
    ...item,
    labels: [...item.labels],
    module_ids: [...item.module_ids],
    updated_at: item.updated_at ?? nextUpdatedAt(),
  }));
  const moduleIssues: Array<{ moduleId: string; itemId: string }> = [];
  const moduleDeletes: Array<{ moduleId: string; itemId: string }> = [];
  const comments: RemoteComment[] = [
    { id: "manual-comment", comment_html: "<p>Manual note</p>" },
    { id: "manual-comment-null-metadata", comment_html: "<p>Manual note two</p>", external_source: null, external_id: null },
  ];
  const requests: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = [];
  const moduleNames = [
    "Product Confidence & Delivery",
    "Analytics & Forecasting",
    "Artists, Releases & Rights",
    "Directory & Campaigns",
    "Events, Tasks & Search",
    "Content, Assets & Budgets",
  ];
  const configuredModuleIds = [...new Set([
    ...items.flatMap((item) => item.module_ids),
    "product-module",
    "analytics-module",
    "artists-module",
    "directory-module",
    "events-module",
    "assets-module",
  ])].slice(0, moduleNames.length);
  const configuredModules = (options.extraModules === undefined
    ? configuredModuleIds
    : ["product-module", "analytics-module", "artists-module", "directory-module", "events-module", "assets-module"]
  ).map((id, index) => ({ id, name: moduleNames[index]! }));
  const extraModules = options.extraModules ?? [];
  const responseItem = (item: RemoteItem): Omit<RemoteItem, "module_ids"> | RemoteItem => {
    const { module_ids, ...withoutModuleIds } = item;
    return options.omitModuleIdsFromWorkItemResponses
      ? { ...withoutModuleIds, labels: [...withoutModuleIds.labels] }
      : { ...withoutModuleIds, labels: [...withoutModuleIds.labels], module_ids: [...module_ids] };
  };
  let failNextModuleAssociation = options.failNextModuleAssociation ?? false;
  let applyThenFailModuleAssociation = options.applyThenFailModuleAssociation ?? false;
  let moduleDeleteAttempt = 0;
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (new Headers(init.headers).get("x-api-key") !== "plane-test-token") return json({ detail: "wrong token" }, 401);
    const path = url.pathname;
    const requestBody = init.body === undefined ? null : (JSON.parse(String(init.body)) as Record<string, unknown>);
    requests.push({ method: init.method ?? "GET", path, body: requestBody });
    if (init.method === "GET" && path.endsWith("/states/")) {
      return json({
        results: [
          { id: "backlog-state", name: "Backlog" },
          { id: "todo-state", name: "Todo" },
          { id: "progress-state", name: "In Progress" },
          { id: "done-state", name: "Done" },
          { id: "cancelled-state", name: "Cancelled" },
        ],
        next_cursor: null,
      });
    }
    if (init.method === "GET" && path.endsWith("/modules/")) {
      return json({ results: [...configuredModules, ...extraModules], next_cursor: null });
    }
    if (init.method === "POST" && path.endsWith("/work-items/")) {
      const body = requestBody as unknown as Omit<RemoteItem, "id" | "module_ids">;
      const item: RemoteItem = {
        id: `work-item-${items.length + 1}`,
        ...body,
        labels: body.labels ?? [],
        module_ids: [],
        updated_at: nextUpdatedAt(),
      };
      items.push(item);
      return options.malformedCreateResponse
        ? new Response("{not valid JSON", { status: 201, headers: { "content-type": "application/json" } })
        : json(item, 201);
    }
    if (init.method === "GET" && path.endsWith("/work-items/")) {
      return json({ results: items.map(responseItem), next_cursor: null });
    }
    const moduleMatch = /\/modules\/([^/]+)\/module-issues\/$/.exec(path);
    if (init.method === "GET" && moduleMatch) {
      const matchingItems = items.flatMap((item) =>
        Array.from({ length: item.module_ids.filter((moduleId) => moduleId === moduleMatch[1]).length }, () => responseItem(item)),
      );
      const pageSize = options.moduleIssuePageSize ?? Math.max(matchingItems.length, 1);
      const cursor = url.searchParams.get("cursor");
      const offset = cursor === null ? 0 : Number(cursor);
      if (!Number.isSafeInteger(offset) || offset < 0) return json({ detail: "invalid module cursor" }, 400);
      const nextOffset = offset + pageSize;
      return json({
        results: matchingItems.slice(offset, nextOffset),
        next_cursor: nextOffset < matchingItems.length ? String(nextOffset) : null,
        next_page_results: nextOffset < matchingItems.length,
      });
    }
    if (init.method === "POST" && moduleMatch) {
      if (failNextModuleAssociation) {
        failNextModuleAssociation = false;
        return json({ detail: "temporary association failure" }, 503);
      }
      const issues = requestBody?.issues;
      if (!Array.isArray(issues) || issues.length !== 1 || typeof issues[0] !== "string") {
        return json({ detail: "issues must be a one-item array" }, 400);
      }
      const itemId = issues[0];
      const item = items.find((candidate) => candidate.id === itemId);
      if (!item) return json({ detail: "missing item" }, 404);
      if (options.moduleMode === "additive") {
        if (!item.module_ids.includes(moduleMatch[1]!)) item.module_ids.push(moduleMatch[1]!);
      } else {
        item.module_ids = [moduleMatch[1]!];
      }
      moduleIssues.push({ moduleId: moduleMatch[1]!, itemId });
      if (applyThenFailModuleAssociation) {
        applyThenFailModuleAssociation = false;
        return json({ detail: "association applied but response failed" }, 503);
      }
      return options.bodylessModuleMutations ? new Response(null, { status: 204 }) : json({ id: `association-${itemId}` }, 201);
    }
    const moduleIssueMatch = /\/modules\/([^/]+)\/module-issues\/([^/]+)\/$/.exec(path);
    if (init.method === "DELETE" && moduleIssueMatch) {
      moduleDeleteAttempt += 1;
      const item = items.find((candidate) => candidate.id === moduleIssueMatch[2]);
      if (!item) return json({ detail: "missing item" }, 404);
      if (!item.module_ids.includes(moduleIssueMatch[1]!)) return json({ detail: "missing module membership" }, 404);
      if (moduleDeleteAttempt === options.failModuleDeleteAttempt) {
        return json({ detail: "temporary module deletion failure" }, 503);
      }
      item.module_ids = item.module_ids.filter((moduleId) => moduleId !== moduleIssueMatch[1]);
      moduleDeletes.push({ moduleId: moduleIssueMatch[1]!, itemId: moduleIssueMatch[2]! });
      if (moduleDeleteAttempt === options.notFoundModuleDeleteAttempt) {
        return json({ detail: "module membership was already absent" }, 404);
      }
      return new Response(null, { status: 204 });
    }
    const itemMatch = /\/work-items\/([^/]+)\/$/.exec(path);
    if (init.method === "PATCH" && itemMatch) {
      const item = items.find((candidate) => candidate.id === itemMatch[1]);
      if (!item) return json({ detail: "missing item" }, 404);
      const body = JSON.parse(String(init.body)) as Partial<RemoteItem>;
      Object.assign(item, body);
      item.updated_at = nextUpdatedAt();
      return json(item);
    }
    if (init.method === "GET" && itemMatch) {
      const item = items.find((candidate) => candidate.id === itemMatch[1]);
      return item ? json(responseItem(item)) : json({ detail: "missing item" }, 404);
    }
    const commentsMatch = /\/work-items\/([^/]+)\/comments\/$/.exec(path);
    if (commentsMatch && !items.some((candidate) => candidate.id === commentsMatch[1])) return json({ detail: "missing item" }, 404);
    if (init.method === "GET" && commentsMatch) {
      return url.searchParams.get("cursor") === null
        ? json({ results: comments.slice(0, 1), next_cursor: "comments-page-2" })
        : json({ results: comments.slice(1), next_cursor: null });
    }
    if (init.method === "POST" && commentsMatch) {
      const comment = { id: `comment-${comments.length + 1}`, ...(requestBody as Omit<RemoteComment, "id">) };
      comments.push(comment);
      return json(comment, 201);
    }
    return json({ detail: `unexpected ${init.method ?? "GET"} ${path}` }, 404);
  };
  return { fetchImpl, items, moduleIssues, moduleDeletes, comments, requests };
}

function paginatedVocabularyPlane(): typeof fetch {
  const states = [
    { id: "backlog-state", name: "Backlog" },
    { id: "todo-state", name: "Todo" },
    { id: "progress-state", name: "In Progress" },
    { id: "done-state", name: "Done" },
    { id: "cancelled-state", name: "Cancelled" },
  ];
  const modules = [
    { id: "product-module", name: "Product Confidence & Delivery" },
    { id: "analytics-module", name: "Analytics & Forecasting" },
    { id: "artists-module", name: "Artists, Releases & Rights" },
    { id: "directory-module", name: "Directory & Campaigns" },
    { id: "events-module", name: "Events, Tasks & Search" },
    { id: "assets-module", name: "Content, Assets & Budgets" },
  ];
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (init.method !== "GET" || new Headers(init.headers).get("x-api-key") !== "plane-test-token") return json({}, 401);
    const page = url.searchParams.get("cursor");
    if (url.pathname.endsWith("/states/")) return json({ results: states, next_cursor: null });
    if (url.pathname.endsWith("/modules/")) {
      return page === null
        ? json({ results: modules.slice(0, 3), next_cursor: "module-page-2", next_page_results: true })
        : json({ results: modules.slice(3), next_cursor: null, next_page_results: false });
    }
    if (url.pathname.endsWith("/labels/")) throw new Error("label route must remain unused");
    return json({ detail: "unexpected endpoint" }, 404);
  };
}

function vocabularyPlaneWithDuplicateState(): typeof fetch {
  const states = [
    { id: "backlog-state", name: "Backlog" },
    { id: "todo-state", name: "Todo" },
    { id: "another-todo-state", name: "Todo" },
    { id: "progress-state", name: "In Progress" },
    { id: "done-state", name: "Done" },
    { id: "cancelled-state", name: "Cancelled" },
  ];
  const modules = [
    { id: "product-module", name: "Product Confidence & Delivery" },
    { id: "analytics-module", name: "Analytics & Forecasting" },
    { id: "artists-module", name: "Artists, Releases & Rights" },
    { id: "directory-module", name: "Directory & Campaigns" },
    { id: "events-module", name: "Events, Tasks & Search" },
    { id: "assets-module", name: "Content, Assets & Budgets" },
  ];
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (init.method !== "GET") return json({}, 405);
    if (url.pathname.endsWith("/states/")) return json({ results: states, next_cursor: null });
    if (url.pathname.endsWith("/modules/")) return json({ results: modules, next_cursor: null });
    if (url.pathname.endsWith("/labels/")) throw new Error("label route must remain unused");
    return json({}, 404);
  };
}

function loopingCollectionsPlane(): typeof fetch {
  return async () => json({ results: [], next_cursor: "same-cursor" });
}

function issueSearchPlane(items: RemoteItem[]): typeof fetch {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (init.method !== "GET" || new Headers(init.headers).get("x-api-key") !== "plane-test-token") return json({}, 401);
    if (!url.pathname.endsWith("/work-items/")) return json({}, 404);
    return json({ results: items, next_cursor: null });
  };
}

function milestonePlane(): { fetchImpl: typeof fetch; comments: Array<Record<string, unknown>> } {
  const comments: Array<Record<string, unknown>> = [
    { id: "manual-comment", comment_html: "<p>Manual comment</p>", external_source: null, external_id: null },
    { id: "manual-comment-without-external-metadata", comment_html: "<p>Manual comment without bridge metadata</p>" },
    { id: "existing-milestone", comment_html: "<p>Previous milestone</p>", external_source: "label-suite-github-plane-sync", external_id: "github:old" },
  ];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (new Headers(init.headers).get("x-api-key") !== "plane-test-token") return json({}, 401);
    if (!/\/work-items\/work-item-128\/comments\/$/.test(url.pathname)) return json({}, 404);
    if (init.method === "GET") {
      return url.searchParams.get("cursor") === null
        ? json({ results: comments.slice(0, 2), next_cursor: "comments-page-2" })
        : json({ results: comments.slice(2), next_cursor: null });
    }
    if (init.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      comments.push({ id: `comment-${comments.length + 1}`, ...body });
      return json(comments.at(-1), 201);
    }
    return json({}, 405);
  };
  return { fetchImpl, comments };
}

describe("PlaneClient", () => {
  it("creates an escaped automatic item shell without coupling identity recovery to module convergence", async () => {
    const remote = statefulPlane();
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test/ignored-path"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: remote.fetchImpl,
    });

    const item = await client.createAutomaticItem({
      title: "Issue <img src=x onerror=alert(1)>",
      canonicalIssueUrl: "https://github.example.test/issues/129?title=<unsafe>",
      stateId: "todo-state",
      priority: "high",
    });

    expect(remote.items).toEqual([
      {
        id: "work-item-1",
        name: "Issue <img src=x onerror=alert(1)>",
        description_html:
          "<!-- plane-sync:source:start --><p><strong>GitHub issue:</strong> <a href=\"https://github.example.test/issues/129?title=&lt;unsafe&gt;\">Issue &lt;img src=x onerror=alert(1)&gt;</a></p><!-- plane-sync:source:end -->",
        state: "todo-state",
        priority: "high",
        labels: [],
        module_ids: [],
        updated_at: "2026-08-01T00:00:00.000Z",
      },
    ]);
    expect(remote.moduleIssues).toEqual([]);
    expect(item.moduleIds).toEqual([]);
    expect(remote.requests.find((request) => request.method === "POST" && request.path.endsWith("/work-items/"))?.body).toEqual({
      name: "Issue <img src=x onerror=alert(1)>",
      description_html:
        "<!-- plane-sync:source:start --><p><strong>GitHub issue:</strong> <a href=\"https://github.example.test/issues/129?title=&lt;unsafe&gt;\">Issue &lt;img src=x onerror=alert(1)&gt;</a></p><!-- plane-sync:source:end -->",
      state: "todo-state",
      priority: "high",
    });

    await client.createAutomaticItem({
      title: "A later GitHub title must not overwrite Plane",
      canonicalIssueUrl: "https://github.example.test/issues/129?title=<unsafe>",
      stateId: "done-state",
      priority: "low",
    });

    expect(remote.items).toHaveLength(1);
    expect(remote.items[0]).toMatchObject({
      name: "Issue <img src=x onerror=alert(1)>",
      description_html:
        "<!-- plane-sync:source:start --><p><strong>GitHub issue:</strong> <a href=\"https://github.example.test/issues/129?title=&lt;unsafe&gt;\">Issue &lt;img src=x onerror=alert(1)&gt;</a></p><!-- plane-sync:source:end -->",
      labels: [],
    });
  });

  it("replays a module association idempotently and converges it to exactly the requested module", async () => {
    const remote = statefulPlane(
      [
        {
          id: "work-item-128",
          name: "Existing item",
          description_html: "",
          state: "todo-state",
          priority: "none",
          labels: [],
          module_ids: ["product-module", "obsolete-module", "product-module"],
        },
      ],
      { bodylessModuleMutations: true },
    );
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: remote.fetchImpl,
    });

    await expect(client.setModule("work-item-128", "product-module")).resolves.toBe(true);
    await expect(client.setModule("work-item-128", "product-module")).resolves.toBe(false);

    expect(remote.items[0]?.module_ids).toEqual(["product-module"]);
    expect(remote.moduleIssues).toEqual([{ moduleId: "product-module", itemId: "work-item-128" }]);
  });

  it("uses one sequential all-project-module inventory to converge and clear legacy membership", async () => {
    const remote = statefulPlane(
      [
        {
          id: "work-item-128",
          name: "Existing item",
          description_html: "",
          state: "todo-state",
          priority: "none",
          labels: [],
          module_ids: ["legacy-module"],
        },
      ],
      {
        bodylessModuleMutations: true,
        extraModules: [{ id: "legacy-module", name: "Legacy roadmap" }],
        omitModuleIdsFromWorkItemResponses: true,
      },
    );
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: remote.fetchImpl,
    });

    const inventory = await client.loadModuleMembershipInventory();
    expect(inventory.hasAnyModule("work-item-128")).toBe(true);
    expect(inventory.hasExactlyOneModule("work-item-128", "product-module")).toBe(false);

    await expect(client.setModule("work-item-128", "product-module", undefined, inventory)).resolves.toBe(true);
    await expect(client.clearModule("work-item-128", undefined, inventory)).resolves.toBe(true);

    expect(remote.items[0]?.module_ids).toEqual([]);
    expect(remote.moduleDeletes).toEqual([
      { moduleId: "legacy-module", itemId: "work-item-128" },
      { moduleId: "product-module", itemId: "work-item-128" },
    ]);
    const inventoryRequests = remote.requests.filter((request) => request.method === "GET" &&
      (request.path.endsWith("/states/") || request.path.endsWith("/modules/") || /\/modules\/[^/]+\/module-issues\/$/.test(request.path)));
    expect(inventoryRequests).toHaveLength(9);
    expect(inventoryRequests.map((request) => request.path)).toEqual([
      "/api/v1/workspaces/label-suite/projects/project-id/states/",
      "/api/v1/workspaces/label-suite/projects/project-id/modules/",
      "/api/v1/workspaces/label-suite/projects/project-id/modules/product-module/module-issues/",
      "/api/v1/workspaces/label-suite/projects/project-id/modules/analytics-module/module-issues/",
      "/api/v1/workspaces/label-suite/projects/project-id/modules/artists-module/module-issues/",
      "/api/v1/workspaces/label-suite/projects/project-id/modules/directory-module/module-issues/",
      "/api/v1/workspaces/label-suite/projects/project-id/modules/events-module/module-issues/",
      "/api/v1/workspaces/label-suite/projects/project-id/modules/assets-module/module-issues/",
      "/api/v1/workspaces/label-suite/projects/project-id/modules/legacy-module/module-issues/",
    ]);
  });

  it("discovers and verifies paginated module membership when work-item responses omit module ids", async () => {
    const remote = statefulPlane(
      [
        {
          id: "work-item-before-target",
          name: "Another item",
          description_html: "",
          state: "todo-state",
          priority: "none",
          labels: [],
          module_ids: ["analytics-module"],
        },
        {
          id: "work-item-128",
          name: "Existing item",
          description_html: "",
          state: "todo-state",
          priority: "none",
          labels: [],
          module_ids: ["analytics-module"],
        },
      ],
      {
        bodylessModuleMutations: true,
        moduleIssuePageSize: 1,
        moduleMode: "additive",
        omitModuleIdsFromWorkItemResponses: true,
      },
    );
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: remote.fetchImpl,
    });

    await expect(client.getWorkItem("work-item-128")).resolves.toMatchObject({ moduleIds: [] });
    await expect(client.setModule("work-item-128", "product-module")).resolves.toBe(true);
    await expect(client.setModule("work-item-128", "product-module")).resolves.toBe(false);

    expect(remote.items.find((item) => item.id === "work-item-128")?.module_ids).toEqual(["product-module"]);
    expect(remote.moduleDeletes).toEqual([{ moduleId: "analytics-module", itemId: "work-item-128" }]);
    expect(remote.moduleIssues).toEqual([{ moduleId: "product-module", itemId: "work-item-128" }]);
    const queriedModuleIssuePaths = new Set(
      remote.requests
        .filter((request) => request.method === "GET" && /\/modules\/[^/]+\/module-issues\/$/.test(request.path))
        .map((request) => request.path),
    );
    expect(queriedModuleIssuePaths).toHaveLength(6);
  });

  it("clears discovered paginated memberships when work-item responses omit module ids", async () => {
    const remote = statefulPlane(
      [
        {
          id: "work-item-before-target",
          name: "Another item",
          description_html: "",
          state: "todo-state",
          priority: "none",
          labels: [],
          module_ids: ["analytics-module"],
        },
        {
          id: "work-item-128",
          name: "Existing item",
          description_html: "",
          state: "todo-state",
          priority: "none",
          labels: [],
          module_ids: ["analytics-module", "directory-module"],
        },
      ],
      {
        bodylessModuleMutations: true,
        moduleIssuePageSize: 1,
        omitModuleIdsFromWorkItemResponses: true,
      },
    );
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: remote.fetchImpl,
    });

    await expect(client.getWorkItem("work-item-128")).resolves.toMatchObject({ moduleIds: [] });
    await expect(client.clearModule("work-item-128")).resolves.toBe(true);
    await expect(client.clearModule("work-item-128")).resolves.toBe(false);

    expect(remote.items.find((item) => item.id === "work-item-128")?.module_ids).toEqual([]);
    expect(remote.moduleDeletes).toEqual([
      { moduleId: "analytics-module", itemId: "work-item-128" },
      { moduleId: "directory-module", itemId: "work-item-128" },
    ]);
  });

  it("fails closed when a configured module membership collection repeats its cursor", async () => {
    const remote = statefulPlane([
      {
        id: "work-item-128",
        name: "Existing item",
        description_html: "",
        state: "todo-state",
        priority: "none",
        labels: [],
        module_ids: [],
      },
    ]);
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      if (init.method === "GET" && url.pathname.endsWith("/modules/product-module/module-issues/")) {
        return json({ results: [], next_cursor: "repeated-cursor", next_page_results: true });
      }
      return remote.fetchImpl(input, init);
    };
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl,
    });

    await expect(client.clearModule("work-item-128")).rejects.toMatchObject({ code: "plane_pagination_loop" });
    expect(remote.moduleDeletes).toEqual([]);
  });

  it("reports no module mutation when a stale read is already converged before any successful write", async () => {
    const remote = statefulPlane([
      {
        id: "work-item-128",
        name: "Existing item",
        description_html: "",
        state: "todo-state",
        priority: "none",
        labels: [],
        module_ids: ["obsolete-module"],
      },
    ], { bodylessModuleMutations: true });
    let workItemReads = 0;
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const response = await remote.fetchImpl(input, init);
      if (init.method === "GET" && url.pathname.endsWith("/work-items/work-item-128/") && workItemReads++ === 0) {
        remote.items[0]!.module_ids = ["product-module"];
      }
      return response;
    };
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl,
    });

    await expect(client.setModule("work-item-128", "product-module")).resolves.toBe(false);
    expect(remote.items[0]?.module_ids).toEqual(["product-module"]);
    expect(remote.moduleDeletes).toEqual([]);
    expect(remote.moduleIssues).toEqual([]);
  });

  it("reports no module mutation when a concurrent actor clears memberships before clearModule reads them", async () => {
    const remote = statefulPlane([
      {
        id: "work-item-128",
        name: "Existing item",
        description_html: "",
        state: "todo-state",
        priority: "none",
        labels: [],
        module_ids: ["obsolete-module"],
      },
    ], { bodylessModuleMutations: true });
    let raced = false;
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      if (!raced && init.method === "GET" && url.pathname.endsWith("/work-items/work-item-128/")) {
        raced = true;
        remote.items[0]!.module_ids = [];
      }
      return remote.fetchImpl(input, init);
    };
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl,
    });

    await expect(client.clearModule("work-item-128")).resolves.toBe(false);
    expect(remote.items[0]?.module_ids).toEqual([]);
    expect(remote.moduleDeletes).toEqual([]);
  });

  for (const moduleMode of ["move", "additive"] as const) {
    it(`clears every module membership idempotently in ${moduleMode} mode`, async () => {
      const remote = statefulPlane(
        [
          {
            id: "work-item-128",
            name: "Existing item",
            description_html: "<p>Manual roadmap prose</p>",
            state: "todo-state",
            priority: "none",
            labels: ["manual-label"],
            module_ids: ["analytics-module", "obsolete-module", "analytics-module"],
          },
        ],
        { moduleMode, bodylessModuleMutations: true },
      );
      const client = new PlaneClient({
        baseUrl: new URL("https://plane.example.test"),
        apiToken: "plane-test-token",
        workspace: "label-suite",
        projectId: "project-id",
        fetchImpl: remote.fetchImpl,
      });

      await expect(client.clearModule("work-item-128")).resolves.toBe(true);
      await expect(client.clearModule("work-item-128")).resolves.toBe(false);

      expect(remote.items[0]).toMatchObject({
        name: "Existing item",
        description_html: "<p>Manual roadmap prose</p>",
        labels: ["manual-label"],
        module_ids: [],
      });
      expect(remote.moduleDeletes).toEqual([
        { moduleId: "analytics-module", itemId: "work-item-128" },
        { moduleId: "obsolete-module", itemId: "work-item-128" },
      ]);
    });
  }

  it("retries clearModule from the remaining memberships after a transient DELETE failure", async () => {
    const remote = statefulPlane(
      [
        {
          id: "work-item-128",
          name: "Existing item",
          description_html: "<p>Manual roadmap prose</p>",
          state: "todo-state",
          priority: "none",
          labels: ["manual-label"],
          module_ids: ["obsolete-one", "obsolete-two"],
        },
      ],
      { failModuleDeleteAttempt: 2, bodylessModuleMutations: true },
    );
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: remote.fetchImpl,
    });

    await expect(client.clearModule("work-item-128")).rejects.toBeInstanceOf(RetryableSyncError);
    expect(remote.items[0]?.module_ids).toEqual(["obsolete-two"]);

    await client.clearModule("work-item-128");
    await client.clearModule("work-item-128");

    expect(remote.items[0]).toMatchObject({
      description_html: "<p>Manual roadmap prose</p>",
      labels: ["manual-label"],
      module_ids: [],
    });
    expect(remote.moduleDeletes).toEqual([
      { moduleId: "obsolete-one", itemId: "work-item-128" },
      { moduleId: "obsolete-two", itemId: "work-item-128" },
    ]);
  });

  it("notifies each confirmed membership write before a later module request fails", async () => {
    const remote = statefulPlane(
      [
        {
          id: "work-item-128",
          name: "Existing item",
          description_html: "",
          state: "todo-state",
          priority: "none",
          labels: [],
          module_ids: ["obsolete-one", "obsolete-two"],
        },
      ],
      { failModuleDeleteAttempt: 2, bodylessModuleMutations: true },
    );
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: remote.fetchImpl,
    });
    const writes = vi.fn();

    await expect(client.setModule("work-item-128", "product-module", writes)).rejects.toBeInstanceOf(RetryableSyncError);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(remote.items[0]?.module_ids).toEqual(["obsolete-two"]);

    await expect(client.setModule("work-item-128", "product-module", writes)).resolves.toBe(true);
    await expect(client.setModule("work-item-128", "product-module", writes)).resolves.toBe(false);
    expect(writes).toHaveBeenCalledTimes(3);
  });

  it("retains only confirmed write notifications when Plane applies a POST but responds 503", async () => {
    const remote = statefulPlane(
      [
        {
          id: "work-item-128",
          name: "Existing item",
          description_html: "",
          state: "todo-state",
          priority: "none",
          labels: [],
          module_ids: ["obsolete-module"],
        },
      ],
      { applyThenFailModuleAssociation: true, bodylessModuleMutations: true },
    );
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: remote.fetchImpl,
    });
    const writes = vi.fn();

    await expect(client.setModule("work-item-128", "product-module", writes)).rejects.toBeInstanceOf(RetryableSyncError);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(remote.items[0]?.module_ids).toEqual(["product-module"]);

    await expect(client.setModule("work-item-128", "product-module", writes)).resolves.toBe(false);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it("notifies a confirmed DELETE before later module verification fails", async () => {
    const remote = statefulPlane([
      {
        id: "work-item-128",
        name: "Existing item",
        description_html: "",
        state: "todo-state",
        priority: "none",
        labels: [],
        module_ids: ["obsolete-module"],
      },
    ], { bodylessModuleMutations: true });
    let moduleMembershipReads = 0;
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      if (init.method === "GET" && /\/modules\/[^/]+\/module-issues\/$/.test(url.pathname) && moduleMembershipReads++ === 6) {
        return json({ detail: "temporary verification failure" }, 503);
      }
      return remote.fetchImpl(input, init);
    };
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl,
    });
    const writes = vi.fn();

    await expect(client.setModule("work-item-128", "product-module", writes)).rejects.toBeInstanceOf(RetryableSyncError);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(remote.items[0]?.module_ids).toEqual([]);

    await expect(client.setModule("work-item-128", "product-module", writes)).resolves.toBe(true);
    await expect(client.setModule("work-item-128", "product-module", writes)).resolves.toBe(false);
    expect(writes).toHaveBeenCalledTimes(2);
  });

  it("does not notify for module no-ops, 404 replays, or writes that fail before success", async () => {
    const writes = vi.fn();
    const replay = statefulPlane([
      {
        id: "work-item-128",
        name: "Existing item",
        description_html: "",
        state: "todo-state",
        priority: "none",
        labels: [],
        module_ids: ["obsolete-module"],
      },
    ], { notFoundModuleDeleteAttempt: 1, bodylessModuleMutations: true });
    const replayClient = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: replay.fetchImpl,
    });
    const failure = statefulPlane([
      {
        id: "work-item-128",
        name: "Existing item",
        description_html: "",
        state: "todo-state",
        priority: "none",
        labels: [],
        module_ids: ["obsolete-module"],
      },
    ], { failModuleDeleteAttempt: 1, bodylessModuleMutations: true });
    const failureClient = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: failure.fetchImpl,
    });

    await expect(replayClient.clearModule("work-item-128", writes)).resolves.toBe(false);
    await expect(replayClient.clearModule("work-item-128", writes)).resolves.toBe(false);
    await expect(failureClient.clearModule("work-item-128", writes)).rejects.toBeInstanceOf(RetryableSyncError);
    expect(writes).not.toHaveBeenCalled();
  });

  it("swallows 404 only for an exact clearModule membership DELETE", async () => {
    const remote = statefulPlane(
      [
        {
          id: "work-item-128",
          name: "Existing item",
          description_html: "",
          state: "todo-state",
          priority: "none",
          labels: [],
          module_ids: ["obsolete-module"],
        },
      ],
      { notFoundModuleDeleteAttempt: 1, bodylessModuleMutations: true },
    );
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: remote.fetchImpl,
    });

    await expect(client.clearModule("work-item-128")).resolves.toBe(false);
    expect(remote.items[0]?.module_ids).toEqual([]);
    expect(remote.moduleDeletes).toEqual([{ moduleId: "obsolete-module", itemId: "work-item-128" }]);

    await expect(client.clearModule("missing-work-item")).rejects.toMatchObject({ code: "plane_request_rejected" });
  });

  it("converges an additive module server by removing obsolete membership before associating the desired module", async () => {
    const remote = statefulPlane(
      [
        {
          id: "work-item-128",
          name: "Existing item",
          description_html: "",
          state: "todo-state",
          priority: "none",
          labels: [],
          module_ids: ["obsolete-module"],
        },
      ],
      { moduleMode: "additive", bodylessModuleMutations: true },
    );
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: remote.fetchImpl,
    });

    await client.setModule("work-item-128", "product-module");
    await client.setModule("work-item-128", "product-module");

    expect(remote.items[0]?.module_ids).toEqual(["product-module"]);
    expect(remote.moduleIssues).toEqual([{ moduleId: "product-module", itemId: "work-item-128" }]);
  });

  it("repairs duplicate desired and obsolete memberships on an additive module server", async () => {
    const remote = statefulPlane(
      [
        {
          id: "work-item-128",
          name: "Existing item",
          description_html: "",
          state: "todo-state",
          priority: "none",
          labels: [],
          module_ids: ["product-module", "obsolete-module", "product-module"],
        },
      ],
      { moduleMode: "additive", bodylessModuleMutations: true },
    );
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: remote.fetchImpl,
    });

    await client.setModule("work-item-128", "product-module");
    await client.setModule("work-item-128", "product-module");

    expect(remote.items[0]?.module_ids).toEqual(["product-module"]);
    expect(remote.moduleIssues).toEqual([{ moduleId: "product-module", itemId: "work-item-128" }]);
  });

  for (const moduleMode of ["move", "additive"] as const) {
    it(`retries from the remaining subset after a transient DELETE failure in ${moduleMode} mode`, async () => {
      const remote = statefulPlane(
        [
          {
            id: "work-item-128",
            name: "Existing item",
            description_html: "",
            state: "todo-state",
            priority: "none",
            labels: [],
            module_ids: ["obsolete-one", "obsolete-two"],
          },
        ],
        { moduleMode, failModuleDeleteAttempt: 2, bodylessModuleMutations: true },
      );
      const client = new PlaneClient({
        baseUrl: new URL("https://plane.example.test"),
        apiToken: "plane-test-token",
        workspace: "label-suite",
        projectId: "project-id",
        fetchImpl: remote.fetchImpl,
      });

      await expect(client.setModule("work-item-128", "product-module")).rejects.toBeInstanceOf(RetryableSyncError);
      expect(remote.items[0]?.module_ids).toEqual(["obsolete-two"]);

      await client.setModule("work-item-128", "product-module");
      await client.setModule("work-item-128", "product-module");

      expect(remote.items[0]?.module_ids).toEqual(["product-module"]);
      expect(remote.moduleDeletes).toEqual([
        { moduleId: "obsolete-one", itemId: "work-item-128" },
        { moduleId: "obsolete-two", itemId: "work-item-128" },
      ]);
      expect(remote.moduleIssues).toEqual([{ moduleId: "product-module", itemId: "work-item-128" }]);
    });

    it(`retries after cleanup when POST transiently fails in ${moduleMode} mode`, async () => {
      const remote = statefulPlane(
        [
          {
            id: "work-item-128",
            name: "Existing item",
            description_html: "",
            state: "todo-state",
            priority: "none",
            labels: [],
            module_ids: ["obsolete-module"],
          },
        ],
        { moduleMode, failNextModuleAssociation: true, bodylessModuleMutations: true },
      );
      const client = new PlaneClient({
        baseUrl: new URL("https://plane.example.test"),
        apiToken: "plane-test-token",
        workspace: "label-suite",
        projectId: "project-id",
        fetchImpl: remote.fetchImpl,
      });

      await expect(client.setModule("work-item-128", "product-module")).rejects.toBeInstanceOf(RetryableSyncError);
      expect(remote.items[0]?.module_ids).toEqual([]);

      await client.setModule("work-item-128", "product-module");
      await client.setModule("work-item-128", "product-module");

      expect(remote.items[0]?.module_ids).toEqual(["product-module"]);
      expect(remote.moduleDeletes).toEqual([{ moduleId: "obsolete-module", itemId: "work-item-128" }]);
      expect(remote.moduleIssues).toEqual([{ moduleId: "product-module", itemId: "work-item-128" }]);
    });

    it(`treats an exact membership DELETE 404 as an idempotent replay in ${moduleMode} mode`, async () => {
      const remote = statefulPlane(
        [
          {
            id: "work-item-128",
            name: "Existing item",
            description_html: "",
            state: "todo-state",
            priority: "none",
            labels: [],
            module_ids: ["obsolete-module", "product-module"],
          },
        ],
        { moduleMode, notFoundModuleDeleteAttempt: 1, bodylessModuleMutations: true },
      );
      const client = new PlaneClient({
        baseUrl: new URL("https://plane.example.test"),
        apiToken: "plane-test-token",
        workspace: "label-suite",
        projectId: "project-id",
        fetchImpl: remote.fetchImpl,
      });

      await client.setModule("work-item-128", "product-module");
      await client.setModule("work-item-128", "product-module");

      expect(remote.items[0]?.module_ids).toEqual(["product-module"]);
      expect(remote.moduleDeletes).toEqual([{ moduleId: "obsolete-module", itemId: "work-item-128" }]);
      expect(remote.moduleIssues).toEqual([]);
    });
  }

  it("recovers a successful automatic creation when Plane returns a malformed success body", async () => {
    const remote = statefulPlane([], { malformedCreateResponse: true });
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: remote.fetchImpl,
    });

    const created = await client.createAutomaticItem({
      title: "Malformed body recovery",
      canonicalIssueUrl: "https://github.example.test/issues/129",
      stateId: "todo-state",
      priority: "none",
    });

    expect(remote.items).toHaveLength(1);
    expect(created.id).toBe(remote.items[0]?.id);
  });

  it("rejects a non-HTTPS canonical source before it can become an HTML link", async () => {
    const remote = statefulPlane();
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: remote.fetchImpl,
    });

    await expect(
      client.createAutomaticItem({
        title: "Unsafe source",
        canonicalIssueUrl: "javascript:alert(1)",
        stateId: "todo-state",
        priority: "none",
      }),
    ).rejects.toMatchObject({ code: "plane_canonical_issue_url_invalid" });
    expect(remote.items).toEqual([]);
  });

  it("resolves the exact required vocabulary across bounded Plane collection pages", async () => {
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test/not-a-route"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: paginatedVocabularyPlane(),
    });

    await expect(client.resolveVocabulary()).resolves.toEqual({
      states: {
        Backlog: "backlog-state",
        Todo: "todo-state",
        "In Progress": "progress-state",
        Done: "done-state",
        Cancelled: "cancelled-state",
      },
      modules: {
        "Product Confidence & Delivery": "product-module",
        "Analytics & Forecasting": "analytics-module",
        "Artists, Releases & Rights": "artists-module",
        "Directory & Campaigns": "directory-module",
        "Events, Tasks & Search": "events-module",
        "Content, Assets & Budgets": "assets-module",
      },
    });
  });

  it("stops Plane work-item pagination when next_page_results is false despite a stale cursor", async () => {
    const requests: URL[] = [];
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        requests.push(url);
        return url.searchParams.has("cursor")
          ? json({ results: [], next_cursor: null, next_page_results: false })
          : json({
              results: [{
                id: "health-item",
                name: "[System] GitHub to Plane sync health",
                description_html: "",
                state: "todo-state",
                priority: "none",
                labels: [],
                module_ids: [],
              }],
              next_cursor: "stale-cursor",
              next_page_results: false,
            });
      },
    });

    await expect(client.findHealthItems()).resolves.toMatchObject([{ id: "health-item" }]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.searchParams.get("cursor")).toBeNull();
  });

  it("fails closed when required Plane vocabulary names are duplicated", async () => {
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: vocabularyPlaneWithDuplicateState(),
    });

    await expect(client.resolveVocabulary()).rejects.toMatchObject({ code: "plane_vocabulary_duplicate" });
  });

  it("refuses a repeated pagination cursor instead of following an unbounded Plane collection", async () => {
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: loopingCollectionsPlane(),
    });

    await expect(client.resolveVocabulary()).rejects.toMatchObject({ code: "plane_pagination_loop" });
  });

  it("finds only items whose source anchor has the exact canonical GitHub issue URL", async () => {
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: issueSearchPlane([
        {
          id: "exact-item",
          name: "Exact source",
          description_html:
            "<p>Manual content</p><!-- plane-sync:source:start --><a href=\"https://github.example.test/issues/128\">source</a><!-- plane-sync:source:end -->",
          state: "todo-state",
          priority: "none",
          labels: [],
          module_ids: [],
        },
        {
          id: "near-item",
          name: "Near source",
          description_html: "<p>Manual content <a href=\"https://github.example.test/issues/128\">must not become a mapping</a></p>",
          state: "todo-state",
          priority: "none",
          labels: [],
          module_ids: [],
        },
        {
          id: "data-href-item",
          name: "Data href source",
          description_html:
            "<!-- plane-sync:source:start --><a data-href=\"https://github.example.test/issues/128\">not an anchor href</a><!-- plane-sync:source:end -->",
          state: "todo-state",
          priority: "none",
          labels: [],
          module_ids: [],
        },
        {
          id: "different-item",
          name: "Different source",
          description_html: "<a href=\"https://github.example.test/issues/128?duplicate=true\">source</a>",
          state: "todo-state",
          priority: "none",
          labels: [],
          module_ids: [],
        },
      ]),
    });

    await expect(client.findItemsByCanonicalIssueUrl("https://github.example.test/issues/128")).resolves.toMatchObject([
      { id: "exact-item" },
    ]);
  });

  it("fails closed when more than one bounded source section maps the same canonical issue", async () => {
    const source =
      "<!-- plane-sync:source:start --><a href=\"https://github.example.test/issues/128\">source</a><!-- plane-sync:source:end -->";
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: issueSearchPlane([
        { id: "first", name: "First", description_html: source, state: "todo-state", priority: "none", labels: [], module_ids: [] },
        { id: "second", name: "Second", description_html: source, state: "todo-state", priority: "none", labels: [], module_ids: [] },
      ]),
    });

    await expect(client.findItemsByCanonicalIssueUrl("https://github.example.test/issues/128")).rejects.toMatchObject({
      code: "plane_mapping_ambiguous",
    });
  });

  it("tokenizes only well-formed anchor attributes inside the bounded source section", async () => {
    const quotedTitleUrl = "https://github.example.test/issues/128";
    const mixedOrderUrl = "https://github.example.test/issues/129";
    const malformedUrl = "https://github.example.test/issues/130";
    const source = (anchor: string) => `<!-- plane-sync:source:start -->${anchor}<!-- plane-sync:source:end -->`;
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: issueSearchPlane([
        {
          id: "quoted-title",
          name: "Quoted title attribute",
          description_html: source(`<a HREF="${quotedTitleUrl}" title='manual text href="https://example.test/not-a-source"'>source</a>`),
          state: "todo-state",
          priority: "none",
          labels: [],
          module_ids: [],
        },
        {
          id: "mixed-order",
          name: "Mixed quote order",
          description_html: source(`<a data-kind='canonical' HREF=${mixedOrderUrl} aria-label="Source">source</a>`),
          state: "todo-state",
          priority: "none",
          labels: [],
          module_ids: [],
        },
        {
          id: "malformed-tag",
          name: "Malformed tag",
          description_html: source(`<a href=${malformedUrl} title='unterminated>source</a>`),
          state: "todo-state",
          priority: "none",
          labels: [],
          module_ids: [],
        },
      ]),
    });

    await expect(client.findItemsByCanonicalIssueUrl(quotedTitleUrl)).resolves.toMatchObject([{ id: "quoted-title" }]);
    await expect(client.findItemsByCanonicalIssueUrl(mixedOrderUrl)).resolves.toMatchObject([{ id: "mixed-order" }]);
    await expect(client.findItemsByCanonicalIssueUrl(malformedUrl)).resolves.toEqual([]);
  });

  it("records milestone identity in Plane comments and recovers existing identities across pages", async () => {
    const remote = milestonePlane();
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: remote.fetchImpl,
    });

    await client.addMilestone("work-item-128", {
      html: "<p>Pull request became ready for review</p>",
      externalSource: "label-suite-github-plane-sync",
      externalId: "github:delivery-129:ready_for_review:work-item-128",
    });

    await expect(client.listMilestoneExternalIds("work-item-128")).resolves.toEqual(
      new Set(["github:old", "github:delivery-129:ready_for_review:work-item-128"]),
    );
    expect(remote.comments.at(-1)).toEqual({
      id: "comment-4",
      comment_html: "<p>Pull request became ready for review</p>",
      external_source: "label-suite-github-plane-sync",
      external_id: "github:delivery-129:ready_for_review:work-item-128",
    });
  });

  it("adds one projection comment per deterministic projection hash while preserving manual comments and item prose", async () => {
    const remote = statefulPlane([
      {
        id: "work-item-128",
        name: "Curated roadmap title",
        description_html: "<p>Manual owner narrative</p>",
        state: "todo-state",
        priority: "none",
        labels: ["manual-label"],
        module_ids: ["product-module"],
      },
    ]);
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: remote.fetchImpl,
    });

    await client.addProjectionComment("work-item-128", {
      html: "<p>Ready for review</p>",
      externalId: "projection:work-item-128:hash-a",
    });
    await client.addProjectionComment("work-item-128", {
      html: "<p>Ready for review</p>",
      externalId: "projection:work-item-128:hash-a",
    });
    await client.addProjectionComment("work-item-128", {
      html: "<p>Blocked by review</p>",
      externalId: "projection:work-item-128:hash-b",
    });

    expect(remote.comments).toEqual([
      { id: "manual-comment", comment_html: "<p>Manual note</p>" },
      { id: "manual-comment-null-metadata", comment_html: "<p>Manual note two</p>", external_source: null, external_id: null },
      {
        id: "comment-3",
        comment_html: "<p>Ready for review</p>",
        external_source: "label-suite-github-plane-sync",
        external_id: "projection:work-item-128:hash-a",
      },
      {
        id: "comment-4",
        comment_html: "<p>Blocked by review</p>",
        external_source: "label-suite-github-plane-sync",
        external_id: "projection:work-item-128:hash-b",
      },
    ]);
    expect(remote.items[0]).toMatchObject({
      name: "Curated roadmap title",
      description_html: "<p>Manual owner narrative</p>",
      labels: ["manual-label"],
    });
    expect(remote.requests.filter((request) => request.method === "PATCH")).toEqual([]);
  });

  it("upserts health comments idempotently and creates a distinct comment for changed health", async () => {
    const remote = statefulPlane([
      {
        id: "health-item",
        name: "[System] GitHub to Plane sync health",
        description_html: "<p>Manual escalation owner</p>",
        state: "todo-state",
        priority: "none",
        labels: ["manual-health-label"],
        module_ids: [],
      },
    ]);
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: remote.fetchImpl,
    });

    await client.upsertHealthComment("health-item", { html: "<p>Status: ok</p>", externalId: "health:hash-a" });
    await client.upsertHealthComment("health-item", { html: "<p>Status: ok</p>", externalId: "health:hash-a" });
    await client.upsertHealthComment("health-item", { html: "<p>Status: degraded</p>", externalId: "health:hash-b" });

    expect(remote.comments.filter((comment) => comment.external_source === "label-suite-github-plane-sync")).toEqual([
      { id: "comment-3", comment_html: "<p>Status: ok</p>", external_source: "label-suite-github-plane-sync", external_id: "health:hash-a" },
      { id: "comment-4", comment_html: "<p>Status: degraded</p>", external_source: "label-suite-github-plane-sync", external_id: "health:hash-b" },
    ]);
    expect(remote.items[0]).toMatchObject({
      description_html: "<p>Manual escalation owner</p>",
      labels: ["manual-health-label"],
    });
    expect(remote.requests.filter((request) => request.method === "PATCH")).toEqual([]);
  });

  it("creates one health item shell without labels so bootstrap can persist its identity before module convergence", async () => {
    const remote = statefulPlane();
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: remote.fetchImpl,
    });

    const healthItem = await client.createHealthItem({
      stateId: "todo-state",
    });

    expect(remote.items).toEqual([
      {
        id: "work-item-1",
        name: "[System] GitHub to Plane sync health",
        state: "todo-state",
        priority: "none",
        labels: [],
        module_ids: [],
        updated_at: "2026-08-01T00:00:00.000Z",
      },
    ]);
    expect(remote.moduleIssues).toEqual([]);
    expect(remote.requests.some((request) => request.path.endsWith("/labels/"))).toBe(false);
    expect(remote.requests.find((request) => request.method === "POST" && request.path.endsWith("/work-items/"))?.body).toEqual({
      name: "[System] GitHub to Plane sync health",
      state: "todo-state",
      priority: "none",
    });
    await expect(client.findHealthItems()).resolves.toMatchObject([{ id: healthItem.id }]);
  });

  it("classifies Plane failures without retaining response bodies or concrete route values", async () => {
    const failureClient = (status: number) =>
      new PlaneClient({
        baseUrl: new URL("https://plane.example.test"),
        apiToken: "plane-test-token",
        workspace: "label-suite",
        projectId: "project-id",
        fetchImpl: async () => json({ detail: "authorization=plane-test-token raw body must never escape" }, status),
        sleep: async () => undefined,
      });

    const rateLimited = await failureClient(429).getWorkItem("work-item-128").catch((error: unknown) => error);
    const unavailable = await failureClient(503).getWorkItem("work-item-128").catch((error: unknown) => error);
    const rejected = await failureClient(422).getWorkItem("work-item-128").catch((error: unknown) => error);

    expect(rateLimited).toBeInstanceOf(RetryableSyncError);
    expect(unavailable).toBeInstanceOf(RetryableSyncError);
    expect(rejected).toBeInstanceOf(PermanentSyncError);
    for (const error of [rateLimited, unavailable, rejected]) {
      expect(String(error)).toContain("method=GET");
      expect(String(error)).toContain("route=/api/v1/workspaces/{workspace}/projects/{project}/work-items/{workItemId}/");
      expect(String(error)).toMatch(/status=(429|503|422)/);
      expect(String(error)).not.toContain("plane-test-token");
      expect(String(error)).not.toContain("raw body");
      expect(String(error)).not.toContain("project-id");
      expect(String(error)).not.toContain("work-item-128");
    }
  });

  it("retries a rate-limited Plane request after its Retry-After delay", async () => {
    const waits: number[] = [];
    let attempts = 0;
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) return json({ detail: "rate limited" }, 429, { "retry-after": "4" });
        return json({
          id: "work-item-128",
          name: "Recovered item",
          description_html: "",
          state: "todo-state",
          priority: "none",
          labels: [],
          module_ids: [],
        });
      },
      sleep: async (delayMs) => { waits.push(delayMs); },
    });

    await expect(client.getWorkItem("work-item-128")).resolves.toMatchObject({ id: "work-item-128" });
    expect(attempts).toBe(2);
    expect(waits).toEqual([4_000]);
  });

  it("waits the full observed 30-second Retry-After window before retrying a Plane GET", async () => {
    const waits: number[] = [];
    let attempts = 0;
    let elapsedMs = 0;
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: async () => {
        attempts += 1;
        if (elapsedMs < 30_000) return json({ detail: "rate limited" }, 429, { "Retry-After": "30" });
        return json({
          id: "work-item-128",
          name: "Recovered item",
          description_html: "",
          state: "todo-state",
          priority: "none",
          labels: [],
          module_ids: [],
        });
      },
      sleep: async (delayMs) => {
        waits.push(delayMs);
        elapsedMs += delayMs;
      },
      now: () => elapsedMs,
    });

    await expect(client.getWorkItem("work-item-128")).resolves.toMatchObject({ id: "work-item-128" });
    expect(attempts).toBe(2);
    expect(waits).toEqual([30_000]);
  });

  it("retries a rate-limited Plane POST after its Retry-After delay", async () => {
    const waits: number[] = [];
    let postAttempts = 0;
    let successfulPosts = 0;
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: async (_input, init) => {
        expect(init?.method).toBe("POST");
        postAttempts += 1;
        if (postAttempts === 1) return json({ detail: "rate limited" }, 429, { "retry-after": "30" });
        successfulPosts += 1;
        return new Response(null, { status: 204 });
      },
      sleep: async (delayMs) => { waits.push(delayMs); },
    });

    await expect(client.addMilestone("work-item-128", {
      html: "<p>Milestone</p>",
      externalSource: "label-suite-github-plane-sync",
      externalId: "github:rate-limited-post",
    })).resolves.toBeUndefined();

    expect(postAttempts).toBe(2);
    expect(successfulPosts).toBe(1);
    expect(waits).toEqual([30_000]);
  });

  it("retries a rate-limited Plane DELETE after its Retry-After delay", async () => {
    const waits: number[] = [];
    let deleteAttempts = 0;
    let successfulDeletes = 0;
    const inventory = new PlaneModuleMembershipInventory(
      {
        states: {
          Backlog: "backlog-state",
          Todo: "todo-state",
          "In Progress": "progress-state",
          Done: "done-state",
          Cancelled: "cancelled-state",
        },
        modules: {
          "Product Confidence & Delivery": "product-module",
          "Analytics & Forecasting": "analytics-module",
          "Artists, Releases & Rights": "artists-module",
          "Directory & Campaigns": "directory-module",
          "Events, Tasks & Search": "events-module",
          "Content, Assets & Budgets": "assets-module",
        },
      },
      new Map([["product-module", ["work-item-128"]]]),
    );
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: async (_input, init) => {
        expect(init?.method).toBe("DELETE");
        deleteAttempts += 1;
        if (deleteAttempts === 1) return json({ detail: "rate limited" }, 429, { "retry-after": "4" });
        successfulDeletes += 1;
        return new Response(null, { status: 204 });
      },
      sleep: async (delayMs) => { waits.push(delayMs); },
    });

    await expect(client.clearModule("work-item-128", undefined, inventory)).resolves.toBe(true);

    expect(deleteAttempts).toBe(2);
    expect(successfulDeletes).toBe(1);
    expect(waits).toEqual([4_000]);
    expect(inventory.hasAnyModule("work-item-128")).toBe(false);
  });

  it("cancels a retried 429 POST response body before sleeping", async () => {
    const events: string[] = [];
    let attempts = 0;
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          const body = new ReadableStream<Uint8Array>({
            cancel() {
              events.push("cancel");
              throw new Error("response cleanup detail must never escape");
            },
          });
          return new Response(body, { status: 429, headers: { "retry-after": "4" } });
        }
        return json({
          id: "work-item-128",
          name: "Recovered item",
          description_html: "",
          state: "todo-state",
          priority: "none",
          labels: [],
          module_ids: [],
        });
      },
      sleep: async () => { events.push("sleep"); },
    });

    await expect(client.addMilestone("work-item-128", {
      html: "<p>Milestone</p>",
      externalSource: "label-suite-github-plane-sync",
      externalId: "github:cleanup",
    })).resolves.toBeUndefined();
    expect(events).toEqual(["cancel", "sleep"]);
  });

  it.each([
    [409, "plane_write_conflict"],
    [412, "plane_write_conflict"],
    [503, "plane_service_unavailable"],
  ])("does not retry a non-429 Plane POST response (%i)", async (status, code) => {
    const waits: number[] = [];
    let postAttempts = 0;
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: async (_input, init) => {
        expect(init?.method).toBe("POST");
        postAttempts += 1;
        return json(
          { detail: "authorization=plane-test-token raw body must never escape" },
          status,
          { "retry-after": "4" },
        );
      },
      sleep: async (delayMs) => { waits.push(delayMs); },
    });

    const error = await client.addMilestone("work-item-128", {
      html: "<p>Milestone</p>",
      externalSource: "label-suite-github-plane-sync",
      externalId: "github:side-effect",
    }).catch((failure: unknown) => failure);

    expect(error).toMatchObject({ code, method: "POST", status });
    expect(postAttempts).toBe(1);
    expect(waits).toEqual([]);
    expect(String(error)).not.toContain("plane-test-token");
    expect(String(error)).not.toContain("raw body");
    expect(String(error)).not.toContain("work-item-128");
  });

  it("bounds repeated Plane POST rate limits and cancels every 429 response body", async () => {
    const waits: number[] = [];
    const cancellations: number[] = [];
    let attempts = 0;
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: async () => {
        attempts += 1;
        const body = new ReadableStream<Uint8Array>({
          cancel() {
            cancellations.push(attempts);
            throw new Error("response cleanup detail must never escape");
          },
        });
        return new Response(body, { status: 429, headers: { "retry-after": "86400" } });
      },
      sleep: async (delayMs) => { waits.push(delayMs); },
    });

    const error = await client.addMilestone("work-item-128", {
      html: "<p>Milestone</p>",
      externalSource: "label-suite-github-plane-sync",
      externalId: "github:repeated-rate-limit",
    }).catch((failure: unknown) => failure);

    expect(error).toMatchObject({ code: "plane_rate_limited", method: "POST", status: 429 });
    expect(attempts).toBe(3);
    expect(waits).toEqual([60_000, 60_000]);
    expect(cancellations).toEqual([1, 2, 3]);
    expect(String(error)).not.toContain("plane-test-token");
    expect(String(error)).not.toContain("response cleanup detail");
    expect(String(error)).not.toContain("work-item-128");
  });

  it("uses the safe fallback for malformed Retry-After values", async () => {
    const now = Date.UTC(2026, 7, 2, 12, 0, 0);
    await expect(observedRateLimitDelay("4.5", now)).resolves.toBe(4_000);
    await expect(observedRateLimitDelay("-1", now)).resolves.toBe(4_000);
    await expect(observedRateLimitDelay("Wed, 21 Oct 2015 07:28:00 GMT trailing-data", now)).resolves.toBe(4_000);
  });

  it("validates HTTP-date Retry-After values and bounds their delays", async () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    await expect(observedRateLimitDelay("Thu, 01 Jan 2026 00:00:05 GMT", now)).resolves.toBe(5_000);
    await expect(observedRateLimitDelay("Thu, 01 Jan 2026 00:01:00 GMT", now)).resolves.toBe(60_000);
    await expect(observedRateLimitDelay("Wed, 31 Dec 2025 23:59:00 GMT", now)).resolves.toBe(0);
    await expect(observedRateLimitDelay("Fri, 01 Jan 2026 00:00:05 GMT", now)).resolves.toBe(4_000);
    await expect(observedRateLimitDelay("Thu, 31 Feb 2026 00:00:05 GMT", now)).resolves.toBe(4_000);
  });

  it("recovers bootstrap reads when Plane accepts one request every 5.5 seconds", async () => {
    const states = [
      { id: "backlog-state", name: "Backlog" },
      { id: "todo-state", name: "Todo" },
      { id: "progress-state", name: "In Progress" },
      { id: "done-state", name: "Done" },
      { id: "cancelled-state", name: "Cancelled" },
    ];
    const modules = [
      { id: "product-module", name: "Product Confidence & Delivery" },
      { id: "analytics-module", name: "Analytics & Forecasting" },
      { id: "artists-module", name: "Artists, Releases & Rights" },
      { id: "directory-module", name: "Directory & Campaigns" },
      { id: "events-module", name: "Events, Tasks & Search" },
      { id: "assets-module", name: "Content, Assets & Budgets" },
    ];
    const waits: number[] = [];
    let now = 0;
    let lastSuccessfulRequestAt = -5_500;
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (now - lastSuccessfulRequestAt < 5_500) return json({ detail: "rate limited" }, 429, { "retry-after": "4" });
        lastSuccessfulRequestAt = now;
        if (url.pathname.endsWith("/states/")) return json({ results: states, next_cursor: null });
        if (url.pathname.endsWith("/modules/")) return json({ results: modules, next_cursor: null });
        if (url.pathname.endsWith("/work-items/")) return json({ results: [], next_cursor: null });
        return json({ detail: "unexpected endpoint" }, 404);
      },
      sleep: async (delayMs) => { waits.push(delayMs); now += delayMs; },
      now: () => now,
    });

    await expect(client.resolveVocabulary()).resolves.toMatchObject({ states: { Todo: "todo-state" } });
    await expect(client.findHealthItems()).resolves.toEqual([]);
    expect(waits).toEqual([4_000, 4_000, 4_000, 4_000]);
  });

  it("aborts a stalled Plane request before response headers arrive", async () => {
    vi.useFakeTimers();

    let rejectFetch: ((reason: unknown) => void) | undefined;
    let fetchAborted = false;
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          rejectFetch = reject;
          init?.signal?.addEventListener("abort", () => {
            fetchAborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    });

    try {
      const result = client.getWorkItem("work-item-128").catch((error) => error);

      await vi.advanceTimersByTimeAsync(10_000);

      await expect(result).resolves.toMatchObject({
        code: "plane_request_timeout",
        method: "GET",
        routeTemplate: "/api/v1/workspaces/{workspace}/projects/{project}/work-items/{workItemId}/",
        status: 0,
      });
      expect(fetchAborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      rejectFetch?.(new Error("test cleanup"));
      vi.useRealTimers();
    }
  });

  it("aborts a stalled Plane response body and clears its deadline timer", async () => {
    vi.useFakeTimers();

    let bodyAborted = false;
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: async (_input, init) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener("abort", () => {
              bodyAborted = true;
              controller.error(new DOMException("Aborted", "AbortError"));
            });
          },
        });
        return new Response(body, { headers: { "content-type": "application/json" } });
      },
    });

    try {
      const result = client.getWorkItem("work-item-128").catch((error) => error);

      await vi.advanceTimersByTimeAsync(10_000);

      await expect(result).resolves.toMatchObject({
        code: "plane_request_timeout",
        method: "GET",
        routeTemplate: "/api/v1/workspaces/{workspace}/projects/{project}/work-items/{workItemId}/",
        status: 200,
      });
      expect(bodyAborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when a successful work-item response omits its labels collection", async () => {
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: async () =>
        json({
          id: "work-item-128",
          name: "Malformed item",
          description_html: "",
          state: "todo-state",
          priority: "none",
          module_ids: [],
        }),
    });

    const error = await client.getWorkItem("work-item-128").catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: "plane_work_item_invalid", method: "GET", status: 200 });
    expect(String(error)).toContain("route=/api/v1/workspaces/{workspace}/projects/{project}/work-items/{workItemId}/");
    expect(String(error)).not.toContain("work-item-128");
  });

  it("patches only changed state and priority after a human changes every protected field", async () => {
    const remote = statefulPlane([
      {
        id: "work-item-128",
        name: "Curated roadmap title",
        description_html:
          "<p>Manual roadmap note</p><!-- plane-sync:source:start --><p>old source</p><!-- plane-sync:source:end --><p>Manual owner tail</p>",
        state: "todo-state",
        priority: "urgent",
        labels: ["manual-label", "review-label"],
        module_ids: ["product-module"],
      },
    ]);
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: remote.fetchImpl,
    });
    const current = await client.getWorkItem("work-item-128");
    remote.items[0]!.name = "Human renamed this immediately before PATCH";
    remote.items[0]!.description_html = "<p>Human replaced every byte of prose immediately before PATCH</p>";
    remote.items[0]!.labels = ["human-label", "another-human-label"];

    await client.patchProjection(current, { stateId: "done-state", priority: "high" });

    expect(remote.items[0]).toEqual({
      id: "work-item-128",
      name: "Human renamed this immediately before PATCH",
      description_html: "<p>Human replaced every byte of prose immediately before PATCH</p>",
      state: "done-state",
      priority: "high",
      labels: ["human-label", "another-human-label"],
      module_ids: ["product-module"],
      updated_at: "2026-08-01T00:00:01.000Z",
    });
    expect(remote.requests.find((request) => request.method === "PATCH")?.body).toEqual({
      state: "done-state",
      priority: "high",
    });
  });

  it("does not PATCH when state and priority already match", async () => {
    const remote = statefulPlane([
      {
        id: "work-item-128",
        name: "Curated roadmap title",
        description_html: "<p>Manual note</p>",
        state: "done-state",
        priority: "high",
        labels: ["manual-label"],
        module_ids: [],
      },
    ]);
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: remote.fetchImpl,
    });
    const result = await client.patchProjection(await client.getWorkItem("work-item-128"), {
      stateId: "done-state",
      priority: "high",
    });

    expect(result).toMatchObject({ stateId: "done-state", priority: "high" });
    expect(remote.requests.filter((request) => request.method === "PATCH")).toEqual([]);
  });

  it("omits an unchanged state from a priority-only PATCH", async () => {
    const remote = statefulPlane([
      {
        id: "work-item-128",
        name: "Human title",
        description_html: "<p>Human note</p>",
        state: "todo-state",
        priority: "none",
        labels: ["human-label"],
        module_ids: [],
      },
    ]);
    const client = new PlaneClient({
      baseUrl: new URL("https://plane.example.test"),
      apiToken: "plane-test-token",
      workspace: "label-suite",
      projectId: "project-id",
      fetchImpl: remote.fetchImpl,
    });

    await client.patchProjection(await client.getWorkItem("work-item-128"), {
      stateId: "todo-state",
      priority: "urgent",
    });

    expect(remote.requests.find((request) => request.method === "PATCH")?.body).toEqual({ priority: "urgent" });
    expect(remote.items[0]).toMatchObject({
      name: "Human title",
      description_html: "<p>Human note</p>",
      state: "todo-state",
      priority: "urgent",
      labels: ["human-label"],
    });
  });
});
