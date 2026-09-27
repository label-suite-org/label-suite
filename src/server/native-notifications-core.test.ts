import { describe, expect, it } from "vitest";
import {
  auditNotificationSources, deadlineNotificationSource, notificationConsentApplies,
  privateNotificationPayload, varianceNotificationSource,
} from "./native-notifications-core";

const now = new Date("2026-09-27T12:00:00Z");
describe("private native notification source rules", () => {
  it("requires matching opt-in, recipient, workspace, category and current role, excluding old history", () => {
    const consent = { userId: "user", workspaceId: "workspace", category: "assignments" as const, enabledAt: now, enabledRole: "member" as const };
    const recipient = { userId: "user", workspaceId: "workspace", role: "member" as const };
    expect(notificationConsentApplies(consent, recipient, "assignments", now)).toBe(true);
    expect(notificationConsentApplies({ ...consent, enabledAt: null }, recipient, "assignments", now)).toBe(false);
    expect(notificationConsentApplies(consent, { ...recipient, userId: "other" }, "assignments", now)).toBe(false);
    expect(notificationConsentApplies(consent, { ...recipient, workspaceId: "other" }, "assignments", now)).toBe(false);
    expect(notificationConsentApplies(consent, recipient, "deadlines", now)).toBe(false);
    expect(notificationConsentApplies(consent, { ...recipient, role: "payee" }, "assignments", now)).toBe(false);
    expect(notificationConsentApplies(consent, recipient, "assignments", new Date(now.getTime() - 1))).toBe(false);
    expect(notificationConsentApplies(consent, recipient, "assignments", new Date(NaN))).toBe(false);
    expect(notificationConsentApplies({ ...consent, category: "requested_reviews" }, recipient, "requested_reviews", now)).toBe(false);
  });

  it("projects only generic alert text and a validated opaque ID into the lock screen", () => {
    const id = "9a2dd2f0-7c8d-4bce-aa13-a3064a4217da";
    expect(privateNotificationPayload(id)).toEqual({ aps: { alert: { title: "Label Suite", body: "You have a workspace update." } }, notification_id: id });
    expect(() => privateNotificationPayload("/contacts/private-name?token=secret")).toThrow();
  });

  it("uses shared audited assignments, excludes self/tenant/deletion, and avoids a duplicate change alert", () => {
    const audit = { id: "audit", org_id: "workspace", actor_user_id: "assigner", action: "update", entity_type: "ops_tasks", entity_id: "task", created_at: now,
      before_data: { assignee_ids: ["other"] }, after_data: { assignee_ids: ["user", "other"], title: "Private draft" } };
    const before = structuredClone(audit);
    expect(auditNotificationSources(audit, "user", "workspace")).toEqual([{ category: "assignments", sourceKey: "audit:audit", occurredAt: now, kind: "task", recordId: "task" }]);
    expect(auditNotificationSources(audit, "other", "workspace")[0]?.category).toBe("record_changes");
    expect(auditNotificationSources(audit, "unassigned", "workspace")).toEqual([]);
    expect(auditNotificationSources(audit, "user", "other")).toEqual([]);
    expect(auditNotificationSources({ ...audit, actor_user_id: "user" }, "user", "workspace")).toEqual([]);
    expect(auditNotificationSources({ ...audit, action: "delete" }, "user", "workspace")).toEqual([]);
    expect(auditNotificationSources({ ...audit, entity_type: "__proto__" }, "user", "workspace")).toEqual([]);
    expect(audit).toEqual(before);
  });

  it("selects today's or tomorrow's open assigned deadlines using the workspace date, including year rollover", () => {
    const task = { id: "task", org_id: "workspace", assignee_ids: ["user"], due_date: "2027-01-01", status: "todo" };
    const source = deadlineNotificationSource(task, "user", "workspace", "2026-12-31", now);
    expect(source?.sourceKey).toBe("deadline:task:2027-01-01");
    expect(deadlineNotificationSource(task, "user", "workspace", "2027-01-01", now)?.sourceKey).toBe(source?.sourceKey);
    expect(deadlineNotificationSource(task, "user", "workspace", "2027-01-02", now)).toBeNull();
    expect(deadlineNotificationSource(task, "user", "workspace", "2026-12-30", now)).toBeNull();
    expect(deadlineNotificationSource(task, "other", "workspace", "2026-12-31", now)).toBeNull();
    expect(deadlineNotificationSource(task, "user", "other", "2026-12-31", now)).toBeNull();
    expect(deadlineNotificationSource({ ...task, status: "Completed" }, "user", "workspace", "2026-12-31", now)).toBeNull();
    expect(deadlineNotificationSource({ ...task, due_date: "2026-02-30" }, "user", "workspace", "2026-03-01", now)).toBeNull();
  });

  it("maps every supported audited record to a source identity without copying private fields or claimed parents", () => {
    const mappings = { ops_tasks: "task", artists: "artist", releases: "release", tracks: "track", works: "work", contacts: "contact", organizations: "organization", campaigns: "campaign", budget_projects: "project", grant_applications: "grant_application" };
    for (const [entity_type, kind] of Object.entries(mappings)) {
      const audit = { id: "audit", org_id: "workspace", actor_user_id: "other", action: "update", entity_type, entity_id: "canonical-id", created_at: now,
        before_data: { assignee_ids: ["user"] }, after_data: { assignee_ids: ["user"], project_id: "untrusted-parent", name: "Private name", notes: "Private note", amount: "1000" } };
      expect(auditNotificationSources(audit, "user", "workspace")).toEqual([
        { category: "record_changes", sourceKey: "audit:audit", occurredAt: now, kind, recordId: "canonical-id" },
      ]);
    }
  });

  it("routes pending reviews only to decision-makers and results only to the original requester with read access", () => {
    const request = { id: "variance", org_id: "workspace", requested_by_user_id: "requester", reviewed_by_user_id: null, status: "pending", created_at: now, reviewed_at: null };
    expect(varianceNotificationSource(request, "owner", "workspace", "owner")?.category).toBe("requested_reviews");
    expect(varianceNotificationSource(request, "operator", "workspace", "operator")).toBeNull();
    expect(varianceNotificationSource(request, "requester", "workspace", "owner")).toBeNull();
    expect(varianceNotificationSource(request, "owner", "other", "owner")).toBeNull();
    const decided = { ...request, status: "approved", reviewed_at: now, reviewed_by_user_id: "owner" };
    expect(varianceNotificationSource(decided, "requester", "workspace", "member")?.category).toBe("approval_results");
    expect(varianceNotificationSource(decided, "other", "workspace", "owner")).toBeNull();
    expect(varianceNotificationSource(decided, "requester", "workspace", "payee")).toBeNull();
    expect(varianceNotificationSource({ ...decided, reviewed_by_user_id: "requester" }, "requester", "workspace", "owner")).toBeNull();
  });
});
