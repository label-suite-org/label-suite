import { z } from "zod";
import { hasCapability, type MembershipRole } from "./native-capabilities";

export const notificationCategory = z.enum([
  "assignments", "deadlines", "requested_reviews", "approval_results", "record_changes",
]);
export type NotificationCategory = z.infer<typeof notificationCategory>;

export function notificationCategoryAvailable(role: MembershipRole, category: NotificationCategory): boolean {
  if (role === "payee") return false;
  return category !== "requested_reviews" || hasCapability(role, "variance.decide");
}

export type NotificationConsent = {
  userId: string;
  workspaceId: string;
  category: NotificationCategory;
  enabledAt: Date | null;
  enabledRole: MembershipRole;
};

/** Source eligibility only. Dispatch and resolve must recheck live record access. */
export function notificationConsentApplies(
  consent: NotificationConsent,
  recipient: { userId: string; workspaceId: string; role: MembershipRole },
  category: NotificationCategory,
  occurredAt: Date,
): boolean {
  return consent.userId === recipient.userId && consent.workspaceId === recipient.workspaceId
    && consent.category === category && consent.enabledRole === recipient.role
    && notificationCategoryAvailable(recipient.role, category)
    && consent.enabledAt !== null && occurredAt.getTime() >= consent.enabledAt.getTime();
}

const uuid = z.uuid();
/** Explicit projection: private business data must never enter an APNs payload. */
export function privateNotificationPayload(notificationId: string) {
  return {
    aps: { alert: { title: "Label Suite", body: "You have a workspace update." } },
    notification_id: uuid.parse(notificationId),
  };
}

const recordKinds = {
  ops_tasks: "task", artists: "artist", releases: "release", tracks: "track", works: "work",
  contacts: "contact", organizations: "organization", campaigns: "campaign",
  budget_projects: "project", grant_applications: "grant_application",
} as const;
export type NotificationRecordKind = typeof recordKinds[keyof typeof recordKinds];

/** Candidate identity, not a navigation destination or proof of access.
 * Resolve canonical parents and read authority again at dispatch and tap time.
 */
export type NotificationSource = {
  category: NotificationCategory;
  sourceKey: string;
  occurredAt: Date;
  kind: NotificationRecordKind | "budget_variance";
  recordId: string;
};

type AuditSource = {
  id: string; org_id: string; actor_user_id: string | null; action: string;
  entity_type: string; entity_id: string | null; created_at: Date | null;
  before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null;
};
function assignedTo(value: unknown, userId: string): boolean {
  return Array.isArray(value) && value.includes(userId);
}

/** Read shared row audit entries, so web and native writes have equal coverage. */
export function auditNotificationSources(audit: AuditSource, userId: string, workspaceId: string): NotificationSource[] {
  if (audit.org_id !== workspaceId || audit.actor_user_id === userId || !audit.entity_id
    || !audit.created_at || !Number.isFinite(audit.created_at.getTime()) || !audit.after_data
    || (audit.action !== "insert" && audit.action !== "update")) return [];
  const kind = Object.hasOwn(recordKinds, audit.entity_type)
    ? recordKinds[audit.entity_type as keyof typeof recordKinds] : null;
  if (!kind) return [];
  if (kind === "task" && !assignedTo(audit.after_data.assignee_ids, userId)) return [];
  const source = { sourceKey: `audit:${audit.id}`, occurredAt: audit.created_at, kind, recordId: audit.entity_id };
  if (kind === "task" && !assignedTo(audit.before_data?.assignee_ids, userId)) {
    return [{ ...source, category: "assignments" }];
  }
  return [{ ...source, category: "record_changes" }];
}

type DeadlineSource = {
  id: string; org_id: string; assignee_ids: string[]; due_date: string | null; status: string | null;
};

/** workspaceDate is supplied by workspaceToday(), never by the device clock. */
export function deadlineNotificationSource(
  task: DeadlineSource, userId: string, workspaceId: string, workspaceDate: string, now: Date,
): NotificationSource | null {
  if (task.org_id !== workspaceId || !task.assignee_ids.includes(userId)
    || ["done", "completed", "cancelled", "canceled"].includes((task.status ?? "todo").toLowerCase())
    || !task.due_date || !Number.isFinite(now.getTime())) return null;
  const today = Date.parse(`${workspaceDate}T00:00:00Z`);
  const due = Date.parse(`${task.due_date}T00:00:00Z`);
  if (!Number.isFinite(today) || !Number.isFinite(due)
    || new Date(today).toISOString().slice(0, 10) !== workspaceDate
    || new Date(due).toISOString().slice(0, 10) !== task.due_date
    || (due !== today && due - today !== 86_400_000)) return null;
  return { category: "deadlines", sourceKey: `deadline:${task.id}:${task.due_date}`, occurredAt: now, kind: "task", recordId: task.id };
}

type VarianceSource = {
  id: string; org_id: string; requested_by_user_id: string | null; reviewed_by_user_id: string | null;
  status: string; created_at: Date | null; reviewed_at: Date | null;
};

export function varianceNotificationSource(
  request: VarianceSource, userId: string, workspaceId: string, role: MembershipRole,
): NotificationSource | null {
  if (request.org_id !== workspaceId || role === "payee") return null;
  if (request.status === "pending" && request.requested_by_user_id !== userId
    && hasCapability(role, "variance.decide") && request.created_at && Number.isFinite(request.created_at.getTime())) {
    return { category: "requested_reviews", sourceKey: `variance:${request.id}:pending`, occurredAt: request.created_at, kind: "budget_variance", recordId: request.id };
  }
  if (["approved", "rejected"].includes(request.status) && request.requested_by_user_id === userId
    && request.reviewed_by_user_id !== userId && request.reviewed_at && Number.isFinite(request.reviewed_at.getTime())) {
    return { category: "approval_results", sourceKey: `variance:${request.id}:${request.status}:${request.reviewed_at.toISOString()}`, occurredAt: request.reviewed_at, kind: "budget_variance", recordId: request.id };
  }
  return null;
}
