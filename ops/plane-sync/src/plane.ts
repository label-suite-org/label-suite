import { PermanentSyncError, RetryableSyncError } from "./errors.js";
import { escapeHtml, managedSectionContent, replaceManagedSection } from "./managed-html.js";
import type { PlaneVocabulary } from "./types.js";

export type PlanePriority = "none" | "low" | "medium" | "high" | "urgent";

export interface PlaneWorkItem {
  id: string;
  name: string;
  descriptionHtml: string;
  stateId: string;
  priority: PlanePriority;
  labelIds: string[];
  moduleIds: string[];
}

export interface AutomaticItemInput {
  title: string;
  canonicalIssueUrl: string;
  stateId: string;
  priority: PlanePriority;
}

export interface PlaneProjectionPatch {
  stateId?: string;
  priority?: PlanePriority;
}

export interface PlaneManagedCommentInput {
  html: string;
  externalId: string;
}

export interface PlaneMilestoneInput {
  html: string;
  externalSource: "label-suite-github-plane-sync";
  externalId: string;
}

export interface CreateHealthItemInput {
  stateId: string;
}

export interface PlaneClientOptions {
  baseUrl: URL;
  apiToken: string;
  workspace: string;
  projectId: string;
  fetchImpl?: typeof fetch;
  sleep?: (delayMs: number) => Promise<void>;
  now?: () => number;
}

export type PlaneModuleMutationObserver = () => void;

/**
 * A bounded, execution-scoped view of every module collection in a Plane
 * project. Work-item detail responses do not reliably include module_ids, so
 * callers must use this inventory for module convergence and dry-run plans.
 */
export class PlaneModuleMembershipInventory {
  readonly vocabulary: PlaneVocabulary;
  private readonly workItemIdsByModule: Map<string, string[]>;

  constructor(vocabulary: PlaneVocabulary, memberships: ReadonlyMap<string, readonly string[]>) {
    this.vocabulary = vocabulary;
    this.workItemIdsByModule = new Map(
      [...memberships].map(([moduleId, workItemIds]) => [moduleId, [...workItemIds]]),
    );
  }

  hasExactlyOneModule(workItemId: string, moduleId: string): boolean {
    const memberships = this.membershipsForWorkItem(workItemId);
    return memberships.size === 1 && memberships.get(moduleId) === 1;
  }

  hasAnyModule(workItemId: string): boolean {
    return this.membershipsForWorkItem(workItemId).size > 0;
  }

  moduleIdsForWorkItem(workItemId: string): string[] {
    return [...this.membershipsForWorkItem(workItemId).keys()];
  }

  membershipsForWorkItem(workItemId: string): ReadonlyMap<string, number> {
    const itemId = requiredString(workItemId, "plane_work_item_id_invalid");
    const memberships = new Map<string, number>();
    for (const [moduleId, workItemIds] of this.workItemIdsByModule) {
      const count = workItemIds.filter((candidateId) => candidateId === itemId).length;
      if (count > 0) memberships.set(moduleId, count);
    }
    return memberships;
  }

  hasModule(moduleId: string): boolean {
    return this.workItemIdsByModule.has(requiredString(moduleId, "plane_module_id_invalid"));
  }

  removeMembership(moduleId: string, workItemId: string): void {
    const id = requiredString(moduleId, "plane_module_id_invalid");
    const current = this.workItemIdsByModule.get(id);
    if (!current) throw new PermanentSyncError("plane_module_inventory_missing");
    const itemId = requiredString(workItemId, "plane_work_item_id_invalid");
    this.workItemIdsByModule.set(id, current.filter((candidateId) => candidateId !== itemId));
  }

  addMembership(moduleId: string, workItemId: string): void {
    const id = requiredString(moduleId, "plane_module_id_invalid");
    const current = this.workItemIdsByModule.get(id);
    if (!current) throw new PermanentSyncError("plane_module_inventory_missing");
    current.push(requiredString(workItemId, "plane_work_item_id_invalid"));
  }

  replaceModuleMemberships(moduleId: string, workItemIds: readonly string[]): void {
    const id = requiredString(moduleId, "plane_module_id_invalid");
    if (!this.workItemIdsByModule.has(id)) throw new PermanentSyncError("plane_module_inventory_missing");
    this.workItemIdsByModule.set(id, [...workItemIds]);
  }
}

type JsonRecord = Record<string, unknown>;

