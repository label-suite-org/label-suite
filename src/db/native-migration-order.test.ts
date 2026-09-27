import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("applies pending native migrations after the deployed artist portal", () => {
  const { entries } = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"));
  const portalIndex = entries.findIndex((entry: { tag: string }) => entry.tag === "0093_artist_portal");
  const [portal, tasks, uploads] = entries.slice(portalIndex, portalIndex + 3);
  expect(portal).toMatchObject({ idx: 85, when: 1790424000000 });
  expect(tasks.tag).toBe("0094_native_task_authority");
  expect(uploads.tag).toBe("0095_private_resource_uploads");
  expect(tasks.idx).toBe(portal.idx + 1);
  expect(uploads.idx).toBe(tasks.idx + 1);
  // Drizzle skips migrations at or before the last applied timestamp.
  expect(tasks.when).toBeGreaterThan(portal.when);
  expect(uploads.when).toBeGreaterThan(tasks.when);
});
