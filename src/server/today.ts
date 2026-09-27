import { and, asc, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  artists,
  budget_projects,
  bugs,
  calls,
  campaigns,
  contacts,
  ops_tasks,
  release_reporting,
  releases,
  reporting_weeks,
  project_events,
} from "../db/schema";
import { db } from "../lib/db";
import { callIsTodayOrFuture, taskIsOpen, taskIsOverdue, workspaceToday } from "./task-deadlines";
import { observeOperation } from "./observability";

const taskContact = alias(contacts, "today_task_contact");
const taskOwner = alias(contacts, "today_task_owner");

async function loadTodayHubData(orgId: string) {
  const overdue = taskIsOverdue(orgId);

  const [callRows, taskRows, bugRows, blockedRows, reportingWeekRows, eventRows] = await Promise.all([
    db
      .select({
        id: calls.id,
        title: calls.title,
        start: calls.start,
        notes: calls.notes,
        status: calls.status,
        call_type: calls.call_type,
        contact_name: contacts.name,
        release_title: releases.title,
        project_name: budget_projects.name,
      })
      .from(calls)
      .leftJoin(contacts, and(eq(calls.contact_id, contacts.id), eq(contacts.org_id, orgId)))
      .leftJoin(releases, and(eq(calls.release_id, releases.id), eq(releases.org_id, orgId)))
      .leftJoin(budget_projects, and(eq(calls.project_id, budget_projects.id), eq(budget_projects.org_id, orgId)))
      .where(and(eq(calls.org_id, orgId), callIsTodayOrFuture(orgId)))
      .orderBy(asc(calls.start))
      .limit(20),
    db
      .select({
        id: ops_tasks.id,
        task_name: ops_tasks.task_name,
        status: ops_tasks.status,
        priority: ops_tasks.priority,
        owner: ops_tasks.owner,
        due_date: ops_tasks.due_date,
        next_action: ops_tasks.next_action,
        is_overdue: overdue,
        artist_name: artists.name,
        release_title: releases.title,
        campaign_name: campaigns.campaign_name,
        contact_name: taskContact.name,
        owner_contact_name: taskOwner.name,
        project_name: budget_projects.name,
      })
      .from(ops_tasks)
      .leftJoin(artists, and(eq(ops_tasks.linked_artist_id, artists.id), eq(artists.org_id, orgId)))
      .leftJoin(releases, and(eq(ops_tasks.linked_release_id, releases.id), eq(releases.org_id, orgId)))
      .leftJoin(campaigns, and(eq(ops_tasks.linked_campaign_id, campaigns.id), eq(campaigns.org_id, orgId)))
      .leftJoin(taskContact, and(eq(ops_tasks.linked_contact_id, taskContact.id), eq(taskContact.org_id, orgId)))
      .leftJoin(taskOwner, and(eq(ops_tasks.owner_contact_id, taskOwner.id), eq(taskOwner.org_id, orgId)))
      .leftJoin(budget_projects, and(eq(ops_tasks.project_id, budget_projects.id), eq(budget_projects.org_id, orgId)))
      .where(and(eq(ops_tasks.org_id, orgId), taskIsOpen()))
      .orderBy(
        asc(sql`case when ${overdue} then 0 else 1 end`),
        asc(sql`case ${ops_tasks.priority} when 'P0' then 0 when 'P1' then 1 when 'high' then 1 when 'P2' then 2 when 'medium' then 2 else 3 end`),
        asc(sql`${ops_tasks.due_date} is null`),
        asc(ops_tasks.due_date),
      )
      .limit(8),
    db
      .select()
      .from(bugs)
      .where(and(eq(bugs.org_id, orgId), eq(bugs.status, "logged")))
      .orderBy(asc(bugs.priority))
      .limit(10),
    db
      .select({
        id: releases.id,
        title: releases.title,
        release_date: releases.release_date,
        artist_name: artists.name,
      })
      .from(releases)
      .leftJoin(artists, and(eq(releases.artist_id, artists.id), eq(artists.org_id, orgId)))
      .where(and(eq(releases.org_id, orgId), eq(releases.release_ready, false)))
      .orderBy(asc(releases.release_date)),
    db
      .select({
        id: reporting_weeks.id,
        label: reporting_weeks.label,
        start_date: reporting_weeks.start_date,
        end_date: reporting_weeks.end_date,
        status: reporting_weeks.status,
        release_count: sql<number>`count(distinct ${release_reporting.release_id})::int`,
        is_current: sql<boolean>`${reporting_weeks.start_date} <= ${workspaceToday(orgId)} and ${reporting_weeks.end_date} >= ${workspaceToday(orgId)}`,
      })
      .from(reporting_weeks)
      .leftJoin(
        release_reporting,
        and(
          eq(release_reporting.reporting_week_id, reporting_weeks.id),
          eq(release_reporting.org_id, orgId),
        ),
      )
      .where(and(eq(reporting_weeks.org_id, orgId), sql`${reporting_weeks.end_date} >= ${workspaceToday(orgId)}`))
      .groupBy(
        reporting_weeks.id,
        reporting_weeks.label,
        reporting_weeks.start_date,
        reporting_weeks.end_date,
        reporting_weeks.status,
      )
      .orderBy(asc(reporting_weeks.start_date))
      .limit(2),
    db
      .select({
        id: project_events.id,
        title: project_events.title,
        event_type: project_events.event_type,
        status: project_events.status,
        start_date: project_events.start_date,
        end_date: project_events.end_date,
        starts_at: project_events.starts_at,
        venue_name: project_events.venue_name,
        city: project_events.city,
        project_name: budget_projects.name,
      })
      .from(project_events)
      .leftJoin(budget_projects, and(eq(project_events.project_id, budget_projects.id), eq(budget_projects.org_id, orgId)))
      .where(and(
        eq(project_events.org_id, orgId),
        ne(project_events.status, "completed"),
        ne(project_events.status, "cancelled"),
        ne(project_events.status, "canceled"),
        or(
          gte(project_events.start_date, workspaceToday(orgId)),
          and(lte(project_events.start_date, workspaceToday(orgId)), or(isNull(project_events.end_date), gte(project_events.end_date, workspaceToday(orgId)))),
        ),
      ))
      .orderBy(asc(project_events.start_date), asc(project_events.starts_at), asc(project_events.title))
      .limit(8),
  ]);

  return { callRows, taskRows, bugRows, blockedRows, reportingWeekRows, eventRows };
}

export function getTodayHubData(orgId: string) {
  return observeOperation("today.workspace", orgId, async () => {
    const payload = await loadTodayHubData(orgId);
    return {
      ...payload,
      eventRows: payload.eventRows.filter((event) => {
        const status = event.status?.toLowerCase();
        return status !== "completed" && status !== "cancelled" && status !== "canceled";
      }),
    };
  });
}
