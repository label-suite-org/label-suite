import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, runWithDatabaseContext } from "../lib/db";
import { data_quality_issues as issues, external_object_links as links, integration_connections as connections, integration_providers as providers, org_memberships, ops_tasks, releases, tracks, works, radio_stations } from "../db/schema";
import { ConflictError, HttpError, NotFoundError } from "./errors";
import { hasCapability, type MembershipRole } from "./native-capabilities";
import { assertDataQualityTarget, dataQualityObjectTypes, dataQualityPriorities, dataQualityStatuses, recordAuditEvent } from "./integrations";
import { createOpsTask } from "./ops-tasks";

const id = z.string().trim().min(1).max(200);
const scopeSchema = z.object({
  cursor: id.nullable(), q: z.string().trim().max(120).nullable(),
  status: z.enum(dataQualityStatuses).nullable(), priority: z.enum(dataQualityPriorities).nullable(),
  source: z.string().trim().max(120).nullable(), object_type: z.enum(dataQualityObjectTypes).nullable(),
}).strict();
const revision = { expected_revision: z.string().min(1).max(100) };
export const nativeDataQualityActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["resolve", "ignore"]), ...revision }).strict(),
  z.object({ action: z.literal("create_task"), ...revision, title: z.string().trim().min(1).max(200).optional() }).strict(),
  z.object({ action: z.literal("link"), ...revision, connection_id: id, object_type: z.enum(dataQualityObjectTypes), object_id: id, expected_link: z.object({ id, revision: z.string().min(1).max(100) }).strict().nullable() }).strict(),
]);
const fields = {
  id: issues.id, source: issues.source, issue_type: issues.issue_type, priority: issues.priority, status: issues.status,
  connection_id: issues.connection_id, object_type: issues.label_suite_object_type, object_id: issues.label_suite_object_id,
  external_object_type: issues.external_object_type, external_object_id: issues.external_object_id,
  revision: sql<string>`${issues.updated_at}::text`,
  task_id: sql<string | null>`(select ${ops_tasks.id} from ${ops_tasks} where ${ops_tasks.org_id} = ${issues.org_id} and ${ops_tasks.id} = ${issues.details}->>'ops_task_id')`,
};

async function authorized<T>(orgId: string, userId: string, operation: () => Promise<T>) {
  return runWithDatabaseContext({ orgId, userId }, async () => {
    const [member] = await db.select({ role: org_memberships.role }).from(org_memberships)
      .where(and(eq(org_memberships.org_id, orgId), eq(org_memberships.user_id, userId))).for("share");
    if (!member) throw new HttpError("Workspace access removed", 403, "workspace_access_removed");
    if (!hasCapability(member.role as MembershipRole, "integrations.manage")) throw new HttpError("Insufficient permissions", 403);
    return operation();
  });
}

async function issueProjection(orgId: string, issueId: string) {
  const [item] = await db.select(fields).from(issues).where(and(eq(issues.org_id, orgId), eq(issues.id, issueId)));
  if (!item) throw new NotFoundError("Data quality issue not found");
  return item;
}

export async function listNativeDataQuality(orgId: string, userId: string, raw: unknown) {
  const scope = scopeSchema.parse(raw);
  return authorized(orgId, userId, async () => {
    const rows = await db.select(fields).from(issues).where(and(
      eq(issues.org_id, orgId), scope.cursor ? sql`${issues.id} > ${scope.cursor}` : undefined,
      scope.status ? eq(issues.status, scope.status) : undefined,
      scope.priority ? eq(issues.priority, scope.priority) : undefined,
      scope.source ? eq(issues.source, scope.source) : undefined,
      scope.object_type ? eq(issues.label_suite_object_type, scope.object_type) : undefined,
      scope.q ? sql`position(lower(${scope.q}) in lower(concat_ws(' ', ${issues.source}, ${issues.issue_type}, ${issues.external_object_id}))) > 0` : undefined,
    )).orderBy(asc(issues.id)).limit(51);
    const items = rows.slice(0, 50);
    return { items, next_cursor: rows.length > 50 ? items.at(-1)!.id : null };
  });
}

const mappingFields = { id: links.id, object_type: links.label_suite_object_type, object_id: links.label_suite_object_id, status: links.status,
  revision: sql<string>`md5(jsonb_build_array(${links.id}, ${links.updated_at}, ${links.label_suite_object_type}, ${links.label_suite_object_id}, ${links.status})::text)` };

