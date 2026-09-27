import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("operator PR 405 contracts", () => {
  it.each([
    "./artists/ArtistForm.tsx", "./releases/ReleaseForm.tsx",
    "./ops-tasks/OpsTaskForm.tsx", "./budget/BudgetItemForm.tsx", "./royalties/RoyaltyForm.tsx",
  ])("associates explicit labels with instance-safe controls in %s", (path) => {
    const text = source(path);
    expect(text).toContain("useId()");
    const labels = [...text.matchAll(/htmlFor=\{(`[^`]+`)\}/g)];
    expect(labels.length).toBeGreaterThan(0);
    for (const [, id] of labels) expect(text).toContain(`id={${id}}`);
    for (const control of text.matchAll(/<(input|select|textarea)\b([^>]+)>/g)) {
      expect(control[2]).toMatch(/\bid=\{/);
    }
  });

  it("names roster search independently of placeholder copy", () => {
    expect(source("./artists/ArtistRoster.tsx")).toContain('aria-label="Search artists"');
    expect(source("./releases/ReleaseRoster.tsx")).toContain('aria-label="Search releases"');
  });


});
