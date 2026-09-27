import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GrantsFundingCockpit from "./GrantsFundingCockpit";
import {
  ApplicationsView,
  AssetsView,
  CalendarReportingView,
  GrantsCatalogView,
} from "./GrantsWorkspaceViews";
import { GrantApplicationDrawer } from "./GrantApplicationDrawer";
import { validateNewApplication } from "./GrantApplicationDrawer";
import { FundingNeedModal, GrantOpportunityModal } from "./GrantOperatingModals";
import GrantsWorklistView from "./GrantsWorklistView";
import { formatApplicationSortDate, parseGrantRules, sortApplications } from "./grants-workspace-ui";
import type {
  FundingProjectView,
  GrantApplicationView,
  GrantOpportunityView,
  GrantsWorkspacePayload,
} from "./grants-workspace-ui";

const emptyWorkspace: GrantsWorkspacePayload = {
  projects: [],
  applications: [],
  opportunities: [],
  assets: [],
  calendarEvents: [],
};

describe("GrantsFundingCockpit", () => {
  it("sorts applications by selected recorded date and keeps missing dates last", () => {
    const rows = [
      { id: "old", submittedAt: "2026-06-01", decisionDate: "2026-08-01", applicationDeadline: "2026-09-01" },
      { id: "undated", submittedAt: null, decisionDate: null, applicationDeadline: null },
      { id: "new", submittedAt: "2026-07-01", decisionDate: "2026-07-15", applicationDeadline: "2026-08-15" },
    ] as GrantApplicationView[];

    expect(sortApplications(rows, "submitted_desc").map((row) => row.id)).toEqual(["new", "old", "undated"]);
    expect(sortApplications(rows, "decision_desc").map((row) => row.id)).toEqual(["old", "new", "undated"]);
    expect(sortApplications(rows, "deadline_asc").map((row) => row.id)).toEqual(["new", "old", "undated"]);
    expect(sortApplications([
      { ...rows[0], id: "tie-a", submittedAt: "2026-06-01" },
      { ...rows[0], id: "tie-b", submittedAt: "2026-06-01" },
    ], "submitted_desc").map((row) => row.id)).toEqual(["tie-a", "tie-b"]);
    expect(formatApplicationSortDate(rows[1], "submitted")).toBe("Date not recorded");
  });

  it("treats malformed grant rules as unstructured research instead of crashing", () => {
    expect(parseGrantRules("not-json")).toBeNull();
    expect(parseGrantRules(JSON.stringify({ commercial_allowed: true }))).toMatchObject({ commercialAllowed: true, playbook: null });
  });

  it("exposes all five workspace views from the primary navigation", () => {
    const html = renderToStaticMarkup(<GrantsFundingCockpit workspace={emptyWorkspace} />);

    expect(html).toContain("Funding plan");
    expect(html).toContain("Applications");
    expect(html).toContain("Grants");
    expect(html).not.toContain(">Opportunities<");
    expect(html).toContain("Assets");
    expect(html).toContain("Calendar &amp; reporting");
  });

  it("exposes fundraiser funding-profile, recurring-deadline, and supporting-document workflows", () => {
    const html = renderToStaticMarkup(<GrantsFundingCockpit workspace={emptyWorkspace} canMutate />);
    expect(html).toContain("Funding profile");
    expect(html).toContain("Recurring grant deadline");
    expect(html).toContain("Supporting documents");
  });

  it("renders source-labelled evidence roles and recoverable extraction states in the application drawer", () => {
    const application = {
      id: "app-1", name: "Submitted application", projectId: null, projectName: null, opportunityId: null, opportunityName: null,
      workflowStage: "closed", outcome: "approved", priority: "medium", currency: "DKK", amountRequested: 0, amountAwarded: 0,
      assetReadiness: { ready: 0, total: 0, missing: 0, stale: 0 }, documents: [
        { id: "doc-link-1", documentId: "doc-1", name: "Submitted application.pdf", fileLink: "org-1/grant-applications/app-1/attachments/application.pdf", assetRole: "submitted_application", linkType: "attachment", required: true, readinessStatus: "ready", extractionStatus: "ready", extractionError: null, extractedTextPreview: "Source text", extractionId: "ex-1", sourceHash: "hash-1" },
        { id: "doc-link-2", documentId: "doc-2", name: "Award letter.pdf", fileLink: "org-1/grant-applications/app-1/attachments/award.pdf", assetRole: "award_decision", linkType: "attachment", required: false, readinessStatus: "draft", extractionStatus: "failed", extractionError: "Parser failed", extractedTextPreview: null, extractionId: "ex-2", sourceHash: "hash-2" },
      ], writingGuide: [{ title: "Submitted application evidence", source: "Submitted application.pdf", content: "Source text", status: "ready" }],
    } as GrantApplicationView;
    const html = renderToStaticMarkup(<GrantApplicationDrawer seed={{ application }} projects={[]} opportunities={[]} onClose={() => undefined} onSaved={() => undefined} />);
    expect(html).toContain("Application evidence");
    expect(html).toContain("Award-decision letter");
    expect(html).toContain("Extraction failed: Parser failed");
    expect(html).toContain("Source: Submitted application.pdf");
  });

  it("explains the operational purpose when no funding projects exist", () => {
    const html = renderToStaticMarkup(<GrantsFundingCockpit workspace={emptyWorkspace} />);

    expect(html).toContain("What needs doing");
    expect(html).toContain("Open Budget");
  });

  it("renders useful empty states for every operational view", () => {
    const applications = renderToStaticMarkup(<ApplicationsView applications={[]} />);
    const grants = renderToStaticMarkup(<GrantsCatalogView grants={[]} applications={[]} projects={[]} />);
    const assets = renderToStaticMarkup(<AssetsView assets={[]} />);
    const calendar = renderToStaticMarkup(<CalendarReportingView events={[]} />);

    expect(applications).toContain("No applications match this filter");
    expect(grants).toContain("No grants match your search");
    expect(assets).toContain("No grant materials match this view");
    expect(calendar).toContain("No grant dates are scheduled yet");
  });

  it("offers separate pipeline and decided history views", () => {
    const html = renderToStaticMarkup(<ApplicationsView applications={[]} />);
    expect(html).toContain("Pipeline");
    expect(html).toContain("History");
  });

  it("renders the prioritized worklist with an action completion control", () => {
    const html = renderToStaticMarkup(<GrantsWorklistView applications={[{
      id: "app-1", name: "Fountain application", projectId: "project-1", projectName: "Fountain",
      opportunityId: null, opportunityName: null, ownerName: "Malthe", workspaceView: "pipeline",
      workflowStage: "writing", outcome: "unknown", priority: "high", currency: "DKK",
      amountRequested: 20_000, amountAwarded: 0, nextAction: "Finish treatment", nextActionDue: "2026-07-15",
      applicationDeadline: "2026-07-30", submittedAt: null, decisionDate: null, reportingDue: null,
      assetReadiness: { ready: 0, total: 0, missing: 0, stale: 0 },
    }]} today="2026-07-14" onEdit={() => undefined} onComplete={() => undefined} />);
    expect(html).toContain("What needs doing");
    expect(html).toContain("Finish treatment");
    expect(html).toContain("Mark done");
  });

  it("shows every application attempt linked to a reusable grant", () => {
    const grant = {
      id: "grant-1",
      name: "Nordic Music Fund",
      funder: "Nordic Culture Point",
      program: "Culture and art programme",
      purposes: ["recording"],
      applicantType: "Label",
      status: "open",
      researchStatus: "verified",
      researchSummary: "Supports cross-border music projects.",
      deadline: "2026-11-01",
      opensOn: null,
      maxAmount: 250_000,
      currency: "DKK",
      requirements: "Two Nordic partners",
      officialUrl: null,
      lastVerifiedAt: "2026-07-10",
      matchReasons: [],
      matchingProjectIds: ["project-fountain", "project-lambs"],
    } satisfies GrantOpportunityView;
    const projects = [
      { id: "project-fountain", name: "Fountain video" },
      { id: "project-lambs", name: "Lambs album" },
    ] as FundingProjectView[];
    const applications = [
      {
        id: "application-1",
        opportunityId: grant.id,
        opportunityName: grant.name,
        projectId: "project-fountain",
        projectName: "Fountain video",
        applicationDeadline: "2026-09-15",
        workflowStage: "writing",
        outcome: "unknown",
        amountRequested: 80_000,
        amountAwarded: 0,
        currency: "DKK",
      },
      {
        id: "application-2",
        opportunityId: grant.id,
        opportunityName: grant.name,
        projectId: "project-lambs",
        projectName: "Lambs album",
        applicationDeadline: "2026-10-20",
        workflowStage: "closed",
        outcome: "approved",
        amountRequested: 120_000,
        amountAwarded: 100_000,
        currency: "DKK",
      },
    ] as GrantApplicationView[];

    const html = renderToStaticMarkup(
      <GrantsCatalogView grants={[grant]} applications={applications} projects={projects} onStartApplication={() => undefined} />,
    );

    expect(html).toContain("2 applications");
    expect(html).toContain("Fountain video");
    expect(html).toContain("Sep 15, 2026");
    expect(html).toContain("Lambs album");
    expect(html).toContain("Oct 20, 2026");
    expect(html).toContain("Record sent application");
    const linked = renderToStaticMarkup(<GrantsFundingCockpit workspace={{ ...emptyWorkspace, opportunities: [
      { ...grant, id: "other", name: "Other grant", requirements: "Other requirements" }, grant,
    ] }} initialGrantId={grant.id} />);
    expect(linked).toContain('id="grant-grant-1"');
    expect(linked).toContain("Two Nordic partners");
    expect(linked).not.toContain("Other requirements");
    const missing = renderToStaticMarkup(<GrantsFundingCockpit workspace={emptyWorkspace} initialGrantId="unavailable" />);
    expect(missing).toContain("The linked grant is no longer available in this workspace.");
  });

  it("shows enriched eligibility rules, playbook, and deadline provenance in grant detail", () => {
    const grant = {
      id: "grant-enriched",
      name: "Nordic Music Fund",
      funder: "Nordic Culture Point",
      program: "Culture and art programme",
      purposes: ["recording"],
      applicantType: "ApS / forening / individual",
      status: "open",
      researchStatus: "verified",
      researchSummary: "Supports cross-border music projects.",
      deadline: "2026-09-17",
      opensOn: "2026-08-27",
      maxAmount: 250_000,
      currency: "DKK",
      requirements: "Budget and work sample",
      officialUrl: "https://example.com/apply",
      researchUrl: "https://example.com/guidelines",
      lastVerifiedAt: "2026-07-13",
      matchReasons: ["Supports recording"],
      matchingProjectIds: [],
      rules: JSON.stringify({
        aps_eligible: true,
        forening_eligible: false,
        individual_eligible: true,
        commercial_allowed: true,
        revenue_generating_allowed: true,
        co_financing_required: true,
        self_financing_required: true,
        in_kind_accepted: false,
        career_stage: "Professional",
        geography: "Denmark → EU",
        genre_restrictions: "Rock/pop",
        payment_schedule: "After approval",
        payment_timing: "after_costs",
        recurrence_type: "annual",
        recurrence_notes: "One annual round",
        playbook: {
          preparation_timeline: "Start 4 weeks before",
          required_assets: ["Budget", "CV"],
          common_traps: ["Late submission"],
          tips: "Keep the project scope concrete.",
          owner: "Malthe",
        },
      }),
      deadlineRounds: [{
        id: "round-1",
        date: "2026-09-17",
        label: "Round 3",
        classification: "confirmed",
        deadlineTime: "15:00",
        timezone: "Europe/Copenhagen",
        sourceUrl: "https://example.com/rounds",
        opensOn: "2026-08-27",
        expectedResponseDate: "2026-12-17",
        status: "planned",
      }],
    } satisfies GrantOpportunityView;

    const html = renderToStaticMarkup(<GrantsCatalogView grants={[grant]} applications={[]} projects={[]} />);

    expect(html).toContain("Commercial use allowed");
    expect(html).toContain("Confirmed");
    expect(html).toContain("15:00 Europe/Copenhagen");
    expect(html).toContain("Application playbook");
    expect(html).toContain("Budget");
    expect(html).toContain("Official source");
  });

  it("exposes independent application filters and creation control", () => {
    const applications = [{
      id: "application-1",
      name: "Nordic Music Fund — Fountain video",
      opportunityName: "Nordic Music Fund",
      projectName: "Fountain video",
      workflowStage: "closed",
      outcome: "rejected",
      submittedAt: "2026-07-01",
      amountRequested: 80_000,
      amountAwarded: 0,
      currency: "DKK",
      assetReadiness: { ready: 0, total: 0, missing: 0, stale: 0 },
    }, {
      id: "application-2",
      name: "Unrecorded application",
      opportunityName: "Unrecorded grant",
      projectName: "Fountain video",
      workflowStage: "writing",
      outcome: "unknown",
      submittedAt: null,
      amountRequested: 0,
      amountAwarded: 0,
      currency: "DKK",
      assetReadiness: { ready: 0, total: 0, missing: 0, stale: 0 },
    }] as GrantApplicationView[];
    const html = renderToStaticMarkup(<ApplicationsView applications={applications} onCreate={() => undefined} />);

    expect(html).toContain("Pipeline");
    expect(html).toContain("History");
    expect(html).toContain("Filter applications by outcome");
    expect(html).toContain("Filter applications by owner");
    expect(html).toContain("Sort applications by date");
    expect(html).toContain("Submitted date");
    expect(html).toContain("Date not recorded");
    expect(html).toContain("Record sent application");
  });

  it("exposes the complete create application form", () => {
    const html = renderToStaticMarkup(
      <GrantApplicationDrawer seed={{}} projects={[]} opportunities={[]} members={[{ id: "user-1", name: "Malthe", role: "fundraiser" }]} onClose={() => undefined} onSaved={() => undefined} />,
    );

    expect(html).toContain("Record sent application");
    expect(html).toContain("Application grant");
    expect(html).toContain("No grant linked");
    expect(html).toContain("Workflow stage");
    expect(html).toContain("Outcome");
    expect(html).toContain("Amount requested");
    expect(html).toContain("Submission deadline");
    expect(html).toContain("Expected decision");
    expect(html).toContain("Reporting due");
    expect(html).toContain("Application owner");
    expect(html).toContain("Malthe (fundraiser)");
    expect(html).toContain("Funding-need allocation");
    expect(html).toContain("Angle / narrative");
    expect(html).toContain("Requirement readiness");
    expect(html).toContain("Source folder");
  });

  it("requires a sent and decided outcome when recording a new application", () => {
    expect(validateNewApplication({ workflowStage: "idea", outcome: "unknown" })).toContain("Choose Submitted");
    expect(validateNewApplication({ workflowStage: "submitted", outcome: "unknown" })).toContain("Choose Approved");
    expect(validateNewApplication({ workflowStage: "submitted", outcome: "approved" })).toBeNull();
  });

  it("exposes full grant research fields for creation and editing", () => {
    const createHtml = renderToStaticMarkup(<GrantOpportunityModal onClose={() => undefined} onSaved={() => undefined} />);
    const editHtml = renderToStaticMarkup(
      <GrantOpportunityModal
        opportunity={{
          id: "grant-1",
          name: "Nordic Music Fund",
          funder: null,
          program: null,
          purposes: [],
          applicantType: null,
          status: "open",
          researchStatus: "research",
          researchSummary: null,
          deadline: null,
          opensOn: null,
          maxAmount: null,
          currency: "DKK",
          requirements: null,
          officialUrl: null,
          lastVerifiedAt: null,
          matchReasons: [],
          matchingProjectIds: [],
        }}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );

    expect(createHtml).toContain("New grant");
    expect(editHtml).toContain("Edit grant");
    expect(createHtml).toContain("Eligible uses");
    expect(createHtml).toContain("Assessment body");
    expect(createHtml).toContain("Response timing");
    expect(createHtml).toContain("Eligibility and requirements");
  });

  it("creates a grant-facing need from a funding project", () => {
    const project = { id: "project-1", name: "Fountain music video", currency: "DKK" } as FundingProjectView;
    const html = renderToStaticMarkup(<FundingNeedModal project={project} onClose={() => undefined} onSaved={() => undefined} />);

    expect(html).toContain("New funding need");
    expect(html).toContain("Target amount (DKK)");
    expect(html).toContain("Grant eligibility");
    expect(html).toContain("Success measure");
  });

  it("exposes asset role, owner, project, readiness, and freshness filters", () => {
    const html = renderToStaticMarkup(<AssetsView assets={[]} />);

    expect(html).toContain("Filter assets by type / role");
    expect(html).toContain("Filter assets by owner");
    expect(html).toContain("Filter assets by project");
    expect(html).toContain("Filter assets by readiness");
    expect(html).toContain("Filter assets by freshness");
  });
});