export async function getNativeDataQuality(orgId: string, userId: string, issueId: string, connectionId: string | null = null) {
  return authorized(orgId, userId, async () => {
    const item = await issueProjection(orgId, id.parse(issueId));
    const selected = connectionId === null ? item.connection_id : id.parse(connectionId);
    if (!selected) return { ...item, connection: null, mapping: null };
    const [connection] = await db.select({ id: connections.id, label: sql<string>`${providers.name} || ' · ' || ${connections.label}`, status: connections.status })
      .from(connections).innerJoin(providers, and(eq(providers.id, connections.provider_id), eq(providers.org_id, orgId)))
      .where(and(eq(connections.org_id, orgId), eq(connections.id, selected)));
    if (!connection) throw new NotFoundError("Connection not found in this workspace");
    const [mapping] = await db.select(mappingFields).from(links).where(and(eq(links.org_id, orgId), eq(links.connection_id, selected),
      eq(links.external_object_type, item.external_object_type ?? "record"), eq(links.external_object_id, item.external_object_id ?? item.id)));
    let targetLabel: string | null = null;
    if (mapping && dataQualityObjectTypes.includes(mapping.object_type as typeof dataQualityObjectTypes[number])) {
      const kind = mapping.object_type as typeof dataQualityObjectTypes[number];
      const table = { release: releases, track: tracks, work: works, station: radio_stations }[kind];
      const label = kind === "station" ? radio_stations.name : kind === "release" ? releases.title : kind === "track" ? tracks.title : works.title;
      targetLabel = (await db.select({ label }).from(table).where(and(eq(table.org_id, orgId), eq(table.id, mapping.object_id))))[0]?.label ?? null;
    }
    return { ...item, connection, mapping: mapping ? { ...mapping, target_label: targetLabel } : null };
  });
}

const optionScope = z.object({ kind: z.enum(["connection", ...dataQualityObjectTypes]), q: z.string().trim().max(120).nullable(), cursor: id.nullable() }).strict();
export async function nativeDataQualityOptions(orgId: string, userId: string, raw: unknown) {
  const scope = optionScope.parse(raw);
  return authorized(orgId, userId, async () => {
    let rows: { id: string; label: string }[];
    if (scope.kind === "connection") {
      rows = await db.select({ id: connections.id, label: sql<string>`${providers.name} || ' · ' || ${connections.label}` }).from(connections)
        .innerJoin(providers, and(eq(providers.id, connections.provider_id), eq(providers.org_id, orgId)))
        .where(and(eq(connections.org_id, orgId), scope.cursor ? sql`${connections.id} > ${scope.cursor}` : undefined,
          scope.q ? sql`position(lower(${scope.q}) in lower(concat_ws(' ', ${providers.name}, ${connections.label}))) > 0` : undefined))
        .orderBy(asc(connections.id)).limit(51);
    } else {
      const table = { release: releases, track: tracks, work: works, station: radio_stations }[scope.kind];
      const label = scope.kind === "station" ? radio_stations.name : scope.kind === "release" ? releases.title : scope.kind === "track" ? tracks.title : works.title;
      rows = await db.select({ id: table.id, label }).from(table).where(and(eq(table.org_id, orgId),
        scope.cursor ? sql`${table.id} > ${scope.cursor}` : undefined,
        scope.q ? sql`position(lower(${scope.q}) in lower(${label})) > 0` : undefined,
      )).orderBy(asc(table.id)).limit(51);
    }
    const items = rows.slice(0, 50);
    return { items, next_cursor: rows.length > 50 ? items.at(-1)!.id : null };
  });
}

