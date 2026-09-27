import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("operator PR 409 contracts", () => {
  it("keeps reduced-motion overrides scoped to the user preference", () => {
    const text = source("../styles/global.css");
    const reduced = text.slice(text.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain(":where(*, *::before, *::after)");
    for (const rule of ["scroll-behavior: auto !important", "animation-duration: 0.01ms !important", "animation-iteration-count: 1 !important", "transition-duration: 0.01ms !important"]) {
      expect(reduced).toContain(rule);
    }
  });


});
