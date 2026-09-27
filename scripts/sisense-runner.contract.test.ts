import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

describe("Sisense Dokploy runner contract", () => {
  it("keeps a supervised idle Playwright runner available for explicit Dokploy commands", async () => {
    const [composeSource, dockerfile] = await Promise.all([
      readFile(new URL("../compose.prod.yml", import.meta.url), "utf8"),
      readFile(new URL("../Dockerfile.sisense-worker", import.meta.url), "utf8"),
    ]);
    const compose = parse(composeSource) as {
      services?: Record<string, { command?: string[]; profiles?: string[]; restart?: string; healthcheck?: { test?: string[] } }>;
    };
    const runner = compose.services?.["label-suite-sisense-sync"];

    expect(runner).toBeDefined();
    expect(runner?.profiles).toBeUndefined();
    expect(runner?.restart).toBe("unless-stopped");
    expect(runner?.command).toEqual(["sh", "-c", "while :; do sleep 3600; done"]);
    expect(runner?.command?.join(" ")).not.toMatch(/sisense:(?:sync|scrape)|--apply/);
    expect(runner?.healthcheck?.test).toEqual([
      "CMD",
      "node",
      "-e",
      "const fs=require('node:fs'); const revision=fs.readFileSync('/app/.release-revision','utf8').trim(); process.exit(/^[0-9a-f]{40}$/.test(revision) ? 0 : 1);",
    ]);
    expect(dockerfile).toContain('CMD ["sh", "-c", "while :; do sleep 3600; done"]');
  });
});
