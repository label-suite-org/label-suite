import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../drizzle/0080_invitation_auth_bootstrap.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"));

describe("invitation authentication bootstrap migration", () => {
  it("registers the additive migration after dashboard preferences", () => {
    expect(journal.entries.find((entry: { tag: string }) => entry.tag === "0080_invitation_auth_bootstrap")).toEqual({
      idx: 72,
      version: "7",
      when: 1786140000021,
      tag: "0080_invitation_auth_bootstrap",
      breakpoints: true,
    });
  });

  it("allows only exact-digest bootstrap reads and grants no bootstrap writes", () => {
    expect(migration).toMatch(/CREATE POLICY "org_invitations_authentication_bootstrap"[\s\S]*FOR SELECT/i);
    expect(migration).toMatch(/"token_digest"\s*=\s*nullif\(current_setting\('app\.current_invitation_token_digest', true\), ''\)/i);
    expect(migration).not.toMatch(/org_invitations_authentication_bootstrap[\s\S]*FOR (?:INSERT|UPDATE|DELETE|ALL)/i);
    expect(migration).not.toMatch(/BYPASSRLS|DISABLE ROW LEVEL SECURITY|SECURITY DEFINER/i);
  });
});
