import { and, asc, eq } from "drizzle-orm";
import { users } from "../db/auth-schema";
import { artists, budget_line_items, budget_projects, contacts, documents, funding_sources, funding_need_budget_lines, funding_needs, grant_application_documents, grant_application_funding_needs, grant_application_requirements, grant_applications, grant_deadlines, grant_document_extractions, grant_requirements, grants, org_memberships, project_funding_profiles, releases } from "../db/schema";
import { db } from "../lib/db";
import { buildGrantsWorkspacePayload, type GrantsWorkspacePayload } from "./grants-workspace-core";
import { observeOperation } from "./observability";

async function loadGrantsWorkspace(orgId: string): Promise<GrantsWorkspacePayload> {
  const [
    projectRows, profileRows, fundingSourceRows, budgetLineRows, needRows, needBudgetLineRows,
    allocationRows, applicationRows, opportunityRows, deadlineRows, requirementRows,
    applicationRequirementRows, applicationDocumentRows, extractionRows, documentRows, contactRows, memberRows,
  ] = await Promise.all([
    db.select({
      id: budget_projects.id, name: budget_projects.name, status: budget_projects.status,
      currency: budget_projects.currency, total_planned: budget_projects.total_planned,
      baseline_funding: budget_projects.baseline_funding,
      artist_name: artists.name, release_title: releases.title,
    }).from(budget_projects)
      .leftJoin(artists, and(eq(budget_projects.artist_id, artists.id), eq(artists.org_id, orgId)))
      .leftJoin(releases, and(eq(budget_projects.release_id, releases.id), eq(releases.org_id, orgId)))
      .where(eq(budget_projects.org_id, orgId)),
    db.select({
      project_id: project_funding_profiles.project_id, priority: project_funding_profiles.priority,
      target_date: project_funding_profiles.target_date, goal: project_funding_profiles.goal,
      owner_name: contacts.name,
    }).from(project_funding_profiles)
      .leftJoin(contacts, and(eq(project_funding_profiles.owner_contact_id, contacts.id), eq(contacts.org_id, orgId)))
      .where(eq(project_funding_profiles.org_id, orgId)),
    db.select({
      id: funding_sources.id, project_id: funding_sources.project_id, status: funding_sources.status,
      amount_planned: funding_sources.amount_planned, amount_confirmed: funding_sources.amount_confirmed,
    }).from(funding_sources).where(eq(funding_sources.org_id, orgId)),
    db.select({
      project_id: budget_line_items.project_id, amount: budget_line_items.amount,
      planned_amount: budget_line_items.planned_amount,
    }).from(budget_line_items).where(eq(budget_line_items.org_id, orgId)),
    db.select().from(funding_needs).where(eq(funding_needs.org_id, orgId)),
    db.select({ funding_need_id: funding_need_budget_lines.funding_need_id })
      .from(funding_need_budget_lines).where(eq(funding_need_budget_lines.org_id, orgId)),
    db.select().from(grant_application_funding_needs).where(eq(grant_application_funding_needs.org_id, orgId)),
    db.select({
      id: grant_applications.id, project_id: grant_applications.project_id, grant_id: grant_applications.grant_id,
      funding_source_id: grant_applications.funding_source_id,
      owner_user_id: grant_applications.owner_user_id, owner_contact_id: grant_applications.owner_contact_id,
      member_name: users.name, owner_name: contacts.name, workflow_stage: grant_applications.workflow_stage, outcome: grant_applications.outcome,
      priority: grant_applications.priority, amount_requested: grant_applications.amount_requested,
      amount_awarded: grant_applications.amount_awarded, next_action: grant_applications.next_action,
      next_action_due: grant_applications.next_action_due, submission_deadline: grant_applications.submission_deadline,
      submitted_at: grant_applications.submitted_at, decision_date: grant_applications.decision_date,
      reporting_due: grant_applications.reporting_due,
      angle_narrative: grant_applications.angle_narrative, response_notes: grant_applications.response_notes,
      evaluation: grant_applications.evaluation, next_step_recommendation: grant_applications.next_step_recommendation,
      source_folder: grant_applications.source_folder, external_reference: grant_applications.external_reference,
      notes: grant_applications.notes,
    }).from(grant_applications)
      .leftJoin(org_memberships, and(eq(grant_applications.owner_user_id, org_memberships.user_id), eq(org_memberships.org_id, orgId)))
      .leftJoin(users, eq(users.id, org_memberships.user_id))
      .leftJoin(contacts, and(eq(grant_applications.owner_contact_id, contacts.id), eq(contacts.org_id, orgId)))
      .where(eq(grant_applications.org_id, orgId)),
    db.select().from(grants).where(eq(grants.org_id, orgId)),
    db.select().from(grant_deadlines).where(eq(grant_deadlines.org_id, orgId)),
    db.select().from(grant_requirements).where(eq(grant_requirements.org_id, orgId)),
    db.select().from(grant_application_requirements).where(eq(grant_application_requirements.org_id, orgId)),
    db.select().from(grant_application_documents).where(eq(grant_application_documents.org_id, orgId)),
    db.select().from(grant_document_extractions).where(eq(grant_document_extractions.org_id, orgId)),
    db.select().from(documents).where(eq(documents.org_id, orgId)),
    db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(eq(contacts.org_id, orgId)).orderBy(asc(contacts.name)),
    db.select({ id: users.id, name: users.name, role: org_memberships.role }).from(org_memberships)
      .innerJoin(users, eq(users.id, org_memberships.user_id))
      .where(eq(org_memberships.org_id, orgId)).orderBy(asc(users.name)),
  ]);

  return buildGrantsWorkspacePayload({
    projects: projectRows, profiles: profileRows, fundingSources: fundingSourceRows, budgetLines: budgetLineRows,
    needs: needRows, needBudgetLines: needBudgetLineRows, allocations: allocationRows,
    applications: applicationRows, opportunities: opportunityRows, deadlines: deadlineRows,
    requirements: requirementRows, applicationRequirements: applicationRequirementRows,
    applicationDocuments: applicationDocumentRows, extractions: extractionRows, documents: documentRows, contacts: contactRows, members: memberRows,
  });
}

export function getGrantsWorkspace(orgId: string): Promise<GrantsWorkspacePayload> {
  return observeOperation("grants.workspace", orgId, () => loadGrantsWorkspace(orgId));
}
