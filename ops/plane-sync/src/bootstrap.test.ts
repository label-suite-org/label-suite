import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrapPlane } from "./bootstrap.js";
import { PermanentSyncError, RetryableSyncError } from "./errors.js";
import { PlaneModuleMembershipInventory } from "./plane.js";
import { SqliteDeliveryStore } from "./store.js";

const directories: string[] = [];
const stores: SqliteDeliveryStore[] = [];

function temporaryStore(): SqliteDeliveryStore {
  const directory = mkdtempSync(join(tmpdir(), "plane-sync-bootstrap-"));
  directories.push(directory);
  const store = SqliteDeliveryStore.open(join(directory, "deliveries.sqlite"));
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("bootstrapPlane", () => {
  it("plans without writes, then converges the unique health item to Todo and exactly one approved module", async () => {
    const store = temporaryStore();
    const item = {
      id: "health-item",
      name: "[System] GitHub to Plane sync health",
      descriptionHtml: "<p>Manual escalation context</p>",
      stateId: "backlog",
      priority: "medium" as const,
      labelIds: ["manual-label"],
      moduleIds: ["module-analytics", "module-product"],
    };
    const plane = {
      async resolveVocabulary() {
        return {
          states: { Backlog: "backlog", Todo: "todo", "In Progress": "active", Done: "done", Cancelled: "cancelled" },
          modules: {
            "Product Confidence & Delivery": "module-product",
            "Analytics & Forecasting": "module-analytics",
            "Artists, Releases & Rights": "module-artists",
            "Directory & Campaigns": "module-directory",
            "Events, Tasks & Search": "module-events",
            "Content, Assets & Budgets": "module-content",
          },
        };
      },
      async findHealthItems() {
        return [{ ...item, labelIds: [...item.labelIds], moduleIds: [...item.moduleIds] }];
      },
      async getWorkItem() {
        return { ...item, labelIds: [...item.labelIds], moduleIds: [...item.moduleIds] };
      },
      async patchProjection(_current: unknown, patch: { stateId?: string }) {
        if (patch.stateId !== undefined) item.stateId = patch.stateId;
        return { ...item, labelIds: [...item.labelIds], moduleIds: [...item.moduleIds] };
      },
      async setModule(_id: string, moduleId: string, onMutation?: () => void) {
        item.moduleIds = [moduleId];
        onMutation?.();
        return true;
      },
    };
    const before = JSON.stringify(item);

    await expect(bootstrapPlane({ store, plane: plane as never }, { apply: false })).resolves.toEqual({
      mode: "dry-run",
      healthItem: "present",
    });
    expect(JSON.stringify(item)).toBe(before);
    expect(store.getCursor("health-item-id")).toBeNull();
    expect(store.getCursor("health-item-candidate-id")).toBeNull();

    await expect(bootstrapPlane(
      { store, plane: plane as never },
      { apply: true, now: new Date("2026-08-02T10:00:00.000Z") },
    )).resolves.toEqual({ mode: "active", healthItem: "present" });
    expect(item).toEqual({
      id: "health-item",
      name: "[System] GitHub to Plane sync health",
      descriptionHtml: "<p>Manual escalation context</p>",
      stateId: "todo",
      priority: "medium",
      labelIds: ["manual-label"],
      moduleIds: ["module-product"],
    });
    expect(store.getCursor("health-item-id")).toBe("health-item");
    expect(store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-02T10:00:00.000Z");
  });

  it("uses the authoritative module inventory when live health-item responses omit module ids", async () => {
    const store = temporaryStore();
    const vocabulary = {
      states: { Backlog: "backlog", Todo: "todo", "In Progress": "active", Done: "done", Cancelled: "cancelled" },
      modules: {
        "Product Confidence & Delivery": "module-product",
        "Analytics & Forecasting": "module-analytics",
        "Artists, Releases & Rights": "module-artists",
        "Directory & Campaigns": "module-directory",
        "Events, Tasks & Search": "module-events",
        "Content, Assets & Budgets": "module-content",
      },
    } as const;
    const liveItem = {
      id: "health-item",
      name: "[System] GitHub to Plane sync health",
      descriptionHtml: "",
      stateId: "todo",
      priority: "none" as const,
      labelIds: [],
    };
    let moduleWrites = 0;
    const plane = {
      async loadModuleMembershipInventory() {
        return new PlaneModuleMembershipInventory(
          vocabulary,
          new Map<string, string[]>([
            ...Object.values(vocabulary.modules).map((moduleId): [string, string[]] =>
              [moduleId, moduleId === "module-product" ? ["health-item"] : []],
            ),
            ["legacy-module", []],
          ]),
        );
      },
      async findHealthItems() {
        return [{ ...liveItem, labelIds: [] }];
      },
      async getWorkItem() {
        return { ...liveItem, labelIds: [] };
      },
      async setModule() {
        moduleWrites += 1;
        throw new Error("must not mutate an inventory-confirmed health module");
      },
    };

    await expect(bootstrapPlane({ store, plane: plane as never }, { apply: true })).resolves.toEqual({
      mode: "active",
      healthItem: "present",
    });
    expect(moduleWrites).toBe(0);
    expect(store.getCursor("health-item-id")).toBe("health-item");
  });

  it("does not record a Plane mutation when module convergence observes no successful write", async () => {
    const store = temporaryStore();
    store.setCursor("last-successful-plane-mutation-at", "2026-08-02T09:55:00.000Z");
    const item = {
      id: "health-item",
      name: "[System] GitHub to Plane sync health",
      descriptionHtml: "<p>Manual escalation context</p>",
      stateId: "todo",
      priority: "medium" as const,
      labelIds: ["manual-label"],
      moduleIds: ["module-analytics"],
    };
    const copy = () => ({ ...item, labelIds: [...item.labelIds], moduleIds: [...item.moduleIds] });
    const plane = {
      async resolveVocabulary() {
        return {
          states: { Backlog: "backlog", Todo: "todo", "In Progress": "active", Done: "done", Cancelled: "cancelled" },
          modules: {
            "Product Confidence & Delivery": "module-product",
            "Analytics & Forecasting": "module-analytics",
            "Artists, Releases & Rights": "module-artists",
            "Directory & Campaigns": "module-directory",
            "Events, Tasks & Search": "module-events",
            "Content, Assets & Budgets": "module-content",
          },
        };
      },
      async findHealthItems() {
        return [copy()];
      },
      async getWorkItem() {
        return copy();
      },
      async setModule(_id: string, moduleId: string, _onMutation?: () => void) {
        item.moduleIds = [moduleId];
        return false;
      },
    };

    await expect(bootstrapPlane(
      { store, plane: plane as never },
      { apply: true, now: new Date("2026-08-02T10:00:00.000Z") },
    )).resolves.toEqual({ mode: "active", healthItem: "present" });
    expect(item.moduleIds).toEqual(["module-product"]);
    expect(store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-02T09:55:00.000Z");
  });

  it("records a Plane mutation after a successful module write", async () => {
    const store = temporaryStore();
    store.setCursor("last-successful-plane-mutation-at", "2026-08-02T09:55:00.000Z");
    const item = {
      id: "health-item",
      name: "[System] GitHub to Plane sync health",
      descriptionHtml: "<p>Manual escalation context</p>",
      stateId: "todo",
      priority: "medium" as const,
      labelIds: ["manual-label"],
      moduleIds: ["module-analytics"],
    };
    const copy = () => ({ ...item, labelIds: [...item.labelIds], moduleIds: [...item.moduleIds] });
    const plane = {
      async resolveVocabulary() {
        return {
          states: { Backlog: "backlog", Todo: "todo", "In Progress": "active", Done: "done", Cancelled: "cancelled" },
          modules: {
            "Product Confidence & Delivery": "module-product",
            "Analytics & Forecasting": "module-analytics",
            "Artists, Releases & Rights": "module-artists",
            "Directory & Campaigns": "module-directory",
            "Events, Tasks & Search": "module-events",
            "Content, Assets & Budgets": "module-content",
          },
        };
      },
      async findHealthItems() {
        return [copy()];
      },
      async getWorkItem() {
        return copy();
      },
      async setModule(_id: string, moduleId: string, onMutation?: () => void) {
        item.moduleIds = [moduleId];
        onMutation?.();
        return true;
      },
    };

    await expect(bootstrapPlane(
      { store, plane: plane as never },
      { apply: true, now: new Date("2026-08-02T10:00:00.000Z") },
    )).resolves.toEqual({ mode: "active", healthItem: "present" });
    expect(item.moduleIds).toEqual(["module-product"]);
    expect(store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-02T10:00:00.000Z");
  });

  it("persists a confirmed health-item module write before a later module failure", async () => {
    const store = temporaryStore();
    store.setCursor("last-successful-plane-mutation-at", "2026-08-02T09:55:00.000Z");
    const item = {
      id: "health-item",
      name: "[System] GitHub to Plane sync health",
      descriptionHtml: "<p>Manual escalation context</p>",
      stateId: "todo",
      priority: "medium" as const,
      labelIds: ["manual-label"],
      moduleIds: ["module-analytics"],
    };
    let failAfterWrite = true;
    let notifications = 0;
    const copy = () => ({ ...item, labelIds: [...item.labelIds], moduleIds: [...item.moduleIds] });
    const plane = {
      async resolveVocabulary() {
        return {
          states: { Backlog: "backlog", Todo: "todo", "In Progress": "active", Done: "done", Cancelled: "cancelled" },
          modules: {
            "Product Confidence & Delivery": "module-product",
            "Analytics & Forecasting": "module-analytics",
            "Artists, Releases & Rights": "module-artists",
            "Directory & Campaigns": "module-directory",
            "Events, Tasks & Search": "module-events",
            "Content, Assets & Budgets": "module-content",
          },
        };
      },
      async findHealthItems() {
        return [copy()];
      },
      async getWorkItem() {
        return copy();
      },
      async setModule(_id: string, moduleId: string, onMutation?: () => void) {
        if (failAfterWrite) {
          failAfterWrite = false;
          item.moduleIds = [];
          onMutation?.();
          notifications += 1;
          throw new RetryableSyncError("plane_service_unavailable");
        }
        item.moduleIds = [moduleId];
        onMutation?.();
        notifications += 1;
        return true;
      },
    };

    await expect(bootstrapPlane(
      { store, plane: plane as never },
      { apply: true, now: new Date("2026-08-02T10:00:00.000Z") },
    )).rejects.toMatchObject({ code: "plane_service_unavailable" });
    expect(item.moduleIds).toEqual([]);
    expect(notifications).toBe(1);
    expect(store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-02T10:00:00.000Z");

    await expect(bootstrapPlane(
      { store, plane: plane as never },
      { apply: true, now: new Date("2026-08-02T10:05:00.000Z") },
    )).resolves.toEqual({ mode: "active", healthItem: "present" });
    await expect(bootstrapPlane(
      { store, plane: plane as never },
      { apply: true, now: new Date("2026-08-02T10:10:00.000Z") },
    )).resolves.toEqual({ mode: "active", healthItem: "present" });
    expect(item.moduleIds).toEqual(["module-product"]);
    expect(notifications).toBe(2);
    expect(store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-02T10:05:00.000Z");
  });

  it("reuses a staged unique listing identity after module failure and a later empty listing", async () => {
    const store = temporaryStore();
    const item = {
      id: "existing-health-item",
      name: "[System] GitHub to Plane sync health",
      descriptionHtml: "<p>Manual escalation context</p>",
      stateId: "backlog",
      priority: "medium" as const,
      labelIds: ["manual-label"],
      moduleIds: ["module-analytics"],
    };
    let listingCount = 0;
    let createCount = 0;
    let failModule = true;
    const copy = () => ({ ...item, labelIds: [...item.labelIds], moduleIds: [...item.moduleIds] });
    const plane = {
      async resolveVocabulary() {
        return {
          states: { Backlog: "backlog", Todo: "todo", "In Progress": "active", Done: "done", Cancelled: "cancelled" },
          modules: {
            "Product Confidence & Delivery": "module-product",
            "Analytics & Forecasting": "module-analytics",
            "Artists, Releases & Rights": "module-artists",
            "Directory & Campaigns": "module-directory",
            "Events, Tasks & Search": "module-events",
            "Content, Assets & Budgets": "module-content",
          },
        };
      },
      async findHealthItems() {
        listingCount += 1;
        return listingCount === 1 ? [copy()] : [];
      },
      async getWorkItem(id: string) {
        if (id !== item.id) throw new Error(`unexpected health item ${id}`);
        return copy();
      },
      async patchProjection(_current: unknown, patch: { stateId?: string }) {
        if (patch.stateId !== undefined) item.stateId = patch.stateId;
        return copy();
      },
      async setModule(_id: string, moduleId: string, onMutation?: () => void) {
        if (failModule) {
          failModule = false;
          throw new RetryableSyncError("plane_service_unavailable");
        }
        item.moduleIds = [moduleId];
        onMutation?.();
        return true;
      },
      async createHealthItem() {
        createCount += 1;
        return { ...copy(), id: "duplicate-health-item" };
      },
    };

    await expect(bootstrapPlane(
      { store, plane: plane as never },
      { apply: true, now: new Date("2026-08-02T10:00:00.000Z") },
    )).rejects.toMatchObject({ code: "plane_service_unavailable" });
    expect(store.getCursor("health-item-id")).toBeNull();
    expect(store.getCursor("health-item-candidate-id")).toBe("existing-health-item");
    expect(createCount).toBe(0);

    await expect(bootstrapPlane(
      { store, plane: plane as never },
      { apply: true, now: new Date("2026-08-02T10:05:00.000Z") },
    )).resolves.toEqual({ mode: "active", healthItem: "present" });
    expect(createCount).toBe(0);
    expect(store.getCursor("health-item-id")).toBe("existing-health-item");
    expect(store.getCursor("health-item-candidate-id")).toBeNull();
    expect(item).toEqual({
      id: "existing-health-item",
      name: "[System] GitHub to Plane sync health",
      descriptionHtml: "<p>Manual escalation context</p>",
      stateId: "todo",
      priority: "medium",
      labelIds: ["manual-label"],
      moduleIds: ["module-product"],
    });
  });

  it("reports a missing health item in dry-run without creating it or recording metadata", async () => {
    const created: unknown[] = [];
    const plane = {
      async resolveVocabulary() {
        return {
          states: { Backlog: "backlog", Todo: "todo", "In Progress": "active", Done: "done", Cancelled: "cancelled" },
          modules: {
            "Product Confidence & Delivery": "module-product",
            "Analytics & Forecasting": "module-analytics",
            "Artists, Releases & Rights": "module-artists",
            "Directory & Campaigns": "module-directory",
            "Events, Tasks & Search": "module-events",
            "Content, Assets & Budgets": "module-content",
          },
        };
      },
      async findHealthItems() {
        return [];
      },
      async createHealthItem(input: unknown) {
        created.push(input);
        return { id: "health-item" };
      },
    };
    const store = temporaryStore();

    await expect(bootstrapPlane({ store, plane: plane as never }, { apply: false })).resolves.toEqual({
      mode: "dry-run",
      healthItem: "would-create",
    });
    expect(created).toEqual([]);
    expect(store.getCursor("health-item-id")).toBeNull();
    expect(store.getCursor("health-item-candidate-id")).toBeNull();
  });

  it("creates the one health item once and records its ID only after Plane succeeds", async () => {
    const items: Array<{
      id: string;
      name: string;
      descriptionHtml: string;
      stateId: string;
      priority: "none";
      labelIds: string[];
      moduleIds: string[];
    }> = [];
    let creates = 0;
    const plane = {
      async resolveVocabulary() {
        return {
          states: { Backlog: "backlog", Todo: "todo", "In Progress": "active", Done: "done", Cancelled: "cancelled" },
          modules: {
            "Product Confidence & Delivery": "module-product",
            "Analytics & Forecasting": "module-analytics",
            "Artists, Releases & Rights": "module-artists",
            "Directory & Campaigns": "module-directory",
            "Events, Tasks & Search": "module-events",
            "Content, Assets & Budgets": "module-content",
          },
        };
      },
      async findHealthItems() {
        return items.map((item) => ({ ...item, labelIds: [...item.labelIds], moduleIds: [...item.moduleIds] }));
      },
      async createHealthItem() {
        creates += 1;
        const item = {
          id: "health-item",
          name: "[System] GitHub to Plane sync health",
          descriptionHtml: "",
          stateId: "todo",
          priority: "none" as const,
          labelIds: [],
          moduleIds: ["module-product"],
        };
        items.push(item);
        return { ...item, labelIds: [...item.labelIds], moduleIds: [...item.moduleIds] };
      },
      async getWorkItem(id: string) {
        const item = items.find((candidate) => candidate.id === id)!;
        return { ...item, labelIds: [...item.labelIds], moduleIds: [...item.moduleIds] };
      },
    };
    const store = temporaryStore();

    await expect(bootstrapPlane({ store, plane: plane as never }, { apply: true })).resolves.toEqual({
      mode: "active",
      healthItem: "created",
    });
    await expect(bootstrapPlane({ store, plane: plane as never }, { apply: true })).resolves.toEqual({
      mode: "active",
      healthItem: "present",
    });
    expect(creates).toBe(1);
    expect(store.getCursor("health-item-id")).toBe("health-item");
  });

  it("does not trust a create response until the candidate exists in an authoritative final read", async () => {
    const store = temporaryStore();
    const plane = {
      async resolveVocabulary() {
        return {
          states: { Backlog: "backlog", Todo: "todo", "In Progress": "active", Done: "done", Cancelled: "cancelled" },
          modules: {
            "Product Confidence & Delivery": "module-product",
            "Analytics & Forecasting": "module-analytics",
            "Artists, Releases & Rights": "module-artists",
            "Directory & Campaigns": "module-directory",
            "Events, Tasks & Search": "module-events",
            "Content, Assets & Budgets": "module-content",
          },
        };
      },
      async findHealthItems() {
        return [];
      },
      async createHealthItem() {
        return {
          id: "ghost-health-item",
          name: "[System] GitHub to Plane sync health",
          descriptionHtml: "",
          stateId: "todo",
          priority: "none" as const,
          labelIds: [],
          moduleIds: ["module-product"],
        };
      },
      async getWorkItem() {
        throw new RetryableSyncError("plane_service_unavailable");
      },
    };

    await expect(bootstrapPlane({ store, plane: plane as never }, { apply: true })).rejects.toMatchObject({
      code: "plane_service_unavailable",
    });
    expect(store.getCursor("health-item-id")).toBeNull();
    expect(store.getCursor("health-item-candidate-id")).toBe("ghost-health-item");
  });

  it("fails closed for duplicate health-item names without recording an arbitrary ID", async () => {
    const store = temporaryStore();
    store.setCursor("health-item-id", "health-a");
    store.setCursor("health-item-candidate-id", "health-a");
    const item = (id: string) => ({
      id,
      name: "[System] GitHub to Plane sync health",
      descriptionHtml: "",
      stateId: "todo",
      priority: "none" as const,
      labelIds: [],
      moduleIds: ["module-product"],
    });
    const plane = {
      async resolveVocabulary() {
        return {
          states: { Backlog: "backlog", Todo: "todo", "In Progress": "active", Done: "done", Cancelled: "cancelled" },
          modules: {
            "Product Confidence & Delivery": "module-product",
            "Analytics & Forecasting": "module-analytics",
            "Artists, Releases & Rights": "module-artists",
            "Directory & Campaigns": "module-directory",
            "Events, Tasks & Search": "module-events",
            "Content, Assets & Budgets": "module-content",
          },
        };
      },
      async findHealthItems() {
        return [item("health-a"), item("health-b")];
      },
    };

    await expect(bootstrapPlane({ store, plane: plane as never }, { apply: true })).rejects.toMatchObject({
      code: "plane_health_item_ambiguous",
    });
    expect(store.getCursor("health-item-id")).toBe("health-a");
    expect(store.getCursor("health-item-candidate-id")).toBe("health-a");
  });

  it("does not stage an arbitrary candidate when an untrusted listing contains duplicate names", async () => {
    const store = temporaryStore();
    const item = (id: string) => ({
      id,
      name: "[System] GitHub to Plane sync health",
      descriptionHtml: "",
      stateId: "todo",
      priority: "none" as const,
      labelIds: [],
      moduleIds: ["module-product"],
    });
    const plane = {
      async resolveVocabulary() {
        return {
          states: { Backlog: "backlog", Todo: "todo", "In Progress": "active", Done: "done", Cancelled: "cancelled" },
          modules: {
            "Product Confidence & Delivery": "module-product",
            "Analytics & Forecasting": "module-analytics",
            "Artists, Releases & Rights": "module-artists",
            "Directory & Campaigns": "module-directory",
            "Events, Tasks & Search": "module-events",
            "Content, Assets & Budgets": "module-content",
          },
        };
      },
      async findHealthItems() {
        return [item("health-a"), item("health-b")];
      },
    };

    await expect(bootstrapPlane({ store, plane: plane as never }, { apply: true })).rejects.toMatchObject({
      code: "plane_health_item_ambiguous",
    });
    expect(store.getCursor("health-item-id")).toBeNull();
    expect(store.getCursor("health-item-candidate-id")).toBeNull();
  });

  it("fails closed when a unique listing conflicts with the durable candidate", async () => {
    const store = temporaryStore();
    store.setCursor("health-item-candidate-id", "health-a");
    let reads = 0;
    let creates = 0;
    const plane = {
      async resolveVocabulary() {
        return {
          states: { Backlog: "backlog", Todo: "todo", "In Progress": "active", Done: "done", Cancelled: "cancelled" },
          modules: {
            "Product Confidence & Delivery": "module-product",
            "Analytics & Forecasting": "module-analytics",
            "Artists, Releases & Rights": "module-artists",
            "Directory & Campaigns": "module-directory",
            "Events, Tasks & Search": "module-events",
            "Content, Assets & Budgets": "module-content",
          },
        };
      },
      async findHealthItems() {
        return [{
          id: "health-b",
          name: "[System] GitHub to Plane sync health",
          descriptionHtml: "",
          stateId: "todo",
          priority: "none" as const,
          labelIds: [],
          moduleIds: ["module-product"],
        }];
      },
      async getWorkItem() {
        reads += 1;
        throw new Error("must not read an ambiguous identity");
      },
      async createHealthItem() {
        creates += 1;
        throw new Error("must not create an ambiguous identity");
      },
    };

    await expect(bootstrapPlane({ store, plane: plane as never }, { apply: true })).rejects.toMatchObject({
      code: "plane_health_item_ambiguous",
    });
    expect(reads).toBe(0);
    expect(creates).toBe(0);
    expect(store.getCursor("health-item-id")).toBeNull();
    expect(store.getCursor("health-item-candidate-id")).toBe("health-a");
  });

  it.each([
    { scenario: "the candidate is missing", code: "plane_work_item_missing" },
    { scenario: "the candidate has the wrong identity", code: "plane_health_item_invalid" },
  ])("does not create when an empty listing reveals $scenario", async ({ code }) => {
    const store = temporaryStore();
    store.setCursor("health-item-candidate-id", "health-a");
    let creates = 0;
    const plane = {
      async resolveVocabulary() {
        return {
          states: { Backlog: "backlog", Todo: "todo", "In Progress": "active", Done: "done", Cancelled: "cancelled" },
          modules: {
            "Product Confidence & Delivery": "module-product",
            "Analytics & Forecasting": "module-analytics",
            "Artists, Releases & Rights": "module-artists",
            "Directory & Campaigns": "module-directory",
            "Events, Tasks & Search": "module-events",
            "Content, Assets & Budgets": "module-content",
          },
        };
      },
      async findHealthItems() {
        return [];
      },
      async getWorkItem() {
        if (code === "plane_work_item_missing") throw new PermanentSyncError(code);
        return {
          id: "health-a",
          name: "A human work item with a different identity",
          descriptionHtml: "<p>Human context</p>",
          stateId: "todo",
          priority: "none" as const,
          labelIds: ["human-label"],
          moduleIds: ["module-product"],
        };
      },
      async createHealthItem() {
        creates += 1;
        throw new Error("must not create while candidate validation is unavailable");
      },
    };

    await expect(bootstrapPlane({ store, plane: plane as never }, { apply: true })).rejects.toMatchObject({
      code,
    });
    expect(creates).toBe(0);
    expect(store.getCursor("health-item-id")).toBeNull();
    expect(store.getCursor("health-item-candidate-id")).toBe("health-a");
  });

  it.each([
    {
      name: "stale state after a successful-looking patch",
      initialState: "backlog",
      initialModules: ["module-product"],
      patchState: false,
      setModules: true,
    },
    {
      name: "an extra module after a successful-looking module write",
      initialState: "todo",
      initialModules: ["module-product", "module-analytics"],
      patchState: true,
      setModules: false,
    },
  ])("fails closed when the final authoritative read retains $name", async ({
    initialState,
    initialModules,
    patchState,
    setModules,
  }) => {
    const store = temporaryStore();
    const item = {
      id: "health-item",
      name: "[System] GitHub to Plane sync health",
      descriptionHtml: "<p>Manual context</p>",
      stateId: initialState,
      priority: "medium" as const,
      labelIds: ["manual-label"],
      moduleIds: [...initialModules],
    };
    const copy = () => ({ ...item, labelIds: [...item.labelIds], moduleIds: [...item.moduleIds] });
    const plane = {
      async resolveVocabulary() {
        return {
          states: { Backlog: "backlog", Todo: "todo", "In Progress": "active", Done: "done", Cancelled: "cancelled" },
          modules: {
            "Product Confidence & Delivery": "module-product",
            "Analytics & Forecasting": "module-analytics",
            "Artists, Releases & Rights": "module-artists",
            "Directory & Campaigns": "module-directory",
            "Events, Tasks & Search": "module-events",
            "Content, Assets & Budgets": "module-content",
          },
        };
      },
      async findHealthItems() {
        return [copy()];
      },
      async getWorkItem() {
        return copy();
      },
      async patchProjection(_current: unknown, patch: { stateId?: string }) {
        if (patchState && patch.stateId !== undefined) item.stateId = patch.stateId;
        return { ...copy(), stateId: patch.stateId ?? item.stateId };
      },
      async setModule(_id: string, moduleId: string, onMutation?: () => void) {
        if (setModules) item.moduleIds = [moduleId];
        if (setModules) onMutation?.();
        return setModules;
      },
    };

    await expect(bootstrapPlane({ store, plane: plane as never }, { apply: true })).rejects.toMatchObject({
      code: "plane_health_item_invalid",
    });
    expect(store.getCursor("health-item-id")).toBeNull();
    expect(item).toMatchObject({
      descriptionHtml: "<p>Manual context</p>",
      priority: "medium",
      labelIds: ["manual-label"],
    });
  });

  it("persists a created identity before convergence so a later apply repairs a partial create", async () => {
    const store = temporaryStore();
    const items: Array<{
      id: string;
      name: string;
      descriptionHtml: string;
      stateId: string;
      priority: "none";
      labelIds: string[];
      moduleIds: string[];
    }> = [];
    let creates = 0;
    let failPatch = true;
    const plane = {
      async resolveVocabulary() {
        return {
          states: { Backlog: "backlog", Todo: "todo", "In Progress": "active", Done: "done", Cancelled: "cancelled" },
          modules: {
            "Product Confidence & Delivery": "module-product",
            "Analytics & Forecasting": "module-analytics",
            "Artists, Releases & Rights": "module-artists",
            "Directory & Campaigns": "module-directory",
            "Events, Tasks & Search": "module-events",
            "Content, Assets & Budgets": "module-content",
          },
        };
      },
      async findHealthItems() {
        return items.map((item) => ({ ...item, labelIds: [...item.labelIds], moduleIds: [...item.moduleIds] }));
      },
      async createHealthItem() {
        creates += 1;
        const item = {
          id: "health-item",
          name: "[System] GitHub to Plane sync health",
          descriptionHtml: "<p>Manual context</p>",
          stateId: "backlog",
          priority: "none" as const,
          labelIds: ["manual-label"],
          moduleIds: [] as string[],
        };
        items.push(item);
        return { ...item, labelIds: [...item.labelIds], moduleIds: [...item.moduleIds] };
      },
      async getWorkItem(id: string) {
        const item = items.find((candidate) => candidate.id === id)!;
        return { ...item, labelIds: [...item.labelIds], moduleIds: [...item.moduleIds] };
      },
      async patchProjection(current: (typeof items)[number], patch: { stateId?: string }) {
        if (failPatch) {
          failPatch = false;
          throw new RetryableSyncError("plane_service_unavailable");
        }
        const item = items.find((candidate) => candidate.id === current.id)!;
        if (patch.stateId !== undefined) item.stateId = patch.stateId;
        return { ...item, labelIds: [...item.labelIds], moduleIds: [...item.moduleIds] };
      },
      async setModule(id: string, moduleId: string, onMutation?: () => void) {
        items.find((candidate) => candidate.id === id)!.moduleIds = [moduleId];
        onMutation?.();
        return true;
      },
    };

    await expect(bootstrapPlane(
      { store, plane: plane as never },
      { apply: true, now: new Date("2026-08-02T10:00:00.000Z") },
    )).rejects.toMatchObject({ code: "plane_service_unavailable" });
    expect(store.getCursor("health-item-id")).toBeNull();
    expect(store.getCursor("health-item-candidate-id")).toBe("health-item");
    expect(store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-02T10:00:00.000Z");

    await expect(bootstrapPlane(
      { store, plane: plane as never },
      { apply: true, now: new Date("2026-08-02T10:05:00.000Z") },
    )).resolves.toEqual({ mode: "active", healthItem: "present" });
    expect(creates).toBe(1);
    expect(items[0]).toMatchObject({
      stateId: "todo",
      moduleIds: ["module-product"],
      descriptionHtml: "<p>Manual context</p>",
      labelIds: ["manual-label"],
    });
    expect(store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-02T10:05:00.000Z");
  });

  it("leaves no durable health ID after a create failure, so a later apply can recover cleanly", async () => {
    const store = temporaryStore();
    let failCreate = true;
    const plane = {
      async resolveVocabulary() {
        return {
          states: { Backlog: "backlog", Todo: "todo", "In Progress": "active", Done: "done", Cancelled: "cancelled" },
          modules: {
            "Product Confidence & Delivery": "module-product",
            "Analytics & Forecasting": "module-analytics",
            "Artists, Releases & Rights": "module-artists",
            "Directory & Campaigns": "module-directory",
            "Events, Tasks & Search": "module-events",
            "Content, Assets & Budgets": "module-content",
          },
        };
      },
      async findHealthItems() {
        return [];
      },
      async createHealthItem() {
        if (failCreate) throw new RetryableSyncError("plane_service_unavailable");
        return {
          id: "health-item",
          name: "[System] GitHub to Plane sync health",
          descriptionHtml: "",
          stateId: "todo",
          priority: "none" as const,
          labelIds: [],
          moduleIds: ["module-product"],
        };
      },
      async getWorkItem() {
        return {
          id: "health-item",
          name: "[System] GitHub to Plane sync health",
          descriptionHtml: "",
          stateId: "todo",
          priority: "none" as const,
          labelIds: [],
          moduleIds: ["module-product"],
        };
      },
    };

    await expect(bootstrapPlane({ store, plane: plane as never }, { apply: true })).rejects.toMatchObject({
      code: "plane_service_unavailable",
    });
    expect(store.getCursor("health-item-id")).toBeNull();
    failCreate = false;
    await expect(bootstrapPlane({ store, plane: plane as never }, { apply: true })).resolves.toEqual({
      mode: "active",
      healthItem: "created",
    });
    expect(store.getCursor("health-item-id")).toBe("health-item");
  });

  it("uses the already stored health item during a partial listing outage instead of creating another one", async () => {
    const store = temporaryStore();
    store.setCursor("health-item-id", "health-item");
    let creates = 0;
    const healthItem = {
      id: "health-item",
      name: "[System] GitHub to Plane sync health",
      descriptionHtml: "<p>Manual context</p>",
      stateId: "todo",
      priority: "none" as const,
      labelIds: ["manual-label"],
      moduleIds: ["module-product"],
    };
    const plane = {
      async resolveVocabulary() {
        return {
          states: { Backlog: "backlog", Todo: "todo", "In Progress": "active", Done: "done", Cancelled: "cancelled" },
          modules: {
            "Product Confidence & Delivery": "module-product",
            "Analytics & Forecasting": "module-analytics",
            "Artists, Releases & Rights": "module-artists",
            "Directory & Campaigns": "module-directory",
            "Events, Tasks & Search": "module-events",
            "Content, Assets & Budgets": "module-content",
          },
        };
      },
      async findHealthItems() {
        return [];
      },
      async getWorkItem() {
        return { ...healthItem, labelIds: [...healthItem.labelIds], moduleIds: [...healthItem.moduleIds] };
      },
      async createHealthItem() {
        creates += 1;
        return healthItem;
      },
    };

    await expect(bootstrapPlane({ store, plane: plane as never }, { apply: true })).resolves.toEqual({
      mode: "active",
      healthItem: "present",
    });
    expect(creates).toBe(0);
    expect(store.getCursor("health-item-id")).toBe("health-item");
  });
});
