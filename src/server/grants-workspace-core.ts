import { computeCoverageForProjects, type ProjectFundingCoverage } from "./funding-coverage-core";
import { buildApplicationWritingGuide } from "./grant-application-guidance";

export type WorkspaceWorkflowStage = "idea" | "research" | "writing" | "ready_to_submit" | "submitted" | "decision_pending" | "reporting" | "closed";
const WorkspaceWorkflowStageValues = new Set<WorkspaceWorkflowStage>(["idea", "research", "writing", "ready_to_submit", "submitted", "decision_pending", "reporting", "closed"]);
export type WorkspaceApplicationOutcome = "unknown" | "approved" | "partially_approved" | "rejected" | "withdrawn" | "not_qualified";
export type WorkspaceApplicationView = "pipeline" | "history";
export type WorkspaceAssetReadiness = { ready: number; total: number; missing: number; stale: number };
export type WorkspaceFundingNeed = { id: string; title: string; category: string; description: string | null; targetAmount: number; confirmedAmount: number; pendingAmount: number; remainingGap: number; eligibility: "grant_eligible" | "mixed" | "not_eligible" | "unknown"; priority: "low" | "medium" | "high" | "urgent"; status: "planned" | "active" | "funded" | "cancelled"; successMeasure: string | null; neededBy: string | null; reconciled: boolean };
export type WorkspaceOpportunityMatch = { opportunityId: string; name: string; funder: string | null; deadline: string | null; maxAmount: number | null; currency: string; reasons: string[]; cautions: string[] };
export type WorkspaceFundingProject = { id: string; name: string; status: string | null; priority: string | null; artistName: string | null; releaseTitle: string | null; ownerName: string | null; currency: string; totalBudget: number; confirmedFunding: number; pendingFunding: number; remainingGap: number; coverage: ProjectFundingCoverage; targetDate: string | null; goal: string | null; nextAction: string | null; nextActionDue: string | null; needs: WorkspaceFundingNeed[]; applicationIds: string[]; assetReadiness: WorkspaceAssetReadiness; topMatch: WorkspaceOpportunityMatch | null; suggestedMatches: WorkspaceOpportunityMatch[] };
export type WorkspaceApplicationAllocation = { id: string; fundingNeedId: string; amountRequested: number; amountAwarded: number };
export type WorkspaceApplicationChecklistItem = { id: string; requirementId: string | null; requirementName: string | null; assetRole: string | null; documentId: string | null; documentName: string | null; required: boolean; readinessStatus: string; notes: string | null };
export type WorkspaceApplicationDocument = { id: string; documentId: string; name: string; fileLink: string | null; assetRole: string; linkType: string; required: boolean; readinessStatus: string; extractionStatus: string | null; extractionError: string | null; extractedTextPreview: string | null; extractionId: string | null; sourceHash: string | null };
export type WorkspaceGrantApplication = { id: string; name: string; projectId: string | null; projectName: string | null; opportunityId: string | null; opportunityName: string | null; ownerUserId: string | null; ownerContactId: string | null; ownerName: string | null; workspaceView: WorkspaceApplicationView; workflowStage: WorkspaceWorkflowStage; outcome: WorkspaceApplicationOutcome; priority: string | null; currency: string; amountRequested: number; amountAwarded: number; amountRequestedRecorded: boolean; amountAwardedRecorded: boolean; nextAction: string | null; nextActionDue: string | null; applicationDeadline: string | null; submittedAt: string | null; decisionDate: string | null; reportingDue: string | null; angleNarrative: string | null; responseNotes: string | null; evaluation: string | null; nextStepRecommendation: string | null; sourceFolder: string | null; externalReference: string | null; notes: string | null; allocations: WorkspaceApplicationAllocation[]; checklist: WorkspaceApplicationChecklistItem[]; documents: WorkspaceApplicationDocument[]; writingGuide: ReturnType<typeof buildApplicationWritingGuide>; assetReadiness: WorkspaceAssetReadiness };
export type WorkspaceGrantDeadlineRound = { id: string; date: string; label: string | null; classification: string; sourceUrl: string | null; deadlineTime: string | null; timezone: string | null; opensOn: string | null; expectedResponseDate: string | null; status: string | null };
export type WorkspaceGrantOpportunity = { id: string; name: string; funder: string | null; program: string | null; purposes: string[]; applicantType: string | null; description: string | null; priority: string | null; notes: string | null; eligibleUses: string | null; assessmentBody: string | null; responseTiming: string | null; rules: string | null; status: string | null; researchStatus: string | null; researchSummary: string | null; researchSource: string | null; researchUrl: string | null; deadline: string | null; opensOn: string | null; maxAmount: number | null; currency: string; requirements: string | null; officialUrl: string | null; lastVerifiedAt: string | null; matchReasons: string[]; matchingProjectIds: string[]; deadlineRounds: WorkspaceGrantDeadlineRound[] };
export type WorkspaceGrantAsset = { id: string; name: string; role: string; ownerName: string | null; projectName: string | null; readiness: "ready" | "missing" | "stale" | "draft"; lastUpdatedAt: string | null; applicationNames: string[]; href: string | null };
export type WorkspaceGrantCalendarEvent = { id: string; kind: "opening" | "deadline" | "action" | "submission" | "decision" | "reporting"; title: string; context: string | null; date: string | null; status: string | null; href: string | null };
export type WorkspaceMemberChoice = { id: string; name: string; role: string };
export type GrantsWorkspacePayload = { projects: WorkspaceFundingProject[]; applications: WorkspaceGrantApplication[]; opportunities: WorkspaceGrantOpportunity[]; assets: WorkspaceGrantAsset[]; calendarEvents: WorkspaceGrantCalendarEvent[]; contacts: Array<{ id: string; name: string }>; members: WorkspaceMemberChoice[] };

