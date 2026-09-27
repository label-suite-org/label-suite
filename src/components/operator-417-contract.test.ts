import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("operator PR 417 contracts", () => {
  it("retains the explicit minimum classes on the corrected controls", () => {
    const timeline = source("./releases/ReleaseTimeline.tsx");
    expect(timeline.match(/className="min-h-8 px-2 /g)).toHaveLength(2);
    expect(timeline).toContain("grid size-6 shrink-0 place-items-center");
    expect(source("./grants/GrantsWorkspaceViews.tsx")).toContain("inline-flex size-8 shrink-0 items-center justify-center");
  });
});
