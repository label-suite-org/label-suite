import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const npmCli = process.env.npm_execpath;
const { SISENSE_RECENT_DATE_RANGE: _recentRange, ...baseEnvironment } = process.env;

describe("Sisense recent range", () => {
  it("uses the Yesterday custom-range default for an unconfigured recent import", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-recent-"));
    const csvPath = path.join(directory, "shazams-city.csv");
    await writeFile(csvPath, "City,Shazams\nCopenhagen,1\n");

    try {
      const { stdout, stderr } = await execFileAsync(process.execPath, [npmCli!, "run", "sisense:sync", "--", "--mode", "import", "--recent", "--file", csvPath], {
        cwd: projectRoot,
        env: { ...baseEnvironment, DATABASE_URL: "" },
      });

      expect(`${stdout}${stderr}`).toContain("Range: Yesterday");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
