import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { indexSeedRegistry, loadSeedRegistry } from "./registry.js";

const entry = (overrides: Record<string, unknown> = {}) => ({
  planeWorkItemId: "10b19450-0ec3-43b6-b3ff-0ebcc92a4afe",
  issueNumbers: [81],
  moduleName: "Product Confidence & Delivery",
  managedFields: ["state", "milestones"],
  curatedTitle: true,
  ...overrides,
});

describe("seed registry", () => {
  it("indexes one issue to every intentionally aggregated Plane item", () => {
    const registry = loadSeedRegistry({
      version: 1,
      entries: [
        entry(),
        entry({
          planeWorkItemId: "d2c1f1e8-c690-434c-b5a2-7359b2388f4b",
          issueNumbers: [81, 82],
        }),
      ],
    });

    const index = indexSeedRegistry(registry);

    expect(index.byIssue.get(81)?.map((item) => item.planeWorkItemId)).toEqual([
      "10b19450-0ec3-43b6-b3ff-0ebcc92a4afe",
      "d2c1f1e8-c690-434c-b5a2-7359b2388f4b",
    ]);
  });

  it("refuses duplicate Plane work item identities", () => {
    expect(() =>
      loadSeedRegistry({ version: 1, entries: [entry(), entry({ issueNumbers: [82] })] }),
    ).toThrow("planeWorkItemId must be unique");
  });

  it("refuses duplicate Plane work item identities that differ only by UUID letter case", () => {
    expect(() =>
      loadSeedRegistry({
        version: 1,
        entries: [
          entry(),
          entry({
            planeWorkItemId: "10B19450-0EC3-43B6-B3FF-0EBCC92A4AFE",
            issueNumbers: [82],
          }),
        ],
      }),
    ).toThrow("planeWorkItemId must be unique");
  });

  it("refuses duplicate GitHub issues within an aggregated Plane item", () => {
    expect(() => loadSeedRegistry({ version: 1, entries: [entry({ issueNumbers: [81, 81] })] })).toThrow(
      "issueNumbers must not contain duplicates",
    );
  });

  it("refuses a managed field outside the explicitly supported projection contract", () => {
    expect(() => loadSeedRegistry({ version: 1, entries: [entry({ managedFields: ["state", "description"] })] })).toThrow(
      "managedFields contains unsupported value: description",
    );
    expect(() => loadSeedRegistry({ version: 1, entries: [entry({ managedFields: ["title"] })] })).toThrow(
      "managedFields contains unsupported value: title",
    );
    expect(() => loadSeedRegistry({ version: 1, entries: [entry({ managedFields: ["source"] })] })).toThrow(
      "managedFields contains unsupported value: source",
    );
  });

  it("refuses a Plane work item ID that cannot identify a UUID resource", () => {
    expect(() => loadSeedRegistry({ version: 1, entries: [entry({ planeWorkItemId: "plane-81" })] })).toThrow(
      "planeWorkItemId must be a UUID",
    );
  });

  it("loads the reviewed registry so issue 81 reaches both intended Plane items", () => {
    const value: unknown = JSON.parse(
      readFileSync(new URL("../config/seed-registry.json", import.meta.url), "utf8"),
    );

    const index = indexSeedRegistry(loadSeedRegistry(value));

    expect(index.byIssue.get(81)?.map((item) => item.planeWorkItemId)).toEqual([
      "10b19450-0ec3-43b6-b3ff-0ebcc92a4afe",
      "d2c1f1e8-c690-434c-b5a2-7359b2388f4b",
    ]);
  });
});
