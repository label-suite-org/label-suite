import { describe, expect, it } from "vitest";
import {
  formatGrantsV2ImportOutput,
  prepareGrantsV2Apply,
  resolveAirtableCliInvocation,
  shouldFallbackToConfiguredCli,
} from "./airtable-grants-v2";
import { buildGrantsV2Plan, type AirtableSnapshot } from "./airtable-grants-core";

const emptySnapshot: AirtableSnapshot = {
  baseId: "app26JltxTyf40Fcp",
  tables: { Grants: [], Applications: [], Projects: [], Assets: [] },
};

describe("Grants V2 CLI safety", () => {
  it("uses the installed Airtable CLI without downloading a mutable package", () => {
    expect(resolveAirtableCliInvocation({}).command).toMatch(/node_modules\/\.bin\/airtable-mcp$/);
    expect(resolveAirtableCliInvocation({ AIRTABLE_MCP_BIN: "/opt/homebrew/bin/airtable-mcp" })).toEqual({
      command: "/opt/homebrew/bin/airtable-mcp",
      prefixArgs: [],
    });
  });

  it("falls back to configured CLI auth only when an environment token is rejected", () => {
    expect(shouldFallbackToConfiguredCli({ status: 401 })).toBe(true);
    expect(shouldFallbackToConfiguredCli({ status: 403 })).toBe(true);
    expect(shouldFallbackToConfiguredCli({ status: 500 })).toBe(false);
    expect(shouldFallbackToConfiguredCli(new Error("network down"))).toBe(false);
  });

  it("prints a summary by default and only emits the full plan explicitly", () => {
    const plan = buildGrantsV2Plan(emptySnapshot);
    const summary = formatGrantsV2ImportOutput(plan, false);
    const full = formatGrantsV2ImportOutput(plan, true);

    expect(summary).not.toContain('"operations": [');
    expect(summary).toContain('"targets"');
    expect(full).toContain('"operations": [');
  });

  it("refuses non-whitelisted targets so Budget projects can never be created", () => {
    const plan = buildGrantsV2Plan(emptySnapshot);
    plan.operations.push({
      action: "create", targetTable: "budget_projects", targetId: "bad", idempotencyKey: "bad",
      fingerprint: "bad", sourceTable: "Projects", sourceRecordId: "recProject", row: { id: "bad" },
    });
    expect(() => prepareGrantsV2Apply(plan, { grants: [], applications: [], documents: [] }))
      .toThrow(/non-whitelisted.*budget_projects/);
  });

  it("reconciles primary records and remaps dependent foreign keys in dependency order", () => {
    const snapshot: AirtableSnapshot = {
      baseId: emptySnapshot.baseId,
      tables: {
        Grants: [{ id: "recGrant", fields: { Name: "  Culture-Fund ", Who: "City Council", "Deadline 1": "2027-01-01" } }],
        Projects: [{ id: "recProject", fields: { "Project Name": "Record" } }],
        Applications: [{
          id: "recApplication",
          fields: {
            ID: "APP-42", "Link to Grants": ["recGrant"], "Link to Projects": ["recProject"],
            Assets: ["recAsset"], "What this grant pays for": ["Production"],
          },
        }],
        Assets: [{ id: "recAsset", fields: { "Asset Name": "Press Bio", Type: "PDF", Content: "Ready" } }],
      },
    };
    const plan = buildGrantsV2Plan(snapshot, {}, { projectReconciliation: { recProject: "budget-1" } });
    const result = prepareGrantsV2Apply(plan, {
      grants: [{ id: "existing-grant", name: "culture fund", funder: "CITY COUNCIL" }],
      applications: [{ id: "existing-app", external_reference: "app 42" }],
      documents: [{ id: "existing-doc", name: "press-bio", doc_type: "pdf" }],
    });
    const tables = result.operations.map((operation) => operation.targetTable);
    expect(tables).toEqual([...tables].sort((a, b) => [
      "grants", "grant_deadlines", "grant_requirements", "project_funding_profiles", "documents",
      "funding_needs", "grant_applications", "grant_application_funding_needs", "grant_application_documents",
    ].indexOf(a) - [
      "grants", "grant_deadlines", "grant_requirements", "project_funding_profiles", "documents",
      "funding_needs", "grant_applications", "grant_application_funding_needs", "grant_application_documents",
    ].indexOf(b)));
    expect(result.operations.find((operation) => operation.targetTable === "grants")?.targetId).toBe("existing-grant");
    expect(result.operations.find((operation) => operation.targetTable === "grant_deadlines")?.row.grant_id).toBe("existing-grant");
    expect(result.operations.find((operation) => operation.targetTable === "grant_applications")?.targetId).toBe("existing-app");
    expect(result.operations.find((operation) => operation.targetTable === "grant_applications")?.row.grant_id).toBe("existing-grant");
    const documentLink = result.operations.find((operation) => operation.targetTable === "grant_application_documents");
    expect(documentLink?.row.application_id).toBe("existing-app");
    expect(documentLink?.row.document_id).toBe("existing-doc");
  });

  it("prefers an existing source mapping and reports ambiguous semantic matches", () => {
    const snapshot: AirtableSnapshot = {
      ...emptySnapshot,
      tables: { ...emptySnapshot.tables, Grants: [{ id: "recGrant", fields: { Name: "Fund", Who: "Funder" } }] },
    };
    const result = prepareGrantsV2Apply(buildGrantsV2Plan(snapshot), {
      grants: [
        { id: "grant-a", name: "Fund", funder: "Funder" },
        { id: "grant-b", name: "Fund", funder: "Funder" },
      ],
      applications: [], documents: [], sourceMappings: { "Grants:recGrant": "grant-b" },
    });
    expect(result.operations[0].targetId).toBe("grant-b");
    expect(result.exceptions).toHaveLength(0);
  });

  it("blocks ambiguous semantic matches without an explicit source mapping", () => {
    const snapshot: AirtableSnapshot = {
      ...emptySnapshot,
      tables: { ...emptySnapshot.tables, Grants: [{ id: "recGrant", fields: { Name: "Fund", Who: "Funder" } }] },
    };
    expect(() => prepareGrantsV2Apply(buildGrantsV2Plan(snapshot), {
      grants: [
        { id: "grant-a", name: "Fund", funder: "Funder" },
        { id: "grant-b", name: "Fund", funder: "Funder" },
      ],
      applications: [], documents: [],
    })).toThrow(/ambiguous.*explicit source mapping/i);
  });

  it("updates the existing profile for a reconciled project instead of hitting the unique key", () => {
    const snapshot: AirtableSnapshot = {
      ...emptySnapshot,
      tables: { ...emptySnapshot.tables, Projects: [{ id: "recProject", fields: { "Project Name": "Fountain" } }] },
    };
    const plan = buildGrantsV2Plan(snapshot, {}, { projectReconciliation: { recProject: "project-1" } });
    const result = prepareGrantsV2Apply(plan, {
      grants: [], applications: [], documents: [],
      projectFundingProfiles: [{ id: "profile-existing", project_id: "project-1" }],
    });
    expect(result.operations.find((item) => item.targetTable === "project_funding_profiles")?.targetId).toBe("profile-existing");
  });
});
