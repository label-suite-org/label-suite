import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";

it("keeps optional reporting history failures from rejecting the release route", async () => {
  const page = readFileSync(new URL("./[id].astro", import.meta.url), "utf8");
  const expression = page.match(/const sisense = ([\s\S]*?);\nconst samplyReview/)!;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const evaluate = new AsyncFunction("release", "getReleaseSisenseSection", "orgId", "id", "console", `return ${expression[1]};`);
  const read = vi.fn().mockRejectedValue(new Error("Sensitive fixture diagnostic"));
  const error = vi.fn();
  await expect(evaluate({ id: "release-a" }, read, "tenant-a", "release-a", { error })).resolves.toBeNull();
  expect(read).toHaveBeenCalledWith("tenant-a", "release-a");
  expect(error).toHaveBeenCalledWith("Release reporting history unavailable", { errorType: "Error" });
});
