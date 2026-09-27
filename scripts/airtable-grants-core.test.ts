import { describe, expect, it } from "vitest";

import {
  buildGrantsV2Plan,
  characterizeGrantsV2Snapshot,
  normalizeAirtableCliRecords,
  summarizeGrantsV2Plan,
  renderGrantsV2ParityMarkdown,
  type AirtableSnapshot,
} from "./airtable-grants-core";

const snapshot: AirtableSnapshot = {
  baseId: "app26JltxTyf40Fcp",
  tables: {
    Grants: [
      {
        id: "recGrant",
        fields: {
          Name: "Export fund",
          Who: "MXD",
          Category: ["Export", "Marketing"],
          "Deadline 1": "2026-09-01",
          "Deadline 2": "2027-02-01",
          "Max Amount": 50000,
          "Hvad Skal Ansøgningen Indeholde": "Budget and project description",
          "Hvem Kan Søge": "Independent labels",
          "Hvad Kan Man Søge Til": "Recording and audiovisual production",
          "Hvem vurderer din ansøgning": "Expert panel",
          "Hvornår får man svar": "Eight weeks",
          Rules: "One application per round",
        },
      },
    ],
    Projects: [
      {
        id: "recProject",
        fields: {
          "Project Name": "True Blue — Fountain music video",
          Status: "Active",
          "Total Budget Needed": 120000,
          "Target Date": "2026-11-01",
          "Goal (Summary)": "Produce and launch the Fountain video.",
          "Budget Breakdown": "Production 80,000; promotion 40,000",
          "Export Markets": ["DK", "US"],
          Deliverables: "Master video and cutdowns",
          "Evaluation / Success Metrics": "Views and press coverage",
        },
      },
    ],
    Applications: [
      {
        id: "recApplication",
        fields: {
          ID: "2026-09-01 - Export fund",
          "Link to Projects": ["recProject"],
          "Link to Grants": ["recGrant"],
          Owner: "Malthe",
          Priority: "High",
          Status: "Approved",
          "Workflow Stage": "Submitted",
          "Amount Applied For": 30000,
          Deadline: "2026-09-01",
          "Date Submitted": "2026-08-30",
          "What this grant pays for": ["video", "content"],
          Assets: ["recAsset"],
          "Next Action": "Prepare reporting pack",
        },
      },
    ],
    Assets: [
      {
        id: "recAsset",
        fields: {
          "Asset Name": "Fountain treatment",
          Type: "Project Description",
          Content: "Treatment body",
          "Last Updated": "2026-07-01",
          Applications: ["recApplication"],
        },
      },
    ],
  },
};

describe("Grants V2 Airtable characterization", () => {
  it("normalizes configured CLI field IDs into source field names", () => {
    expect(normalizeAirtableCliRecords(
      [{ id: "fldName", name: "Name" }, { id: "fldGrant", name: "Link to Grants" }],
      [{
        id: "recApp",
        createdTime: "2026-07-12T00:00:00.000Z",
        cellValuesByFieldId: {
          fldName: "Application",
          fldGrant: [{ id: "recGrant", name: "Grant" }],
        },
      }],
    )).toEqual([{
      id: "recApp",
      createdTime: "2026-07-12T00:00:00.000Z",
      fields: {
        Name: "Application",
        "Link to Grants": [{ id: "recGrant", name: "Grant" }],
      },
    }]);
  });

  it("reports source counts, completeness, normalized deadlines, and explicit exceptions", () => {
    const report = characterizeGrantsV2Snapshot(snapshot);

    expect(report.counts).toEqual({ grants: 1, applications: 1, projects: 1, assets: 1 });
    expect(report.normalizedDeadlineCount).toBe(2);
    expect(report.completeness.applications.workflowStage).toEqual({ present: 1, total: 1 });
    expect(report.completeness.applications.outcome).toEqual({ present: 1, total: 1 });
    expect(report.exceptions).toEqual([]);
  });

  it("renders a reviewable parity and exception report", () => {
    const report = characterizeGrantsV2Snapshot(snapshot, {
      grants: 85,
      applications: 46,
      projects: 8,
      assets: 34,
    });
    const markdown = renderGrantsV2ParityMarkdown(report);

    expect(markdown).toContain("# Grants V2 Airtable Parity Report");
    expect(markdown).toContain("| Grants | 1 | 85 | mismatch |");
    expect(markdown).toContain("## Explicit Exceptions");
    expect(markdown).toContain("source_count_mismatch");
    expect(markdown).toContain("No source record is silently dropped");
  });

  it("never silently drops missing and ambiguous links", () => {
    const broken: AirtableSnapshot = {
      ...snapshot,
      tables: {
        ...snapshot.tables,
        Applications: [
          { id: "missing", fields: { ID: "No links", Status: "To Do" } },
          {
            id: "ambiguous",
            fields: {
              ID: "Two projects",
              "Link to Projects": ["recProject", "recOther"],
              "Link to Grants": ["recUnknownGrant"],
              Status: "Mystery result",
              "Workflow Stage": "Mystery stage",
            },
          },
        ],
      },
    };

    const report = characterizeGrantsV2Snapshot(broken);
    expect(report.exceptions.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "missing_project_link",
        "missing_grant_link",
        "ambiguous_project_link",
        "unresolved_grant_link",
        "unknown_outcome",
        "unknown_workflow_stage",
      ]),
    );
    expect(report.exceptions.every((item) => item.sourceRecordId.length > 0)).toBe(true);
  });
});

