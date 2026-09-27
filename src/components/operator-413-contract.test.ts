import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("operator PR 413 contracts", () => {
  it("keeps the glossary in the authenticated app layout with semantic definitions", () => {
    const text = source("../pages/help.astro");
    expect(text).toContain("<AppLayout>");
    expect(text).toContain('<nav aria-label="Glossary sections"');
    expect(text).toContain("<dl");
    for (const term of ["P0", "P3", "PRO", "IPI", "ISRC", "Sisense", "Airtable mapping", "Stale", "Partial", "Proposed", "Reviewed"]) expect(text).toContain(term);
  });


});