export async function actOnNativeDataQuality(orgId: string, userId: string, issueId: string, raw: unknown) {
  const input = nativeDataQualityActionSchema.parse(raw);
  return authorized(orgId, userId, async () => {
    const [before] = await db.select({ id: issues.id, source: issues.source, issue_type: issues.issue_type, priority: issues.priority, status: issues.status,
      details: issues.details, external_type: issues.external_object_type, external_id: issues.external_object_id,
      revision: sql<string>`${issues.updated_at}::text`, connection_id: issues.connection_id, object_type: issues.label_suite_object_type, object_id: issues.label_suite_object_id,
    }).from(issues).where(and(eq(issues.org_id, orgId), eq(issues.id, id.parse(issueId)))).for("update");
    if (!before) throw new NotFoundError("Data quality issue not found");
    if (before.revision !== input.expected_revision) throw new ConflictError("Issue changed. Refresh before acting.");
    let status = input.action === "ignore" ? "ignored" : "resolved";
    let details = before.details;
    let objectType = before.object_type, objectId = before.object_id, connectionId = before.connection_id;
    let mappingBefore: { id: string; object_type: string; object_id: string; status: string; revision: string } | null = null;
    let mappingAfter: { id: string; object_type: string; object_id: string; status: string; revision: string } | null = null;
    if (input.action === "create_task") {
      const taskId = before.details?.ops_task_id;
      if (typeof taskId === "string" && (await db.select({ id: ops_tasks.id }).from(ops_tasks).where(and(eq(ops_tasks.org_id, orgId), eq(ops_tasks.id, taskId))))[0])
        throw new ConflictError("This issue already has a task. Open the existing task.");
      const task = await createOpsTask(orgId, { task_name: input.title ?? `Resolve ${before.source} data-quality issue`, priority: before.priority,
        notes: `${before.issue_type} · ${before.source}\nData quality issue: ${before.id}`, status: "todo" });
      status = "triaged"; details = { ...details, resolution: "task_created", ops_task_id: task.id };
    } else if (input.action === "link") {
      const [connection] = await db.select({ id: connections.id, provider: providers.key }).from(connections)
        .innerJoin(providers, and(eq(providers.id, connections.provider_id), eq(providers.org_id, orgId)))
        .where(and(eq(connections.org_id, orgId), eq(connections.id, input.connection_id))).for("share");
      if (!connection) throw new NotFoundError("Connection not found in this workspace");
      await assertDataQualityTarget(orgId, input.object_type, input.object_id);
      const externalType = before.external_type ?? "record", externalId = before.external_id ?? before.id;
      let linkId: string;
      if (input.expected_link === null) {
        const [inserted] = await db.insert(links).values({ id: `xlink_${crypto.randomUUID()}`, org_id: orgId, connection_id: connection.id, provider_key: connection.provider,
          external_object_type: externalType, external_object_id: externalId, label_suite_object_type: input.object_type, label_suite_object_id: input.object_id, match_method: "manual", status: "active",
        }).onConflictDoNothing({ target: [links.org_id, links.connection_id, links.external_object_type, links.external_object_id] }).returning(mappingFields);
        if (!inserted) throw new ConflictError("A mapping was added. Refresh and review it before linking.");
        mappingAfter = inserted; linkId = inserted.id;
      } else {
        const [current] = await db.select(mappingFields).from(links).where(and(eq(links.org_id, orgId), eq(links.connection_id, connection.id),
          eq(links.external_object_type, externalType), eq(links.external_object_id, externalId))).for("update");
        if (!current || current.id !== input.expected_link.id || current.revision !== input.expected_link.revision)
          throw new ConflictError("Mapping changed. Refresh and review it before replacing it.");
        mappingBefore = current;
        [mappingAfter] = await db.update(links).set({ label_suite_object_type: input.object_type, label_suite_object_id: input.object_id,
          status: "active", match_method: "manual", match_confidence: null, provider_key: connection.provider,
          updated_at: sql`greatest(clock_timestamp(), coalesce(${links.updated_at}, '-infinity'::timestamp) + interval '1 microsecond')`,
        }).where(and(eq(links.org_id, orgId), eq(links.id, current.id))).returning(mappingFields);
        linkId = current.id;
      }
      connectionId = connection.id; objectType = input.object_type; objectId = input.object_id;
      details = { ...details, resolution: "linked", link_id: linkId };
    }
    await db.update(issues).set({ status, details, connection_id: connectionId, label_suite_object_type: objectType, label_suite_object_id: objectId,
      updated_at: sql`greatest(clock_timestamp(), ${before.revision}::timestamp + interval '1 microsecond')`,
    }).where(and(eq(issues.org_id, orgId), eq(issues.id, issueId)));
    await recordAuditEvent(orgId, { actor_user_id: userId, event_type: `data_quality_issue.${status}`, object_type: "data_quality_issue", object_id: issueId,
      before: { status: before.status, connection_id: before.connection_id, object_type: before.object_type, object_id: before.object_id, ...(input.action === "link" ? { mapping: mappingBefore } : {}) },
      after: { status, connection_id: connectionId, ...(input.action === "link" ? { mapping: mappingAfter } : {}), object_type: objectType, object_id: objectId, ...(input.action === "create_task" ? { task_id: details.ops_task_id } : {}), ...(input.action === "link" ? { link_id: details.link_id } : {}) }, metadata: { action: input.action },
    });
    return issueProjection(orgId, issueId);
  });
}