describe("Grants V2 idempotent import plan", () => {
  const projectReconciliation = { recProject: "budget-project-fountain" };

  it("maps the full workspace onto an explicitly reconciled Budget project and keeps workflow stage separate from outcome", () => {
    const plan = buildGrantsV2Plan(snapshot, {}, { projectReconciliation });

    expect(plan.operationsByTarget.grants).toHaveLength(1);
    expect(plan.operationsByTarget.grants[0].row).toMatchObject({
      research_status: "imported",
      applicant_type: "Independent labels",
      eligible_uses: "Recording and audiovisual production",
      assessment_body: "Expert panel",
      response_timing: "Eight weeks",
      rules: "One application per round",
    });
    expect(plan.operationsByTarget.grant_deadlines).toHaveLength(2);
    expect(plan.operationsByTarget.budget_projects).toHaveLength(0);
    expect(plan.operationsByTarget.project_funding_profiles).toHaveLength(1);
    expect(plan.operationsByTarget.grant_applications).toHaveLength(1);
    expect(plan.operationsByTarget.documents).toHaveLength(1);
    expect(plan.operationsByTarget.grant_application_documents).toHaveLength(1);
    expect(plan.operationsByTarget.grant_requirements).toHaveLength(1);

    const application = plan.operationsByTarget.grant_applications[0].row;
    expect(application.workflow_stage).toBe("submitted");
    expect(application.outcome).toBe("approved");
    expect(application.project_id).toBe("budget-project-fountain");
    expect(application.grant_id).toBe(plan.operationsByTarget.grants[0].targetId);
    expect(summarizeGrantsV2Plan(plan)).toMatchObject({
      targets: {
        grants: 1,
        grant_deadlines: 2,
        grant_applications: 1,
        documents: 1,
      },
    });
  });

  it("leaves Airtable projects unmapped by default instead of creating duplicate Budget projects", () => {
    const plan = buildGrantsV2Plan(snapshot);

    expect(plan.operationsByTarget.budget_projects).toHaveLength(0);
    expect(plan.operationsByTarget.project_funding_profiles).toHaveLength(0);
    expect(plan.operationsByTarget.grant_applications[0].row.project_id).toBeNull();
    expect(plan.exceptions).toContainEqual(expect.objectContaining({
      code: "unmapped_project_reconciliation",
      sourceTable: "Projects",
      sourceRecordId: "recProject",
    }));
  });

  it("splits requested amounts across purposes and gives each need a non-null sufficient target", () => {
    const plan = buildGrantsV2Plan(snapshot, {}, { projectReconciliation });
    const allocations = plan.operationsByTarget.grant_application_funding_needs;
    const needs = plan.operationsByTarget.funding_needs;

    expect(allocations).toHaveLength(2);
    expect(allocations.map((item) => item.row.amount_requested)).toEqual([15_000, 15_000]);
    expect(allocations.every((item) => typeof item.row.amount_requested === "number")).toBe(true);
    expect(needs).toHaveLength(2);
    for (const need of needs) {
      const allocated = allocations
        .filter((item) => item.row.funding_need_id === need.targetId)
        .reduce((sum, item) => sum + Number(item.row.amount_requested), 0);
      expect(typeof need.row.target_amount).toBe("number");
      expect(Number(need.row.target_amount)).toBeGreaterThanOrEqual(allocated);
    }
  });

  it("never turns transient Airtable attachment URLs into durable document links", () => {
    const withAttachment: AirtableSnapshot = structuredClone(snapshot);
    withAttachment.tables.Assets[0].fields.File = [{
      id: "attSigned",
      filename: "fountain-treatment.pdf",
      url: "https://v5.airtableusercontent.com/v3/u/signed-and-expiring",
      type: "application/pdf",
    }];

    const document = buildGrantsV2Plan(withAttachment).operationsByTarget.documents[0].row;
    expect(document.file_link).toBeNull();
    expect(JSON.stringify(document)).not.toContain("airtableusercontent.com");
  });

  it("uses deterministic keys and classifies repeats as unchanged or update", () => {
    const first = buildGrantsV2Plan(snapshot, {}, { projectReconciliation });
    const known = Object.fromEntries(
      first.operations.map((operation) => [operation.idempotencyKey, operation.fingerprint]),
    );
    const second = buildGrantsV2Plan(snapshot, known, { projectReconciliation });

    expect(second.summary).toMatchObject({ create: 0, update: 0, unchanged: first.operations.length });
    expect(second.operations.map((operation) => operation.targetId)).toEqual(
      first.operations.map((operation) => operation.targetId),
    );

    const changed: AirtableSnapshot = structuredClone(snapshot);
    changed.tables.Applications[0].fields["Next Action"] = "Submit final report";
    const third = buildGrantsV2Plan(changed, known, { projectReconciliation });
    expect(third.summary.update).toBe(1);
    expect(third.operations.find((operation) => operation.action === "update")?.targetTable).toBe(
      "grant_applications",
    );
  });

  it("keeps derived funding-need identity stable when application order changes", () => {
    const withSecondApplication: AirtableSnapshot = structuredClone(snapshot);
    withSecondApplication.tables.Applications.push({
      id: "recEarlierApplication",
      fields: {
        ID: "Earlier export application",
        "Link to Projects": ["recProject"],
        "Link to Grants": ["recGrant"],
        "Workflow Stage": "Writing",
        Status: "To Do",
        "What this grant pays for": ["video"],
      },
    });
    const reversed: AirtableSnapshot = structuredClone(withSecondApplication);
    reversed.tables.Applications.reverse();

    const firstNeed = buildGrantsV2Plan(withSecondApplication, {}, { projectReconciliation }).operationsByTarget.funding_needs[0];
    const reversedNeed = buildGrantsV2Plan(reversed, {}, { projectReconciliation }).operationsByTarget.funding_needs[0];
    expect(reversedNeed.idempotencyKey).toBe(firstNeed.idempotencyKey);
    expect(reversedNeed.targetId).toBe(firstNeed.targetId);
  });

  it("plans unmatched applications with null links instead of silently dropping them", () => {
    const unmatched: AirtableSnapshot = structuredClone(snapshot);
    unmatched.tables.Applications = [{
      id: "recUnmatched",
      fields: { ID: "Historical application", Status: "Rejected", "Workflow Stage": "Closed" },
    }];

    const plan = buildGrantsV2Plan(unmatched);
    expect(plan.operationsByTarget.grant_applications).toHaveLength(1);
    expect(plan.operationsByTarget.grant_applications[0].row).toMatchObject({
      project_id: null,
      grant_id: null,
      workflow_stage: "closed",
      outcome: "rejected",
    });
    expect(plan.exceptions.map((item) => item.code)).toEqual(
      expect.arrayContaining(["missing_project_link", "missing_grant_link"]),
    );
  });

  it("preserves every application even when all 46 have nullable project and grant links", () => {
    const historical: AirtableSnapshot = {
      ...snapshot,
      tables: {
        Grants: [], Projects: [], Assets: [],
        Applications: Array.from({ length: 46 }, (_, index) => ({
          id: `recHistorical${index}`,
          fields: { ID: `Historical ${index}`, Status: "Rejected", "Workflow Stage": "Closed" },
        })),
      },
    };

    const plan = buildGrantsV2Plan(historical);
    expect(plan.operationsByTarget.grant_applications).toHaveLength(46);
    expect(plan.operationsByTarget.grant_applications.every((operation) =>
      operation.row.project_id === null && operation.row.grant_id === null,
    )).toBe(true);
  });
});
