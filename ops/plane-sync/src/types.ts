export type DeliveryState = "pending" | "processing" | "completed" | "retry" | "failed";
export type SubjectKind = "issue" | "pull_request" | "repository";
export type WriteMode = "dry-run" | "active";
export type ModuleName =
  | "Product Confidence & Delivery"
  | "Analytics & Forecasting"
  | "Artists, Releases & Rights"
  | "Directory & Campaigns"
  | "Events, Tasks & Search"
  | "Content, Assets & Budgets";
export type ProjectionSignal = "review" | "blocked" | "roadmap_triage";
export type PlaneStateName = "Backlog" | "Todo" | "In Progress" | "Done" | "Cancelled";

export interface SyncConfig {
  repository: "label-suite-org/label-suite_neon_r2";
  writeMode: WriteMode;
  host: string;
  port: number;
  bodyLimitBytes: number;
  databasePath: string;
  reconcileIntervalMs: number;
  envelopeRetentionMs: number;
  githubAppId: string;
  githubInstallationId: string;
  githubPrivateKeyBase64: string;
  githubWebhookSecret: string;
  planeBaseUrl: URL;
  planeApiToken: string;
  planeWorkspace: string;
  planeProjectId: string;
  revisionFile: string;
}

export type ManagedField = "state" | "priority" | "module" | "milestones";

export interface SeedRegistryEntry {
  planeWorkItemId: string;
  issueNumbers: number[];
  moduleName: ModuleName;
  managedFields: ManagedField[];
  curatedTitle: boolean;
}

export interface SeedRegistry {
  version: 1;
  entries: SeedRegistryEntry[];
}

export interface SeedRegistryIndex {
  byIssue: ReadonlyMap<number, SeedRegistryEntry[]>;
  byPlaneItem: ReadonlyMap<string, SeedRegistryEntry>;
}

export interface CompactDelivery {
  deliveryId: string;
  event:
    | "issues"
    | "issue_comment"
    | "pull_request"
    | "pull_request_review"
    | "pull_request_review_comment"
    | "ping"
    | "installation";
  action: string;
  repository: "label-suite-org/label-suite_neon_r2";
  subjectKind: SubjectKind;
  subjectNumber: number | null;
  actorLogin: string;
  occurredAt: string;
}

export interface GitHubIssueState {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
  stateReason: "COMPLETED" | "NOT_PLANNED" | "REOPENED" | null;
  labels: string[];
  url: string;
  updatedAt: string;
}

export interface GitHubIssueContext {
  issue: GitHubIssueState;
  hasOpenLinkedPullRequest: boolean;
}

export interface GitHubPullRequestState {
  number: number;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  url: string;
  updatedAt: string;
}

export interface GitHubPullRequestContext {
  pullRequest: GitHubPullRequestState;
  closingIssueNumbers: number[];
}

export interface PlaneVocabulary {
  states: Readonly<Record<PlaneStateName, string>>;
  modules: Readonly<Record<ModuleName, string>>;
}

export interface ProjectionInput {
  issues: GitHubIssueState[];
  hasOpenLinkedPullRequest: boolean;
  automatic: boolean;
  seedModuleName: ModuleName | null;
  allowModuleOverride: boolean;
  currentPriority: "none" | "low" | "medium" | "high" | "urgent";
}

export interface DesiredProjection {
  planeState: PlaneStateName;
  priority: "none" | "low" | "medium" | "high" | null;
  moduleName: ModuleName | null;
  commentSignals: ProjectionSignal[];
  title: string | null;
  canonicalIssueUrl: string;
}

export interface Milestone {
  id: string;
  html: string;
  externalSource: "label-suite-github-plane-sync";
  externalId: string;
}

export type EventMilestoneTransition =
  | "work_started"
  | "pr_opened"
  | "ready_for_review"
  | "review_submitted"
  | "pr_merged"
  | "pr_closed"
  | "issue_closed"
  | "issue_reopened"
  | "issue_cancelled";

export interface EventMilestoneInput {
  delivery: CompactDelivery;
  transition: EventMilestoneTransition | null;
  planeWorkItemId: string;
  canonicalUrl: string;
}

export interface ReconciliationMilestoneInput {
  delivery: CompactDelivery;
  transition: "reconciliation_repair";
  planeWorkItemId: string;
  canonicalUrl: string;
  updatedAt: string;
  projection: DesiredProjection;
}

export type MilestoneInput = EventMilestoneInput | ReconciliationMilestoneInput;

export interface ProcessResult {
  outcome: "noop" | "planned" | "mutated";
  created: number;
  updated: number;
  comments: number;
}

export interface SanitizedLogEvent {
  level: "info" | "warn" | "error";
  code: string;
  revision: string;
  deliveryId?: string;
  event?: string;
  action?: string;
  subjectNumber?: number;
  planeWorkItemId?: string;
  outcome?: "noop" | "planned" | "mutated";
  durationMs?: number;
}

export interface ReconcileReport {
  mode: WriteMode;
  seedItemsChecked: number;
  automaticItemsChecked: number;
  planned: number;
  applied: number;
  repaired: number;
  ambiguous: number;
  failed: number;
  cursorAdvancedTo: string | null;
}

export interface PublicHealth {
  status: "ok" | "degraded" | "failed";
  revision: string;
  lastAcceptedAt: string | null;
  lastPlaneMutationAt: string | null;
  lastReconciliationAt: string | null;
  pending: number;
  permanentlyFailed: number;
  lastErrorCode: string | null;
}

export interface BootstrapReport {
  mode: WriteMode;
  healthItem: "present" | "would-create" | "created";
}

export interface SyncRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
}