type WorkspaceRows = {
  projects: any[];
  profiles: any[];
  fundingSources: any[];
  budgetLines?: any[];
  needs: any[];
  needBudgetLines: any[];
  allocations: any[];
  applications: any[];
  opportunities: any[];
  deadlines: any[];
  requirements: any[];
  applicationRequirements: any[];
  applicationDocuments: any[];
  extractions?: any[];
  documents: any[];
  contacts?: any[];
  members?: any[];
};

const EMPTY_READINESS: WorkspaceAssetReadiness = { ready: 0, total: 0, missing: 0, stale: 0 };
const VALID_OUTCOMES = new Set<WorkspaceApplicationOutcome>(["unknown", "approved", "partially_approved", "rejected", "withdrawn", "not_qualified"]);

/** Only a submitted application with a recorded decision belongs in the history view.
 * A workflow stage of `submitted` is valid submission evidence when the date was
 * not recorded (for example, an award imported from an email). We still keep the
 * date nullable in the UI rather than inventing one.
 */
export function isSubmittedDecision(row: { submitted_at?: unknown; workflow_stage?: unknown; outcome?: unknown }): boolean {
  const hasSubmissionEvidence = Boolean(row.submitted_at) || String(row.workflow_stage) === "submitted";
  return hasSubmissionEvidence && ["approved", "partially_approved", "rejected"].includes(String(row.outcome));
}

/** Keep imported drafts out of the work queue unless they contain actionable data. */
export function isPipelineApplication(row: { workflow_stage?: unknown; outcome?: unknown; amount_requested?: unknown; next_action?: unknown }): boolean {
  const stage = String(row.workflow_stage ?? "idea");
  return String(row.outcome ?? "unknown") === "unknown"
    && stage !== "closed"
    && stage !== "reporting"
    && (amount(row.amount_requested) > 0 || Boolean(String(row.next_action ?? "").trim()));
}

function amount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function purposes(value: unknown): string[] {
  return String(value ?? "").split(/[,;/|]/).map((item) => item.trim()).filter(Boolean);
}

function isClosedOpportunityStatus(value: string): boolean {
  return ["closed", "cancelled", "expired", "inactive"].some((status) => value.includes(status));
}