interface PlaneNamedEntity {
  id: string;
  name: string;
}

interface PlaneResponse {
  status: number;
  body: unknown | null;
  bodyState: "json" | "empty" | "malformed";
}

const PLANE_STATE_NAMES = ["Backlog", "Todo", "In Progress", "Done", "Cancelled"] as const;
const MODULE_NAMES = [
  "Product Confidence & Delivery",
  "Analytics & Forecasting",
  "Artists, Releases & Rights",
  "Directory & Campaigns",
  "Events, Tasks & Search",
  "Content, Assets & Budgets",
] as const;
const EXTERNAL_SOURCE = "label-suite-github-plane-sync";
const MAX_COLLECTION_PAGES = 100;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_RATE_LIMIT_DELAY_MS = 60_000;
const DEFAULT_RATE_LIMIT_DELAY_MS = 4_000;
export const HEALTH_ITEM_NAME = "[System] GitHub to Plane sync health";

class PlanePermanentRequestError extends PermanentSyncError {
  readonly method: string;
  readonly routeTemplate: string;
  readonly status: number;

  constructor(method: string, routeTemplate: string, status: number, code: string) {
    super(code);
    this.name = "PlanePermanentRequestError";
    this.method = method;
    this.routeTemplate = routeTemplate;
    this.status = status;
    this.message = `method=${method} route=${routeTemplate} status=${status} code=${code}`;
  }
}

class PlaneRetryableRequestError extends RetryableSyncError {
  readonly method: string;
  readonly routeTemplate: string;
  readonly status: number;

  constructor(method: string, routeTemplate: string, status: number, code: string) {
    super(code);
    this.name = "PlaneRetryableRequestError";
    this.method = method;
    this.routeTemplate = routeTemplate;
    this.status = status;
    this.message = `method=${method} route=${routeTemplate} status=${status} code=${code}`;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value) throw new PermanentSyncError(code);
  return value;
}

function stringList(value: unknown, code: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry)) {
    throw new PermanentSyncError(code);
  }
  return [...value];
}

function priority(value: unknown, code: string): PlanePriority {
  if (value === "none" || value === "low" || value === "medium" || value === "high" || value === "urgent") return value;
  throw new PermanentSyncError(code);
}

function itemFromResponse(value: unknown): PlaneWorkItem {
  const item = isRecord(value) ? value : null;
  if (!item) throw new PermanentSyncError("plane_work_item_invalid");
  const labels = item.labels;
  if (!Array.isArray(labels)) throw new PermanentSyncError("plane_work_item_invalid");
  const labelIds = labels.map((label) =>
    typeof label === "string" ? label : requiredString(isRecord(label) ? label.id : undefined, "plane_work_item_invalid"),
  );
  const rawState = item.state;
  const stateId = typeof rawState === "string" ? rawState : requiredString(isRecord(rawState) ? rawState.id : undefined, "plane_work_item_invalid");
  return {
    id: requiredString(item.id, "plane_work_item_invalid"),
    name: requiredString(item.name, "plane_work_item_invalid"),
    descriptionHtml: typeof item.description_html === "string" ? item.description_html : "",
    stateId,
    priority: priority(item.priority, "plane_work_item_invalid"),
    labelIds,
    moduleIds: item.module_ids === undefined ? [] : stringList(item.module_ids, "plane_work_item_invalid"),
  };
}

function sourceHtml(title: string, canonicalIssueUrl: string): string {
  const url = canonicalIssueUrlValue(canonicalIssueUrl);
  return `<p><strong>GitHub issue:</strong> <a href="${escapeHtml(url)}">${escapeHtml(title)}</a></p>`;
}

function canonicalIssueUrlValue(value: unknown): string {
  const url = requiredString(value, "plane_canonical_issue_url_invalid");
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("unsafe URL");
    return url;
  } catch {
    throw new PermanentSyncError("plane_canonical_issue_url_invalid");
  }
}

function unescapeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function isHtmlWhitespace(character: string | undefined): boolean {
  return character !== undefined && /[\t\n\f\r ]/.test(character);
}

