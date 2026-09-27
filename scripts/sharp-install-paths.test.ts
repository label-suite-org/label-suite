import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const installPaths = [
  ".github/workflows/verify.yml",
  "Dockerfile",
  "Dockerfile.full",
  "Dockerfile.sisense-worker",
];

describe("Sharp prebuilt installation configuration", () => {
  it("applies the global-libvips opt-out to every supported install path", async () => {
    await Promise.all(installPaths.map(async (path) => {
      const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
      expect(source).toMatch(/SHARP_IGNORE_GLOBAL_LIBVIPS(?:=|:)\s*["']?1/);
    }));

    const ci = await readFile(new URL("../.github/workflows/verify.yml", import.meta.url), "utf8");
    expect(ci).toContain('SHARP_IGNORE_GLOBAL_LIBVIPS: "1"');
  });
});
