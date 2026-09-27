import { describe, expect, it, vi } from "vitest";
vi.mock("../lib/db", () => ({ db: {} }));
import {
  assertWorkspaceLinks,
  assertSameFundingProject,
  assertSameGrant,
  buildGrantsWorkspacePayload,
  isSubmittedDecision,
  isPipelineApplication,
  createFundingNeedSchema,
  createGrantApplicationRequirementSchema,
  createGrantApplicationDocumentSchema,
  createGrantDeadlineSchema,
  replaceApplicationFundingNeedsSchema,
  replaceGrantApplicationRequirementsSchema,
} from "./grants-workspace";

describe("grants workspace validation", () => {
  it("exposes active workspace members with their role for application ownership", () => {
    const payload = buildGrantsWorkspacePayload({
      projects: [], profiles: [], fundingSources: [], budgetLines: [], needs: [], needBudgetLines: [], allocations: [],
      applications: [], opportunities: [], deadlines: [], requirements: [], applicationRequirements: [], applicationDocuments: [], documents: [],
      members: [{ id: "user-1", name: "Malthe", role: "fundraiser" }],
    });

    expect(payload.members).toEqual([{ id: "user-1", name: "Malthe", role: "fundraiser" }]);
  });

  it("prefers a member owner while retaining the legacy contact owner fallback", () => {
    const payload = buildGrantsWorkspacePayload({
      projects: [], profiles: [], fundingSources: [], budgetLines: [], needs: [], needBudgetLines: [], allocations: [],
      applications: [
        { id: "member-owned", outcome: "rejected", submitted_at: "2026-01-01", owner_user_id: "user-1", owner_name: "Member Name", owner_contact_id: null },
        { id: "legacy-owned", outcome: "rejected", submitted_at: "2026-01-01", owner_user_id: null, owner_name: "Legacy Contact", owner_contact_id: "contact-1" },
      ], opportunities: [], deadlines: [], requirements: [], applicationRequirements: [], applicationDocuments: [], documents: [],
      members: [{ id: "user-1", name: "Member Name", role: "fundraiser" }],
    });

    expect(payload.applications).toEqual([
      expect.objectContaining({ id: "member-owned", ownerUserId: "user-1", ownerName: "Member Name" }),
      expect.objectContaining({ id: "legacy-owned", ownerUserId: null, ownerContactId: "contact-1", ownerName: "Legacy Contact" }),
    ]);
  });

  it("only exposes submitted applications with a decided outcome", () => {
    expect(isSubmittedDecision({ submitted_at: "2026-01-01", outcome: "approved" })).toBe(true);
    expect(isSubmittedDecision({ submitted_at: "2026-01-01", outcome: "rejected" })).toBe(true);
    expect(isSubmittedDecision({ workflow_stage: "submitted", outcome: "approved" })).toBe(true);
    expect(isSubmittedDecision({ submitted_at: "2026-01-01", outcome: "unknown" })).toBe(false);
    expect(isSubmittedDecision({ submitted_at: null, outcome: "approved" })).toBe(false);
  });

  it("only exposes pipeline rows with real work to do", () => {
    expect(isPipelineApplication({ outcome: "unknown", workflow_stage: "writing", amount_requested: 20_000 })).toBe(true);
    expect(isPipelineApplication({ outcome: "unknown", workflow_stage: "research", next_action: "Confirm eligibility" })).toBe(true);
    expect(isPipelineApplication({ outcome: "unknown", workflow_stage: "writing", amount_requested: 0, next_action: null })).toBe(false);
    expect(isPipelineApplication({ outcome: "approved", workflow_stage: "writing", amount_requested: 20_000 })).toBe(false);
    expect(isPipelineApplication({ outcome: "unknown", workflow_stage: "closed", amount_requested: 20_000 })).toBe(false);
  });

  it("does not treat an undecided or unsent row as application history", () => {
    const payload = buildGrantsWorkspacePayload({
      projects: [], profiles: [], fundingSources: [], budgetLines: [], needs: [], needBudgetLines: [], allocations: [],
      applications: [
        { id: "draft", outcome: "unknown", workflow_stage: "writing" },
        { id: "unsent-decision", outcome: "rejected", workflow_stage: "closed", submitted_at: null },
        { id: "declined", outcome: "rejected", workflow_stage: "idea", submitted_at: "2026-01-01", amount_awarded: null },
        { id: "submitted-without-date", outcome: "approved", workflow_stage: "submitted", submitted_at: null, amount_awarded: 7_500 },
      ],
      opportunities: [], deadlines: [], requirements: [], applicationRequirements: [], applicationDocuments: [], documents: [],
    });

    expect(payload.applications.map((application) => application.id)).toEqual(["declined", "submitted-without-date"]);
    expect(payload.applications[0]).toMatchObject({
      workflowStage: "closed",
      amountRequestedRecorded: false,
      amountAwarded: 0,
      amountAwardedRecorded: true,
    });
  });

  it("surfaces the MXD award expense follow-up without inventing a due date", () => {
    const payload = buildGrantsWorkspacePayload({
      projects: [], profiles: [], fundingSources: [], budgetLines: [], needs: [], needBudgetLines: [], allocations: [],
      applications: [{
        id: "mxd-application", grant_id: "mxd-grant", workflow_stage: "submitted", outcome: "approved",
        submitted_at: "2026-06-01", amount_requested: 10_000, amount_awarded: 7_500,
        next_action: "Document expenses", next_action_due: null, reporting_due: null,
      }],
      opportunities: [{ id: "mxd-grant", name: "Støtte til markedsudvikling", funder: "MXD", currency: "DKK" }],
      deadlines: [], requirements: [], applicationRequirements: [], applicationDocuments: [], documents: [],
    });

    expect(payload.applications).toHaveLength(1);
    expect(payload.applications[0]).toMatchObject({
      id: "mxd-application",
      nextAction: "Document expenses",
      nextActionDue: null,
      amountAwarded: 7_500,
      reportingDue: null,
    });
  });

  it("accepts canonical funding need and recurring deadline values", () => {
    expect(createFundingNeedSchema.parse({
      project_id: "project-1",
      title: "Video production",
      category: "video",
      target_amount: 125_000,
      eligibility: "grant_eligible",
    })).toMatchObject({ category: "video", eligibility: "grant_eligible" });

    expect(createGrantDeadlineSchema.parse({
      grant_id: "grant-1",
      deadline_date: "2026-10-01",
      label: "Autumn round",
    })).toMatchObject({ grant_id: "grant-1", deadline_date: "2026-10-01" });
  });

  it("keeps requirement readiness separate from whether it is required", () => {
    expect(createGrantApplicationRequirementSchema.parse({
      application_id: "application-1",
      requirement_id: "requirement-1",
      required: true,
      readiness_status: "missing",
    })).toMatchObject({ required: true, readiness_status: "missing" });

    expect(createGrantApplicationDocumentSchema.parse({
      application_id: "application-1",
      document_id: "document-1",
      asset_role: "submitted_application",
      required: true,
      readiness_status: "ready",
    })).toMatchObject({ asset_role: "submitted_application", readiness_status: "ready" });
  });

  it("validates atomic allocation and checklist replacements", () => {
    expect(replaceApplicationFundingNeedsSchema.parse({
      application_id: "application-1",
      allocations: [{ funding_need_id: "need-1", amount_requested: 25_000 }],
    }).allocations).toHaveLength(1);
    expect(replaceGrantApplicationRequirementsSchema.parse({
      application_id: "application-1",
      requirements: [{ requirement_id: "requirement-1", readiness_status: "ready" }],
    }).requirements[0]).toMatchObject({ requirement_id: "requirement-1", readiness_status: "ready" });
  });

  it("rejects a linked record outside the active organization", async () => {
    const lookup = vi.fn(async (_orgId: string, kind: string, id: string) =>
      kind === "project" && id === "foreign-project" ? false : true,
    );

    await expect(assertWorkspaceLinks("true-nature", {
      project: "foreign-project",
      grant: "grant-1",
    }, lookup)).rejects.toThrow("Project not found in active workspace");

    expect(lookup).toHaveBeenCalledWith("true-nature", "project", "foreign-project");
  });

  it("rejects allocations between records from different funding projects", () => {
    expect(() => assertSameFundingProject("project-1", "project-2", "Funding need and application"))
      .toThrow("Funding need and application must belong to the same project");
  });

  it("rejects checklist requirements from a different grant", () => {
    expect(() => assertSameGrant("grant-1", "grant-2"))
      .toThrow("Requirement must belong to the application's selected grant");
    expect(() => assertSameGrant(null, "grant-1"))
      .toThrow("Requirement must belong to the application's selected grant");
    expect(() => assertSameGrant("grant-1", "grant-1")).not.toThrow();
  });

  it("derives project funding from the shared coverage model (sources + awarded applications)", () => {
    const payload = buildGrantsWorkspacePayload({
      projects: [{ id: "project-1", name: "Fountain video", status: "active", currency: "DKK", total_planned: 100_000, baseline_funding: 5_000, artist_name: "True Blue", release_title: "Fountain" }],
      profiles: [{ project_id: "project-1", priority: "high", target_date: "2026-09-01", goal: "Finish and launch the video", owner_name: "Malthe" }],
      fundingSources: [
        { project_id: "project-1", status: "confirmed", amount_confirmed: 20_000, amount_planned: 20_000 },
        { project_id: "project-1", status: "pending", amount_confirmed: 0, amount_planned: 30_000 },
      ],
      needs: [{ id: "need-1", project_id: "project-1", title: "Production", category: "video", use_of_funds: "Crew and equipment", target_amount: 80_000, eligibility: "grant_eligible", needed_by: "2026-08-15" }],
      needBudgetLines: [{ funding_need_id: "need-1" }],
      allocations: [{ application_id: "app-1", funding_need_id: "need-1", amount_requested: 30_000, amount_awarded: 0 }],
      applications: [{ id: "app-1", project_id: "project-1", grant_id: "grant-1", owner_name: "Malthe", workflow_stage: "writing", outcome: "approved", priority: "high", amount_requested: 30_000, amount_awarded: 90_000, next_action: "Finish budget", next_action_due: "2026-07-20", submission_deadline: "2026-08-01", submitted_at: "2026-07-01", decision_date: null, reporting_due: null }],
      opportunities: [{ id: "grant-1", name: "Video support", funder: "Fund", program: null, category: "video", status: "open", deadline: "2026-08-01", opens_on: null, max_amount: 50_000, currency: "DKK", requirements: "Budget", url: "https://example.com" }],
      deadlines: [{ id: "round-1", grant_id: "grant-1", deadline_date: "2026-09-17", label: "Round 3", classification: "confirmed", source_url: "https://example.com/round", deadline_time: "15:00", timezone: "Europe/Copenhagen", opens_on: "2026-08-27", expected_response_date: "2026-12-17", status: "planned" }],
      requirements: [{ id: "req-1", grant_id: "grant-1", required: true }],
      applicationRequirements: [{ application_id: "app-1", requirement_id: "req-1", required: true, readiness_status: "missing", document_id: null }],
      applicationDocuments: [],
      documents: [],
    }, { currentDate: "2026-07-12" });

    expect(payload.projects[0]).toMatchObject({
      // 20k confirmed source + 90k awarded application (no confirmed source records it yet)
      confirmedFunding: 110_000,
      // 30k pending source, weighted at 50%
      pendingFunding: 15_000,
      remainingGap: 0,
      nextAction: "Finish budget",
      assetReadiness: { missing: 1, total: 1 },
    });
    expect(payload.projects[0].coverage).toEqual(expect.objectContaining({
      projectId: "project-1",
      budgetTotal: 100_000,
      confirmed: 110_000,
      pipelineNominal: 30_000,
      pipelineWeighted: 15_000,
      gap: 0,
      expectedGap: 0,
    }));
    expect(payload.projects[0].needs[0]).toMatchObject({
      confirmedAmount: 0,
      pendingAmount: 0,
      remainingGap: 80_000,
      reconciled: true,
    });
    expect(payload.opportunities[0].matchingProjectIds).toEqual(["project-1"]);
    expect(payload.opportunities[0].deadlineRounds).toEqual([expect.objectContaining({
      id: "round-1", date: "2026-09-17", classification: "confirmed", deadlineTime: "15:00", timezone: "Europe/Copenhagen",
    })]);
    expect(payload.projects[0].suggestedMatches?.[0]).toEqual(expect.objectContaining({ opportunityId: "grant-1" }));
    expect(payload.calendarEvents.map((event) => event.kind)).toEqual(expect.arrayContaining(["action", "deadline"]));
  });

  it("uses the nearest active future round and excludes closed or expired opportunities from matching", () => {
    const payload = buildGrantsWorkspacePayload({
      projects: [{ id: "project-1", name: "Fountain", currency: "DKK", total_planned: 100_000, baseline_funding: 0 }],
      profiles: [], fundingSources: [], budgetLines: [],
      needs: [{ id: "need-1", project_id: "project-1", title: "Video", category: "video", target_amount: 50_000 }],
      needBudgetLines: [], allocations: [], applications: [],
      opportunities: [
        { id: "open", name: "Open video fund", category: "video", status: "open", currency: "DKK", deadline: "2026-01-01", applicant_type: "Independent labels", research_status: "verified", research_summary: "Strong fit for audiovisual work", last_verified_at: "2026-07-01T12:00:00Z" },
        { id: "closed", name: "Closed video fund", category: "video", status: "closed", currency: "DKK", deadline: "2027-01-01" },
        { id: "expired", name: "Expired video fund", category: "video", status: "open", currency: "DKK", deadline: "2026-01-01" },
      ],
      deadlines: [
        { id: "past", grant_id: "open", deadline_date: "2026-06-01", status: "closed" },
        { id: "later", grant_id: "open", deadline_date: "2027-02-01", status: "planned" },
        { id: "nearest", grant_id: "open", deadline_date: "2026-09-01", status: "open" },
      ],
      requirements: [], applicationRequirements: [], applicationDocuments: [], documents: [],
    }, { currentDate: "2026-07-12" });

    expect(payload.opportunities.find((item) => item.id === "open")).toMatchObject({
      deadline: "2026-09-01",
      matchingProjectIds: ["project-1"],
      applicantType: "Independent labels",
      researchStatus: "verified",
      researchSummary: "Strong fit for audiovisual work",
      lastVerifiedAt: "2026-07-01",
    });
    expect(payload.opportunities.find((item) => item.id === "closed")?.matchingProjectIds).toEqual([]);
    expect(payload.opportunities.find((item) => item.id === "expired")?.matchingProjectIds).toEqual([]);
    expect(payload.projects[0].topMatch?.opportunityId).toBe("open");
  });

  it("generates missing readiness from grant requirements when an application checklist is absent", () => {
    const payload = buildGrantsWorkspacePayload({
      projects: [], profiles: [], fundingSources: [], budgetLines: [], needs: [], needBudgetLines: [], allocations: [],
      applications: [{ id: "app-1", grant_id: "grant-1", workflow_stage: "writing", outcome: "rejected", submitted_at: "2026-07-01" }],
      opportunities: [{ id: "grant-1", name: "Creative fund", status: "open", currency: "DKK" }],
      deadlines: [],
      requirements: [
        { id: "req-1", grant_id: "grant-1", name: "Budget", required: true, asset_role: "budget" },
        { id: "req-2", grant_id: "grant-1", name: "Optional press", required: false, asset_role: "other" },
      ],
      applicationRequirements: [], applicationDocuments: [], documents: [],
    }, { currentDate: "2026-07-12" });

    expect(payload.applications[0].assetReadiness).toEqual({ ready: 0, total: 1, missing: 1, stale: 0 });
  });

  it("merges inherited requirements with partial and custom application checklist rows", () => {
    const payload = buildGrantsWorkspacePayload({
      projects: [], profiles: [], fundingSources: [], budgetLines: [], needs: [], needBudgetLines: [], allocations: [],
      applications: [{ id: "app-1", grant_id: "grant-1", workflow_stage: "writing", outcome: "rejected", submitted_at: "2026-07-01" }],
      opportunities: [{ id: "grant-1", name: "Fund", currency: "DKK" }], deadlines: [],
      requirements: [
        { id: "req-1", grant_id: "grant-1", required: true, asset_role: "budget" },
        { id: "req-2", grant_id: "grant-1", required: true, asset_role: "artist_bio" },
      ],
      applicationRequirements: [
        { application_id: "app-1", requirement_id: "req-1", required: true, readiness_status: "ready" },
        { application_id: "app-1", requirement_id: null, required: true, readiness_status: "stale", notes: "Custom letter" },
      ],
      applicationDocuments: [], documents: [],
    });
    expect(payload.applications[0].assetReadiness).toEqual({ ready: 1, total: 3, missing: 1, stale: 1 });
    expect(payload.applications[0].checklist).toEqual([
      expect.objectContaining({ requirementId: "req-1", readinessStatus: "ready" }),
      expect.objectContaining({ requirementId: "req-2", readinessStatus: "missing" }),
      expect.objectContaining({ requirementId: null, readinessStatus: "stale" }),
    ]);
  });

  it("includes unlinked grant documents in the asset library", () => {
    const payload = buildGrantsWorkspacePayload({
      projects: [], profiles: [], fundingSources: [], budgetLines: [], needs: [], needBudgetLines: [], allocations: [],
      applications: [], opportunities: [], deadlines: [], requirements: [], applicationRequirements: [], applicationDocuments: [],
      documents: [{ id: "doc-1", name: "Label biography", doc_type: "artist_bio", status: "ready", updated_at: "2026-07-12" }],
    });
    expect(payload.assets).toEqual([expect.objectContaining({ id: "doc-1", readiness: "ready", applicationNames: [] })]);
  });
});