function anchorHrefs(html: string): string[] | null {
  const hrefs: string[] = [];
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf("<", cursor);
    if (start === -1) return hrefs;
    if (html[start + 1]?.toLowerCase() !== "a") {
      cursor = start + 1;
      continue;
    }
    const afterName = html[start + 2];
    if (!(afterName === ">" || afterName === "/" || isHtmlWhitespace(afterName))) {
      cursor = start + 1;
      continue;
    }

    let index = start + 2;
    let href: string | null = null;
    let closed = false;
    while (index < html.length) {
      while (isHtmlWhitespace(html[index])) index += 1;
      if (html[index] === ">") {
        closed = true;
        index += 1;
        break;
      }
      if (html[index] === "/" && html[index + 1] === ">") {
        closed = true;
        index += 2;
        break;
      }
      const attributeStart = index;
      while (index < html.length && !isHtmlWhitespace(html[index]) && html[index] !== "=" && html[index] !== ">" && html[index] !== "/") {
        index += 1;
      }
      if (attributeStart === index) return null;
      const name = html.slice(attributeStart, index).toLowerCase();
      while (isHtmlWhitespace(html[index])) index += 1;

      let value: string | null = null;
      if (html[index] === "=") {
        index += 1;
        while (isHtmlWhitespace(html[index])) index += 1;
        const quote = html[index];
        if (quote === '"' || quote === "'") {
          index += 1;
          const valueStart = index;
          while (index < html.length && html[index] !== quote) index += 1;
          if (index === html.length) return null;
          value = html.slice(valueStart, index);
          index += 1;
          if (!(isHtmlWhitespace(html[index]) || html[index] === ">" || (html[index] === "/" && html[index + 1] === ">"))) return null;
        } else {
          const valueStart = index;
          while (index < html.length && !isHtmlWhitespace(html[index]) && html[index] !== ">") {
            if (html[index] === '"' || html[index] === "'" || html[index] === "<" || html[index] === "=" || html[index] === "`") return null;
            index += 1;
          }
          if (valueStart === index) return null;
          value = html.slice(valueStart, index);
        }
      }
      if (name === "href") {
        if (href !== null || value === null) return null;
        href = value;
      }
    }
    if (!closed) return null;
    if (href !== null) hrefs.push(href);
    cursor = index;
  }
  return hrefs;
}

function hasExactAnchorHref(html: string, canonicalIssueUrl: string): boolean {
  const sourceHtml = managedSectionContent(html, "source");
  if (sourceHtml === null) return false;
  const hrefs = anchorHrefs(sourceHtml);
  return hrefs !== null && hrefs.some((href) => unescapeHtmlAttribute(href) === canonicalIssueUrl);
}

function namedEntity(value: unknown): PlaneNamedEntity {
  const entity = isRecord(value) ? value : null;
  if (!entity) throw new PermanentSyncError("plane_collection_entry_invalid");
  return {
    id: requiredString(entity.id, "plane_collection_entry_invalid"),
    name: requiredString(entity.name, "plane_collection_entry_invalid"),
  };
}

function moduleIssueWorkItemId(value: unknown): string {
  return requiredString(isRecord(value) ? value.id : undefined, "plane_module_membership_invalid");
}

function pageFromResponse(value: unknown): { entries: unknown[]; nextCursor: string | null } {
  if (Array.isArray(value)) return { entries: value, nextCursor: null };
  if (!isRecord(value) || !Array.isArray(value.results) || !(value.next_cursor === null || typeof value.next_cursor === "string")) {
    throw new PermanentSyncError("plane_collection_response_invalid");
  }
  if (value.next_page_results !== undefined && typeof value.next_page_results !== "boolean") {
    throw new PermanentSyncError("plane_collection_response_invalid");
  }
  if (value.next_page_results === false) return { entries: value.results, nextCursor: null };
  if (value.next_page_results === true && (typeof value.next_cursor !== "string" || !value.next_cursor)) {
    throw new PermanentSyncError("plane_collection_response_invalid");
  }
  if (value.next_cursor === "") throw new PermanentSyncError("plane_collection_response_invalid");
  return { entries: value.results, nextCursor: value.next_cursor };
}

function requiredVocabulary<T extends string>(entities: PlaneNamedEntity[], names: readonly T[]): Record<T, string> {
  const result = {} as Record<T, string>;
  for (const name of names) {
    const matches = entities.filter((entity) => entity.name === name);
    if (matches.length > 1) throw new PermanentSyncError("plane_vocabulary_duplicate");
    if (matches.length === 0) throw new PermanentSyncError("plane_vocabulary_missing");
    result[name] = matches[0]!.id;
  }
  return result;
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, delayMs); });
}

