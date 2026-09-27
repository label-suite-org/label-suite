import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = dirname(fileURLToPath(import.meta.url));

const decomposedModules = [
  "server/grants-workspace.ts",
  "server/grants-workspace-core.ts",
  "server/grants-workspace-query.ts",
  "server/grants-workspace-mutations.ts",
  "components/settings/SettingsShell.tsx",
  "components/settings/SettingsControls.tsx",
  "components/settings/WorkspaceSettings.tsx",
  "components/settings/MemberSettings.tsx",
  "components/settings/OperationsSettings.tsx",
  "components/contacts/ContactsBook.tsx",
  "components/contacts/ContactControls.tsx",
  "components/contacts/ContactDetails.tsx",
  "components/contacts/ContactEnrichment.tsx",
] as const;

function readSource(relativePath: string) {
  return readFileSync(resolve(sourceRoot, relativePath), "utf8");
}

describe("decomposed module boundaries", () => {
  it("keeps every decomposed implementation below the 700-line hard limit", () => {
    for (const relativePath of decomposedModules) {
      expect(readSource(relativePath).split("\n").length, relativePath).toBeLessThanOrEqual(700);
    }
  });

  it("keeps compatibility entry points out of their implementation dependency graph", () => {
    const children = decomposedModules.filter(
      (relativePath) => !["server/grants-workspace.ts", "components/settings/SettingsShell.tsx", "components/contacts/ContactsBook.tsx"].includes(relativePath),
    );

    for (const relativePath of children) {
      const source = readSource(relativePath);
      expect(source, relativePath).not.toMatch(/from\s+["'].\/grants-workspace["']/);
      expect(source, relativePath).not.toMatch(/from\s+["'].\/SettingsShell["']/);
      expect(source, relativePath).not.toMatch(/from\s+["'].\/ContactsBook["']/);
    }
  });
});
