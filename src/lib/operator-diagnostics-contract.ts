import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(128);
const labelSchema = z.string().max(500);
const pathSchema = z.string().max(2_048).regex(/^\//);

export const operatorHealthSchema = z.object({
  status: z.enum(["ok", "degraded", "unhealthy"]),
  web: z.literal("ok"),
  database: z.enum(["ok", "unavailable"]),
  worker: z.enum(["ok", "unavailable", "unknown"]),
  application: z.object({
    status: z.enum(["ok", "degraded", "unhealthy"]),
  }).strict(),
  analytics: z.object({
    status: z.enum(["ok", "degraded", "unknown"]),
    freshness: z.enum(["current", "stale", "unknown"]),
    coverage: z.enum(["complete", "partial", "empty", "invalid", "unknown"]),
  }).strict(),
  revision: z.string().regex(/^[0-9a-f]{40}$/).nullable(),
}).strict();

export const operatorJobsHealthSchema = z.object({
  queued: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  oldest_queued_at: z.iso.datetime({ offset: true }).nullable(),
  expired_leases: z.number().int().nonnegative(),
  active_workers: z.number().int().nonnegative(),
}).strict();

export const operatorOperationsBriefInputSchema = z.object({
  resource_type: z.enum(["release", "campaign"]),
  resource_id: identifierSchema,
}).strict();

const nextActionSchema = z.object({
  label: labelSchema,
  href: pathSchema,
}).strict();

const releaseBriefSchema = z.object({
  resource_type: z.literal("release"),
  record: z.object({
    id: identifierSchema,
    title: labelSchema,
    artist_name: labelSchema.nullable(),
    status: labelSchema.nullable(),
    release_date: z.string().max(40).nullable(),
    format: labelSchema.nullable(),
    phase: labelSchema.nullable(),
  }).strict(),
  readiness: z.object({
    state: z.enum(["ready", "blocked", "pending"]),
    blockers: z.array(labelSchema).max(20),
    next_action: nextActionSchema,
  }).strict(),
}).strict();

const campaignBriefSchema = z.object({
  resource_type: z.literal("campaign"),
  record: z.object({
    id: identifierSchema,
    name: labelSchema,
    campaign_type: labelSchema.nullable(),
    status: labelSchema.nullable(),
    start_date: z.string().max(40).nullable(),
    end_date: z.string().max(40).nullable(),
    linked_release_id: identifierSchema.nullable(),
    release_title: labelSchema.nullable(),
    linked_artist_id: identifierSchema.nullable(),
    artist_name: labelSchema.nullable(),
    goal_recorded: z.boolean(),
  }).strict(),
  readiness: z.object({
    state: z.enum(["clear", "attention"]),
    blockers: z.array(z.object({
      code: z.enum(["release", "artist", "goal"]),
      message: labelSchema,
    }).strict()).max(3),
    next_action: nextActionSchema,
  }).strict(),
}).strict();

export const operatorOperationsBriefSchema = z.discriminatedUnion("resource_type", [
  releaseBriefSchema,
  campaignBriefSchema,
]);

export type OperatorHealth = z.infer<typeof operatorHealthSchema>;
export type OperatorJobsHealth = z.infer<typeof operatorJobsHealthSchema>;
export type OperatorOperationsBriefInput = z.infer<typeof operatorOperationsBriefInputSchema>;
export type OperatorOperationsBrief = z.infer<typeof operatorOperationsBriefSchema>;