function boundedRateLimitDelay(delayMs: number): number {
  if (!Number.isFinite(delayMs)) return MAX_RATE_LIMIT_DELAY_MS;
  return Math.min(Math.max(0, Math.ceil(delayMs)), MAX_RATE_LIMIT_DELAY_MS);
}

function httpDateTimestamp(value: string): number | null {
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (?:0[1-9]|[12]\d|3[01]) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d GMT$/.test(value)) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toUTCString() === value ? timestamp : null;
}

function rateLimitDelay(retryAfter: string | null, now: number): number {
  if (retryAfter === null) return DEFAULT_RATE_LIMIT_DELAY_MS;
  const value = retryAfter.trim();
  if (/^\d+$/.test(value)) return boundedRateLimitDelay(Number(value) * 1_000);
  const retryAt = httpDateTimestamp(value);
  return retryAt === null ? DEFAULT_RATE_LIMIT_DELAY_MS : boundedRateLimitDelay(retryAt - now);
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Response cleanup must not replace the sanitized Plane failure or retry outcome.
  }
}

export class PlaneClient {
  private readonly baseUrl: URL;
  private readonly apiToken: string;
  private readonly workspace: string;
  private readonly projectId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly now: () => number;

  constructor(options: PlaneClientOptions) {
    if (!options.baseUrl || options.baseUrl.protocol !== "https:" || options.baseUrl.username || options.baseUrl.password) {
      throw new PermanentSyncError("plane_base_url_invalid");
    }
    this.baseUrl = new URL(options.baseUrl.origin);
    this.apiToken = requiredString(options.apiToken, "plane_api_token_invalid");
    this.workspace = requiredString(options.workspace, "plane_workspace_invalid");
    this.projectId = requiredString(options.projectId, "plane_project_id_invalid");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  async createAutomaticItem(input: AutomaticItemInput): Promise<PlaneWorkItem> {
    const title = requiredString(input.title, "plane_automatic_item_title_invalid");
    const canonicalIssueUrl = canonicalIssueUrlValue(input.canonicalIssueUrl);
    const route = this.workItemsRoute();
    const existing = await this.findItemsByCanonicalIssueUrl(canonicalIssueUrl);
    if (existing.length === 1) return existing[0]!;

    const response = await this.request("POST", route, {
      name: title,
      description_html: replaceManagedSection("", "source", sourceHtml(title, canonicalIssueUrl)),
      state: requiredString(input.stateId, "plane_state_id_invalid"),
      priority: priority(input.priority, "plane_priority_invalid"),
    });
    let item: PlaneWorkItem | null = null;
    if (response.bodyState === "json") {
      try {
        item = itemFromResponse(response.body);
      } catch {
        item = null;
      }
    }
    if (item === null) {
      const recovered = await this.findItemsByCanonicalIssueUrl(canonicalIssueUrl);
      if (recovered.length !== 1) {
        throw new PlaneRetryableRequestError("POST", route.template, response.status, "plane_mutation_outcome_uncertain");
      }
      item = recovered[0]!;
    }
    return item;
  }

  async resolveVocabulary(): Promise<PlaneVocabulary> {
    const [states, modules] = await Promise.all([
      this.listNamedCollection(this.statesRoute()),
      this.listNamedCollection(this.modulesRoute()),
    ]);
    return {
      states: requiredVocabulary(states, PLANE_STATE_NAMES),
      modules: requiredVocabulary(modules, MODULE_NAMES),
    };
  }

  /**
   * Reads the complete project module space once for a sync execution. Module
   * collections are deliberately enumerated in sequence: Plane shares a
   * 60-request/minute window and a six-way membership burst causes avoidable
   * throttling. The snapshot is caller-owned and must not cross executions.
   */
  async loadModuleMembershipInventory(): Promise<PlaneModuleMembershipInventory> {
    const states = await this.listNamedCollection(this.statesRoute());
    const modules = await this.listNamedCollection(this.modulesRoute());
    const vocabulary: PlaneVocabulary = {
      states: requiredVocabulary(states, PLANE_STATE_NAMES),
      modules: requiredVocabulary(modules, MODULE_NAMES),
    };
    const memberships = new Map<string, string[]>();
    for (const module of modules) {
      if (memberships.has(module.id)) throw new PermanentSyncError("plane_module_inventory_invalid");
      memberships.set(module.id, await this.listModuleIssueWorkItemIds(module.id));
    }
    return new PlaneModuleMembershipInventory(vocabulary, memberships);
  }

  async findItemsByCanonicalIssueUrl(canonicalIssueUrl: string): Promise<PlaneWorkItem[]> {
    const url = canonicalIssueUrlValue(canonicalIssueUrl);
    const matches = (await this.listWorkItems()).filter((item) => hasExactAnchorHref(item.descriptionHtml, url));
    if (matches.length > 1) throw new PermanentSyncError("plane_mapping_ambiguous");
    return matches;
  }

  async findHealthItems(): Promise<PlaneWorkItem[]> {
    return (await this.listWorkItems()).filter((item) => item.name === HEALTH_ITEM_NAME);
  }

  async createHealthItem(input: CreateHealthItemInput): Promise<PlaneWorkItem> {
    const route = this.workItemsRoute();
    const response = await this.request("POST", route, {
      name: HEALTH_ITEM_NAME,
      state: requiredString(input.stateId, "plane_state_id_invalid"),
      priority: "none",
    });
    let item: PlaneWorkItem | null = null;
    if (response.bodyState === "json") {
      try {
        item = itemFromResponse(response.body);
      } catch {
        item = null;
      }
    }
    if (item === null) {
      const matches = await this.findHealthItems();
      if (matches.length !== 1) {
        throw new PlaneRetryableRequestError("POST", route.template, response.status, "plane_mutation_outcome_uncertain");
      }
      item = matches[0]!;
    }
    return item;
  }

  async addMilestone(workItemId: string, milestone: PlaneMilestoneInput): Promise<void> {
    await this.request("POST", this.commentsRoute(requiredString(workItemId, "plane_work_item_id_invalid")), {
      comment_html: requiredString(milestone.html, "plane_milestone_html_invalid"),
      external_source: requiredString(milestone.externalSource, "plane_milestone_source_invalid"),
      external_id: requiredString(milestone.externalId, "plane_milestone_id_invalid"),
    });
  }

  async listMilestoneExternalIds(workItemId: string): Promise<Set<string>> {
    const route = this.commentsRoute(requiredString(workItemId, "plane_work_item_id_invalid"));
    const externalIds = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < MAX_COLLECTION_PAGES; page += 1) {
      const url = new URL(route.path, this.baseUrl);
      url.searchParams.set("per_page", "100");
      if (cursor) url.searchParams.set("cursor", cursor);
      const pageRoute = { template: route.template, path: `${url.pathname}${url.search}` };
      const response = await this.request("GET", pageRoute);
      const { entries, nextCursor } = this.parseResponse(response, "GET", route, pageFromResponse);
      try {
        for (const entry of entries) {
          const comment = isRecord(entry) ? entry : null;
          if (!comment) throw new PermanentSyncError("plane_comment_invalid");
          const externalSource = comment.external_source;
          if (externalSource !== "label-suite-github-plane-sync") continue;
          externalIds.add(requiredString(comment.external_id, "plane_comment_invalid"));
        }
      } catch (error) {
        this.throwResponseValidationError("GET", route, response.status, error);
      }
      if (nextCursor === null) return externalIds;
      if (cursors.has(nextCursor)) throw new PermanentSyncError("plane_pagination_loop");
      cursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new PermanentSyncError("plane_pagination_limit");
  }

  async addProjectionComment(workItemId: string, comment: PlaneManagedCommentInput): Promise<void> {
    await this.addManagedComment(workItemId, comment, "plane_projection_comment_html_invalid", "plane_projection_comment_id_invalid");
  }

  async upsertHealthComment(workItemId: string, comment: PlaneManagedCommentInput): Promise<boolean> {
    return this.addManagedComment(workItemId, comment, "plane_health_comment_html_invalid", "plane_health_comment_id_invalid");
  }

  async setModule(
    workItemId: string,
    moduleId: string,
    onMutation?: PlaneModuleMutationObserver,
    inventory?: PlaneModuleMembershipInventory,
  ): Promise<boolean> {
    const itemId = requiredString(workItemId, "plane_work_item_id_invalid");
    const desiredModuleId = requiredString(moduleId, "plane_module_id_invalid");
    const refreshAfterWrite = inventory === undefined;
    if (refreshAfterWrite) await this.getWorkItem(itemId);
    const memberships = inventory ?? await this.loadModuleMembershipInventory();
    if (!memberships.hasModule(desiredModuleId)) throw new PermanentSyncError("plane_module_inventory_missing");
    if (memberships.hasExactlyOneModule(itemId, desiredModuleId)) return false;
    let changed = false;
    const current = memberships.membershipsForWorkItem(itemId);
    const desiredMembershipCount = current.get(desiredModuleId) ?? 0;
    for (const obsoleteModuleId of current.keys()) {
      if (obsoleteModuleId === desiredModuleId) continue;
      changed = (await this.deleteModuleMembership(obsoleteModuleId, itemId, onMutation, memberships, refreshAfterWrite)) || changed;
    }
    const removedDuplicateDesiredMemberships = desiredMembershipCount > 1;
    if (removedDuplicateDesiredMemberships) {
      changed = (await this.deleteModuleMembership(desiredModuleId, itemId, onMutation, memberships, refreshAfterWrite)) || changed;
    }
    if (memberships.hasExactlyOneModule(itemId, desiredModuleId)) return changed;
    if (desiredMembershipCount === 0 || removedDuplicateDesiredMemberships) {
      await this.request("POST", this.moduleIssuesRoute(desiredModuleId), { issues: [itemId] });
      memberships.addMembership(desiredModuleId, itemId);
      if (refreshAfterWrite) await this.refreshModuleMembership(desiredModuleId, memberships);
      changed = true;
      onMutation?.();
    }
    if (!memberships.hasExactlyOneModule(itemId, desiredModuleId)) {
      throw new PermanentSyncError("plane_module_association_unverified");
    }
    return changed;
  }

  async clearModule(
    workItemId: string,
    onMutation?: PlaneModuleMutationObserver,
    inventory?: PlaneModuleMembershipInventory,
  ): Promise<boolean> {
    const itemId = requiredString(workItemId, "plane_work_item_id_invalid");
    const refreshAfterWrite = inventory === undefined;
    if (refreshAfterWrite) await this.getWorkItem(itemId);
    const memberships = inventory ?? await this.loadModuleMembershipInventory();
    const current = memberships.membershipsForWorkItem(itemId);
    let changed = false;
    for (const moduleId of current.keys()) {
      changed = (await this.deleteModuleMembership(moduleId, itemId, onMutation, memberships, refreshAfterWrite)) || changed;
    }
    if (memberships.hasAnyModule(itemId)) {
      throw new PermanentSyncError("plane_module_clear_unverified");
    }
    return changed;
  }

  async getWorkItem(workItemId: string): Promise<PlaneWorkItem> {
    const route = this.workItemRoute(requiredString(workItemId, "plane_work_item_id_invalid"));
    return this.parseResponse(await this.request("GET", route), "GET", route, itemFromResponse);
  }

  async patchProjection(current: PlaneWorkItem, patch: PlaneProjectionPatch): Promise<PlaneWorkItem> {
    const changes: JsonRecord = {};
    if (patch.stateId !== undefined && patch.stateId !== current.stateId) {
      changes.state = requiredString(patch.stateId, "plane_state_id_invalid");
    }
    if (patch.priority !== undefined && patch.priority !== current.priority) {
      changes.priority = priority(patch.priority, "plane_priority_invalid");
    }
    if (Object.keys(changes).length === 0) return current;
    const route = this.workItemRoute(current.id);
    await this.request("PATCH", route, changes);
    return this.getWorkItem(current.id);
  }

  private workItemsRoute(): { template: string; path: string } {
    return this.projectRoute("/work-items/");
  }

  private statesRoute(): { template: string; path: string } {
    return this.projectRoute("/states/");
  }

  private modulesRoute(): { template: string; path: string } {
    return this.projectRoute("/modules/");
  }

  private workItemRoute(workItemId: string): { template: string; path: string } {
    return this.projectRoute(`/work-items/${encodeURIComponent(workItemId)}/`, "/work-items/{workItemId}/");
  }

  private moduleIssuesRoute(moduleId: string): { template: string; path: string } {
    return this.projectRoute(
      `/modules/${encodeURIComponent(requiredString(moduleId, "plane_module_id_invalid"))}/module-issues/`,
      "/modules/{moduleId}/module-issues/",
    );
  }

  private moduleIssueRoute(moduleId: string, workItemId: string): { template: string; path: string } {
    return this.projectRoute(
      `/modules/${encodeURIComponent(requiredString(moduleId, "plane_module_id_invalid"))}/module-issues/${encodeURIComponent(requiredString(workItemId, "plane_work_item_id_invalid"))}/`,
      "/modules/{moduleId}/module-issues/{workItemId}/",
    );
  }

  private async deleteModuleMembership(
    moduleId: string,
    workItemId: string,
    onMutation?: PlaneModuleMutationObserver,
    inventory?: PlaneModuleMembershipInventory,
    refreshAfterWrite = false,
  ): Promise<boolean> {
    const route = this.moduleIssueRoute(moduleId, workItemId);
    try {
      await this.request("DELETE", route);
      inventory?.removeMembership(moduleId, workItemId);
      onMutation?.();
      if (refreshAfterWrite && inventory) await this.refreshModuleMembership(moduleId, inventory);
      return true;
    } catch (error) {
      if (
        error instanceof PlanePermanentRequestError &&
        error.method === "DELETE" &&
        error.routeTemplate === route.template &&
        error.status === 404
      ) {
        inventory?.removeMembership(moduleId, workItemId);
        if (refreshAfterWrite && inventory) await this.refreshModuleMembership(moduleId, inventory);
        return false;
      }
      throw error;
    }
  }

  private async refreshModuleMembership(moduleId: string, inventory: PlaneModuleMembershipInventory): Promise<void> {
    inventory.replaceModuleMemberships(moduleId, await this.listModuleIssueWorkItemIds(moduleId));
  }

  private commentsRoute(workItemId: string): { template: string; path: string } {
    return this.projectRoute(`/work-items/${encodeURIComponent(workItemId)}/comments/`, "/work-items/{workItemId}/comments/");
  }

  private async addManagedComment(
    workItemId: string,
    comment: PlaneManagedCommentInput,
    htmlCode: string,
    idCode: string,
  ): Promise<boolean> {
    const itemId = requiredString(workItemId, "plane_work_item_id_invalid");
    const externalId = requiredString(comment.externalId, idCode);
    const html = requiredString(comment.html, htmlCode);
    if ((await this.listMilestoneExternalIds(itemId)).has(externalId)) return false;
    await this.request("POST", this.commentsRoute(itemId), {
      comment_html: html,
      external_source: EXTERNAL_SOURCE,
      external_id: externalId,
    });
    return true;
  }

  private projectRoute(suffix: string, templateSuffix = suffix): { template: string; path: string } {
    const pathPrefix = `/api/v1/workspaces/${encodeURIComponent(this.workspace)}/projects/${encodeURIComponent(this.projectId)}`;
    const templatePrefix = "/api/v1/workspaces/{workspace}/projects/{project}";
    return { template: `${templatePrefix}${templateSuffix}`, path: `${pathPrefix}${suffix}` };
  }

  private async listNamedCollection(route: { template: string; path: string }): Promise<PlaneNamedEntity[]> {
    const entities: PlaneNamedEntity[] = [];
    const cursors = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < MAX_COLLECTION_PAGES; page += 1) {
      const url = new URL(route.path, this.baseUrl);
      url.searchParams.set("per_page", "100");
      if (cursor) url.searchParams.set("cursor", cursor);
      const pageRoute = { template: route.template, path: `${url.pathname}${url.search}` };
      const response = await this.request("GET", pageRoute);
      const { entries, nextCursor } = this.parseResponse(response, "GET", route, pageFromResponse);
      try {
        entities.push(...entries.map(namedEntity));
      } catch (error) {
        this.throwResponseValidationError("GET", route, response.status, error);
      }
      if (nextCursor === null) return entities;
      if (cursors.has(nextCursor)) throw new PermanentSyncError("plane_pagination_loop");
      cursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new PermanentSyncError("plane_pagination_limit");
  }

  private async listModuleIssueWorkItemIds(moduleId: string): Promise<string[]> {
    const route = this.moduleIssuesRoute(moduleId);
    const workItemIds: string[] = [];
    const cursors = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < MAX_COLLECTION_PAGES; page += 1) {
      const url = new URL(route.path, this.baseUrl);
      url.searchParams.set("per_page", "100");
      if (cursor) url.searchParams.set("cursor", cursor);
      const pageRoute = { template: route.template, path: `${url.pathname}${url.search}` };
      const response = await this.request("GET", pageRoute);
      const { entries, nextCursor } = this.parseResponse(response, "GET", route, pageFromResponse);
      try {
        workItemIds.push(...entries.map(moduleIssueWorkItemId));
      } catch (error) {
        this.throwResponseValidationError("GET", route, response.status, error);
      }
      if (nextCursor === null) return workItemIds;
      if (cursors.has(nextCursor)) throw new PermanentSyncError("plane_pagination_loop");
      cursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new PermanentSyncError("plane_pagination_limit");
  }

  private async listWorkItems(): Promise<PlaneWorkItem[]> {
    const route = this.workItemsRoute();
    const items: PlaneWorkItem[] = [];
    const cursors = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < MAX_COLLECTION_PAGES; page += 1) {
      const url = new URL(route.path, this.baseUrl);
      url.searchParams.set("per_page", "100");
      if (cursor) url.searchParams.set("cursor", cursor);
      const pageRoute = { template: route.template, path: `${url.pathname}${url.search}` };
      const response = await this.request("GET", pageRoute);
      const { entries, nextCursor } = this.parseResponse(response, "GET", route, pageFromResponse);
      try {
        items.push(...entries.map(itemFromResponse));
      } catch (error) {
        this.throwResponseValidationError("GET", route, response.status, error);
      }
      if (nextCursor === null) return items;
      if (cursors.has(nextCursor)) throw new PermanentSyncError("plane_pagination_loop");
      cursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new PermanentSyncError("plane_pagination_limit");
  }

  private parseResponse<T>(
    response: PlaneResponse,
    method: string,
    route: { template: string; path: string },
    parse: (body: unknown) => T,
  ): T {
    if (response.bodyState !== "json") {
      throw new PlanePermanentRequestError(method, route.template, response.status, "plane_response_invalid");
    }
    try {
      return parse(response.body);
    } catch (error) {
      this.throwResponseValidationError(method, route, response.status, error);
    }
  }

  private throwResponseValidationError(method: string, route: { template: string; path: string }, status: number, error: unknown): never {
    if (error instanceof PlanePermanentRequestError || error instanceof PlaneRetryableRequestError) throw error;
    const code = error instanceof PermanentSyncError ? error.code : "plane_response_invalid";
    throw new PlanePermanentRequestError(method, route.template, status, code);
  }

  private async request(
    method: string,
    route: { template: string; path: string },
    body?: unknown,
  ): Promise<PlaneResponse> {
    for (let retry = 0; ; retry += 1) {
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(), REQUEST_TIMEOUT_MS);
      let retryDelayMs: number | null = null;
      try {
        let response: Response;
        try {
          response = await this.fetchImpl(new URL(route.path, this.baseUrl), {
            method,
            headers: { "content-type": "application/json", "x-api-key": this.apiToken },
            signal: deadline.signal,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        } catch {
          throw new PlaneRetryableRequestError(
            method,
            route.template,
            0,
            deadline.signal.aborted ? "plane_request_timeout" : "plane_request_failed",
          );
        }
        if (!response.ok) {
          if (response.status === 429 && retry < MAX_RATE_LIMIT_RETRIES) {
            retryDelayMs = rateLimitDelay(response.headers.get("retry-after"), this.now());
            await discardResponseBody(response);
          } else if (response.status === 408 || response.status === 409 || response.status === 412 || response.status === 429 || response.status >= 500) {
            if (response.status === 429) await discardResponseBody(response);
            const code = response.status === 429 ? "plane_rate_limited" : response.status === 409 || response.status === 412 ? "plane_write_conflict" : "plane_service_unavailable";
            throw new PlaneRetryableRequestError(method, route.template, response.status, code);
          } else {
            throw new PlanePermanentRequestError(method, route.template, response.status, "plane_request_rejected");
          }
        }
        if (retryDelayMs === null) {
          if (response.status === 204 || response.status === 205 || response.headers.get("content-length") === "0" || response.body === null) {
            return { status: response.status, body: null, bodyState: "empty" };
          }
          try {
            return { status: response.status, body: await response.json(), bodyState: "json" };
          } catch {
            if (deadline.signal.aborted) {
              throw new PlaneRetryableRequestError(method, route.template, response.status, "plane_request_timeout");
            }
            return { status: response.status, body: null, bodyState: "malformed" };
          }
        }
      } finally {
        clearTimeout(timer);
      }
      if (retryDelayMs === null) {
        throw new PlaneRetryableRequestError(method, route.template, 0, "plane_request_failed");
      }
      await this.sleep(retryDelayMs);
    }
  }
}

export type { PlaneVocabulary };