function applicationReadiness(application: any, rows: WorkspaceRows): WorkspaceAssetReadiness {
  const applicationId = application.id;
  const applicationChecklist = rows.applicationRequirements.filter((row) => row.application_id === applicationId);
  const linkedDocuments = rows.applicationDocuments.filter((row) => row.application_id === applicationId && row.readiness_status !== "not_required");
  const requiredDocuments = rows.applicationDocuments.filter((row) => row.application_id === applicationId && row.required && row.readiness_status !== "not_required");
  const checklistByRequirement = new Map(
    applicationChecklist.filter((row) => row.requirement_id).map((row) => [row.requirement_id, row]),
  );
  const inheritedRequirements = !application.grant_id
    ? []
    : rows.requirements
      .filter((row) => row.grant_id === application.grant_id && row.required !== false)
      .map((requirement) => {
        const checklist = checklistByRequirement.get(requirement.id);
        if (checklist) return checklist;
        const matchingDocument = requirement.asset_role
          ? linkedDocuments.find((document) => document.asset_role === requirement.asset_role)
          : undefined;
        return { readiness_status: matchingDocument?.readiness_status ?? "missing" };
      });
  const customRequirements = applicationChecklist.filter((row) => !row.requirement_id && row.required !== false && row.readiness_status !== "not_required");
  const materialRows = inheritedRequirements.length || customRequirements.length
    ? [...inheritedRequirements, ...customRequirements]
    : requiredDocuments;
  return materialRows.reduce<WorkspaceAssetReadiness>((result, row) => {
    result.total += 1;
    if (row.readiness_status === "ready") result.ready += 1;
    else if (row.readiness_status === "stale") result.stale += 1;
    else result.missing += 1;
    return result;
  }, { ...EMPTY_READINESS });
}

export function applicationChecklistFor(application: any, rows: Pick<WorkspaceRows, "applicationRequirements" | "requirements" | "documents">): WorkspaceApplicationChecklistItem[] {
  const applicationRows = rows.applicationRequirements.filter((item) => item.application_id === application.id);
  const byRequirement = new Map(applicationRows.filter((item) => item.requirement_id).map((item) => [item.requirement_id, item]));
  const inherited = rows.requirements.filter((item) => item.grant_id === application.grant_id && item.required !== false).map((requirement) =>
    byRequirement.get(requirement.id) ?? { id: `inherited:${requirement.id}`, requirement_id: requirement.id, document_id: null, required: true, readiness_status: "missing", notes: null },
  );
  return [...inherited, ...applicationRows.filter((item) => !item.requirement_id)].map((item) => {
    const requirement = rows.requirements.find((candidate) => candidate.id === item.requirement_id);
    const document = rows.documents.find((candidate) => candidate.id === item.document_id);
    return {
      id: item.id, requirementId: item.requirement_id ?? null, requirementName: requirement?.name ?? null,
      assetRole: requirement?.asset_role ?? null, documentId: item.document_id ?? null, documentName: document?.name ?? null,
      required: item.required !== false, readinessStatus: item.readiness_status ?? "missing", notes: item.notes ?? null,
    };
  });
}

export function buildGrantsWorkspacePayload(
  rows: WorkspaceRows,
  options: { currentDate?: string } = {},
): GrantsWorkspacePayload {
  const currentDate = options.currentDate ?? new Date().toISOString().slice(0, 10);
  const projectsById = new Map(rows.projects.map((row) => [row.id, row]));
  const profilesByProject = new Map(rows.profiles.map((row) => [row.project_id, row]));
  const pipelineApplicationRows = rows.applications.filter(isPipelineApplication);
  const historyApplicationRows = rows.applications.filter(isSubmittedDecision);
  const visibleApplicationRows = [...pipelineApplicationRows, ...historyApplicationRows.filter((row) => !pipelineApplicationRows.some((pipeline) => pipeline.id === row.id))];
  const applicationsById = new Map(visibleApplicationRows.map((row) => [row.id, row]));
  const opportunitiesById = new Map(rows.opportunities.map((row) => [row.id, row]));
  const deadlinesByGrant = new Map<string, any[]>();
  for (const row of rows.deadlines) deadlinesByGrant.set(row.grant_id, [...(deadlinesByGrant.get(row.grant_id) ?? []), row]);
  for (const deadlines of deadlinesByGrant.values()) deadlines.sort((a, b) => String(a.deadline_date).localeCompare(String(b.deadline_date)));

  const readinessByApplication = new Map(visibleApplicationRows.map((row) => [row.id, applicationReadiness(row, rows)]));
  const applications: WorkspaceGrantApplication[] = visibleApplicationRows.map((row) => {
    const opportunity = row.grant_id ? opportunitiesById.get(row.grant_id) : null;
    const project = row.project_id ? projectsById.get(row.project_id) : null;
    const applicationView: WorkspaceApplicationView = isPipelineApplication(row) ? "pipeline" : "history";
    const stage = applicationView === "pipeline"
      ? (WorkspaceWorkflowStageValues.has(String(row.workflow_stage) as WorkspaceWorkflowStage) ? String(row.workflow_stage) : "idea") as WorkspaceWorkflowStage
      : "closed" as WorkspaceWorkflowStage;
    const outcome = VALID_OUTCOMES.has(row.outcome) ? row.outcome : "unknown";
    const checklist = applicationChecklistFor(row, rows);
    const documents = rows.applicationDocuments.filter((link) => link.application_id === row.id).map((link) => {
      const document = rows.documents.find((candidate) => candidate.id === link.document_id);
      const extraction = (rows.extractions ?? [])
        .filter((candidate) => candidate.document_id === link.document_id)
        .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))[0];
      return {
        id: link.id, documentId: link.document_id, name: document?.name ?? "Grant document", fileLink: document?.file_link ?? null,
        assetRole: link.asset_role ?? "other", linkType: link.link_type ?? "attachment", required: link.required !== false,
        readinessStatus: link.readiness_status ?? "missing", extractionStatus: extraction?.status ?? null, extractionError: extraction?.error ?? null,
        extractedTextPreview: extraction?.extracted_text ? String(extraction.extracted_text).slice(0, 1000) : null, extractionId: extraction?.id ?? null, sourceHash: extraction?.source_hash ?? null,
      };
    });
    return {
      id: row.id,
      name: opportunity?.name ?? project?.name ?? "Grant application",
      projectId: row.project_id ?? null,
      projectName: project?.name ?? null,
      opportunityId: row.grant_id ?? null,
      opportunityName: opportunity?.name ?? null,
      ownerUserId: row.owner_user_id ?? null,
      ownerContactId: row.owner_contact_id ?? null,
      ownerName: row.member_name ?? row.owner_name ?? null,
      workspaceView: applicationView,
      workflowStage: stage,
      outcome,
      priority: row.priority ?? null,
      currency: opportunity?.currency ?? project?.currency ?? "DKK",
      amountRequested: amount(row.amount_requested),
      amountAwarded: amount(row.amount_awarded),
      amountRequestedRecorded: row.amount_requested != null,
      // A declined application necessarily received nothing, even when the
      // source row did not explicitly store a zero award amount.
      amountAwardedRecorded: row.amount_awarded != null || outcome === "rejected",
      nextAction: row.next_action ?? null,
      nextActionDue: isoDate(row.next_action_due),
      applicationDeadline: isoDate(row.submission_deadline ?? opportunity?.deadline),
      submittedAt: isoDate(row.submitted_at),
      decisionDate: isoDate(row.decision_date),
      reportingDue: isoDate(row.reporting_due),
      angleNarrative: row.angle_narrative ?? null,
      responseNotes: row.response_notes ?? null,
      evaluation: row.evaluation ?? null,
      nextStepRecommendation: row.next_step_recommendation ?? null,
      sourceFolder: row.source_folder ?? null,
      externalReference: row.external_reference ?? null,
      notes: row.notes ?? null,
      allocations: rows.allocations.filter((item) => item.application_id === row.id).map((item) => ({
        id: item.id, fundingNeedId: item.funding_need_id,
        amountRequested: amount(item.amount_requested), amountAwarded: amount(item.amount_awarded),
      })),
      checklist,
      documents,
      writingGuide: buildApplicationWritingGuide(row, opportunity ?? null, documents.map((document) => ({
        name: document.name,
        asset_role: document.assetRole,
        readiness_status: document.readinessStatus,
        extraction_status: document.extractionStatus,
        extracted_text_preview: document.extractedTextPreview,
        extraction_error: document.extractionError,
      })), checklist),
      assetReadiness: readinessByApplication.get(row.id) ?? { ...EMPTY_READINESS },
    };
  });

  const opportunities: WorkspaceGrantOpportunity[] = rows.opportunities.map((row) => {
    const grantPurposes = purposes(row.category);
    const grantPurposeKeys = grantPurposes.map((item) => item.toLowerCase());
    const status = String(row.status ?? "").toLowerCase();
    const activeRounds = (deadlinesByGrant.get(row.id) ?? []).filter((deadline) => {
      const roundStatus = String(deadline.status ?? "").toLowerCase();
      const date = isoDate(deadline.deadline_date);
      return date !== null && date >= currentDate && !isClosedOpportunityStatus(roundStatus);
    });
    const fallbackDeadline = isoDate(row.deadline);
    const childDeadline = activeRounds[0];
    const deadline = isoDate(childDeadline?.deadline_date) ?? (fallbackDeadline && fallbackDeadline >= currentDate ? fallbackDeadline : null);
    const isActive = !isClosedOpportunityStatus(status) && (deadline !== null || (!fallbackDeadline && (deadlinesByGrant.get(row.id)?.length ?? 0) === 0));
    const matchingProjectIds = isActive ? rows.projects.filter((project) => {
      if (!project.id || (row.currency && project.currency && row.currency !== project.currency)) return false;
      const projectCategories = rows.needs.filter((need) => need.project_id === project.id).map((need) => String(need.category).toLowerCase());
      return grantPurposeKeys.length === 0 || projectCategories.some((category) => grantPurposeKeys.some((purpose) => purpose.includes(category) || category.includes(purpose)));
    }).map((project) => project.id) : [];
    const deadlineRounds: WorkspaceGrantDeadlineRound[] = (deadlinesByGrant.get(row.id) ?? []).map((round) => ({
      id: round.id,
      date: isoDate(round.deadline_date) ?? String(round.deadline_date),
      label: round.label ?? null,
      classification: round.classification ?? "confirmed",
      sourceUrl: round.source_url ?? null,
      deadlineTime: round.deadline_time ?? null,
      timezone: round.timezone ?? null,
      opensOn: isoDate(round.opens_on),
      expectedResponseDate: isoDate(round.expected_response_date),
      status: round.status ?? null,
    }));
    return {
      id: row.id, name: row.name, funder: row.funder ?? null, program: row.program ?? null,
      purposes: grantPurposes, applicantType: row.applicant_type ?? null, status: row.status ?? null,
      description: row.description ?? null, priority: row.priority ?? null, notes: row.notes ?? null,
      eligibleUses: row.eligible_uses ?? null, assessmentBody: row.assessment_body ?? null,
      responseTiming: row.response_timing ?? null, rules: row.rules ?? null,
      researchStatus: row.research_status ?? null, researchSummary: row.research_summary ?? null,
      researchSource: row.research_source ?? null, researchUrl: row.research_url ?? null,
      deadline, opensOn: isoDate(childDeadline?.opens_on ?? row.opens_on),
      maxAmount: row.max_amount == null ? null : amount(row.max_amount), currency: row.currency ?? "DKK",
      requirements: row.requirements ?? null, officialUrl: row.url ?? null, lastVerifiedAt: isoDate(row.last_verified_at),
      matchReasons: grantPurposes.length ? [`Supports ${grantPurposes.join(", ")}`] : [], matchingProjectIds, deadlineRounds,
    };
  });

  // Single source of truth for confirmed / pipeline / gap — shared with Budget.
  const coverageByProject = computeCoverageForProjects(rows.projects, rows.budgetLines ?? [], rows.fundingSources, rows.applications);

  const projects: WorkspaceFundingProject[] = rows.projects.map((row) => {
    const profile = profilesByProject.get(row.id);
    const projectApplications = applications.filter((application) => application.projectId === row.id);
    const coverage = coverageByProject.get(row.id)!;
    const confirmedFunding = coverage.confirmed;
    const pendingFunding = coverage.pipelineWeighted;
    const totalBudget = coverage.budgetTotal;
    const projectNeeds: WorkspaceFundingNeed[] = rows.needs.filter((need) => need.project_id === row.id).map((need) => {
      const needAllocations = rows.allocations.filter((allocation) => allocation.funding_need_id === need.id);
      const confirmedAmount = needAllocations.reduce((sum, allocation) => sum + amount(allocation.amount_awarded), 0);
      const pendingAmount = needAllocations.filter((allocation) => {
        const application = applicationsById.get(allocation.application_id);
        return application && application.outcome !== "approved" && application.outcome !== "rejected" && application.workflow_stage !== "closed";
      }).reduce((sum, allocation) => sum + Math.max(0, amount(allocation.amount_requested) - amount(allocation.amount_awarded)), 0);
      const targetAmount = amount(need.target_amount);
      return {
        id: need.id, title: need.title, category: need.category ?? "other", description: need.use_of_funds ?? null,
        targetAmount, confirmedAmount, pendingAmount, remainingGap: Math.max(0, targetAmount - confirmedAmount),
        eligibility: ["grant_eligible", "mixed", "not_eligible"].includes(need.eligibility) ? need.eligibility : "unknown",
        priority: ["low", "medium", "high", "urgent"].includes(need.priority) ? need.priority : "medium",
        status: ["planned", "active", "funded", "cancelled"].includes(need.status) ? need.status : "planned",
        successMeasure: need.success_measure ?? null,
        neededBy: isoDate(need.needed_by), reconciled: rows.needBudgetLines.some((link) => link.funding_need_id === need.id),
      };
    });
    const nearestAction = [...projectApplications].filter((application) => application.nextAction).sort((a, b) => (a.nextActionDue ?? "9999-12-31").localeCompare(b.nextActionDue ?? "9999-12-31"))[0];
    const projectReadiness = projectApplications.reduce<WorkspaceAssetReadiness>((result, application) => {
      result.ready += application.assetReadiness.ready; result.total += application.assetReadiness.total;
      result.missing += application.assetReadiness.missing; result.stale += application.assetReadiness.stale;
      return result;
    }, { ...EMPTY_READINESS });
    const suggestedMatches = opportunities
      .filter((opportunity) => opportunity.matchingProjectIds.includes(row.id))
      .map((opportunity): WorkspaceOpportunityMatch => {
        const matchingCategories = projectNeeds.filter((need) => opportunity.purposes.some((purpose) => purpose.toLowerCase().includes(need.category.toLowerCase()) || need.category.toLowerCase().includes(purpose.toLowerCase()))).map((need) => need.category);
        const cautions: string[] = [];
        try {
          const rules = opportunity.rules ? JSON.parse(opportunity.rules) as Record<string, unknown> : null;
          if (rules?.commercial_allowed === false) cautions.push("Commercial use is restricted; confirm whether the applying entity and project revenue model qualify.");
          if (rules?.self_financing_required === true) cautions.push("Self-financing is required; keep the uncovered share visible in the budget.");
        } catch { /* malformed research data should not break workspace rendering */ }
        return {
          opportunityId: opportunity.id, name: opportunity.name, funder: opportunity.funder,
          deadline: opportunity.deadline, maxAmount: opportunity.maxAmount, currency: opportunity.currency,
          reasons: [...opportunity.matchReasons, ...(matchingCategories.length ? [`Matches funding needs: ${matchingCategories.join(", ")}`] : [])], cautions,
        };
      })
      .sort((a, b) => (a.deadline ?? "9999-12-31").localeCompare(b.deadline ?? "9999-12-31") || (b.maxAmount ?? 0) - (a.maxAmount ?? 0))
      .slice(0, 5);
    const match = suggestedMatches[0];
    return {
      id: row.id, name: row.name, status: row.status ?? null, priority: profile?.priority ?? null,
      artistName: row.artist_name ?? null, releaseTitle: row.release_title ?? null, ownerName: profile?.owner_name ?? null,
      currency: row.currency ?? "DKK", totalBudget, confirmedFunding, pendingFunding, coverage,
      remainingGap: coverage.gap, targetDate: isoDate(profile?.target_date), goal: profile?.goal ?? null,
      nextAction: nearestAction?.nextAction ?? null, nextActionDue: nearestAction?.nextActionDue ?? null,
      needs: projectNeeds.sort((a, b) => b.remainingGap - a.remainingGap), applicationIds: projectApplications.map((application) => application.id),
      assetReadiness: projectReadiness,
      topMatch: match ?? null,
      suggestedMatches,
    };
  });

  const assets: WorkspaceGrantAsset[] = rows.documents.map((document) => {
    const links = rows.applicationDocuments.filter((link) => link.document_id === document.id);
    const linkedApplications = links.map((link) => applications.find((application) => application.id === link.application_id)).filter(Boolean) as WorkspaceGrantApplication[];
    const states = links.map((link) => link.readiness_status);
    const readinessValue = states.includes("missing") ? "missing" : states.includes("stale") ? "stale"
      : states.length && states.every((state) => state === "ready") ? "ready"
      : String(document.status).toLowerCase() === "ready" ? "ready" : "draft";
    return {
      id: document.id, name: document.name, role: links[0]?.asset_role ?? document.doc_type ?? "other",
      ownerName: null, projectName: linkedApplications[0]?.projectName ?? null, readiness: readinessValue,
      lastUpdatedAt: isoDate(document.updated_at), applicationNames: linkedApplications.map((application) => application.name), href: document.file_link ?? null,
    };
  });

  const calendarEvents: WorkspaceGrantCalendarEvent[] = [];
  for (const opportunity of opportunities) {
    const rounds = deadlinesByGrant.get(opportunity.id) ?? [];
    if (rounds.length) {
      for (const round of rounds) {
        if (round.opens_on) calendarEvents.push({ id: `grant:${opportunity.id}:${round.id}:opening`, kind: "opening", title: `${opportunity.name} opens`, context: round.label ?? opportunity.funder, date: isoDate(round.opens_on), status: round.status ?? opportunity.status, href: opportunity.officialUrl });
        calendarEvents.push({ id: `grant:${opportunity.id}:${round.id}:deadline`, kind: "deadline", title: `${opportunity.name} deadline`, context: round.label ?? opportunity.funder, date: isoDate(round.deadline_date), status: round.status ?? opportunity.status, href: opportunity.officialUrl });
      }
    } else {
      if (opportunity.opensOn) calendarEvents.push({ id: `grant:${opportunity.id}:opening`, kind: "opening", title: `${opportunity.name} opens`, context: opportunity.funder, date: opportunity.opensOn, status: opportunity.status, href: opportunity.officialUrl });
      if (opportunity.deadline) calendarEvents.push({ id: `grant:${opportunity.id}:deadline`, kind: "deadline", title: `${opportunity.name} deadline`, context: opportunity.funder, date: opportunity.deadline, status: opportunity.status, href: opportunity.officialUrl });
    }
  }
  for (const application of applications) {
    const context = application.projectName;
    if (application.nextActionDue) calendarEvents.push({ id: `application:${application.id}:action`, kind: "action", title: application.nextAction ?? application.name, context, date: application.nextActionDue, status: application.workflowStage, href: `/grants?application=${application.id}` });
    if (application.applicationDeadline) calendarEvents.push({ id: `application:${application.id}:deadline`, kind: "deadline", title: `${application.name} application deadline`, context, date: application.applicationDeadline, status: application.workflowStage, href: `/grants?application=${application.id}` });
    if (application.submittedAt) calendarEvents.push({ id: `application:${application.id}:submission`, kind: "submission", title: `${application.name} submitted`, context, date: application.submittedAt, status: application.workflowStage, href: `/grants?application=${application.id}` });
    if (application.decisionDate) calendarEvents.push({ id: `application:${application.id}:decision`, kind: "decision", title: `${application.name} decision`, context, date: application.decisionDate, status: application.outcome, href: `/grants?application=${application.id}` });
    if (application.reportingDue) calendarEvents.push({ id: `application:${application.id}:reporting`, kind: "reporting", title: `${application.name} reporting due`, context, date: application.reportingDue, status: application.workflowStage, href: `/grants?application=${application.id}` });
  }
  calendarEvents.sort((a, b) => (a.date ?? "9999-12-31").localeCompare(b.date ?? "9999-12-31"));

  return {
    projects, applications, opportunities, assets, calendarEvents,
    contacts: (rows.contacts ?? []).map((row) => ({ id: row.id, name: row.name })),
    members: (rows.members ?? []).map((row) => ({ id: row.id, name: row.name, role: row.role })),
  };
}
