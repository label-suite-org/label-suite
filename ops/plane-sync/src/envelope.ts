import { PermanentSyncError } from "./errors.js";
import type { CompactDelivery, SubjectKind } from "./types.js";

type DeliveryHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;
type DeliveryEvent = CompactDelivery["event"];
type JsonRecord = Record<string, unknown>;

const REPOSITORY = "label-suite-org/label-suite_neon_r2" as const;
const MAX_BODY_BYTES = 1_048_576;
const DELIVERY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ACTIONS = {
  issues: new Set(["opened", "edited", "labeled", "unlabeled", "closed", "reopened", "assigned", "unassigned"]),
  issue_comment: new Set(["created", "edited", "deleted"]),
  pull_request: new Set([
    "opened",
    "edited",
    "ready_for_review",
    "converted_to_draft",
    "closed",
    "reopened",
    "synchronize",
    "labeled",
    "unlabeled",
  ]),
  pull_request_review: new Set(["submitted", "edited", "dismissed"]),
  pull_request_review_comment: new Set(["created", "edited", "deleted"]),
  ping: new Set(["ping"]),
  installation: new Set(["created", "deleted", "suspend", "unsuspend", "new_permissions_accepted"]),
} as const;

function reject(code: string): never {
  throw new PermanentSyncError(code);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(value: unknown, code: string): JsonRecord {
  if (!isRecord(value)) reject(code);
  return value;
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value) reject(code);
  return value;
}

function header(headers: DeliveryHeaders, name: string): string | undefined {
  let value: string | undefined;
  for (const [providedName, providedValue] of Object.entries(headers)) {
    if (providedName.toLowerCase() !== name) continue;
    if (typeof providedValue !== "string" || value !== undefined) return undefined;
    value = providedValue;
  }
  return value;
}

function parsePayload(rawBody: Uint8Array): JsonRecord {
  try {
    const payload: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody));
    return requiredRecord(payload, "WEBHOOK_PAYLOAD_INVALID");
  } catch (error) {
    if (error instanceof PermanentSyncError) throw error;
    return reject("WEBHOOK_JSON_INVALID");
  }
}

function deliveryEvent(headers: DeliveryHeaders): DeliveryEvent {
  const event = header(headers, "x-github-event");
  if (!event) reject("WEBHOOK_EVENT_HEADER_INVALID");
  if (!Object.hasOwn(ACTIONS, event)) reject("WEBHOOK_EVENT_UNSUPPORTED");
  return event as DeliveryEvent;
}

function deliveryId(headers: DeliveryHeaders): string {
  const id = header(headers, "x-github-delivery");
  if (!id || !DELIVERY_ID_PATTERN.test(id)) reject("WEBHOOK_DELIVERY_ID_INVALID");
  return id;
}

function actionFor(event: DeliveryEvent, payload: JsonRecord): string {
  const action = event === "ping" ? "ping" : requiredString(payload.action, "WEBHOOK_ACTION_INVALID");
  if (!ACTIONS[event].has(action as never)) reject("WEBHOOK_ACTION_UNSUPPORTED");
  return action;
}

function canonicalRepository(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    value.name === "label-suite_neon_r2" &&
    value.full_name === REPOSITORY &&
    isRecord(value.owner) &&
    value.owner.login === "label-suite-org"
  );
}

function requireRepository(event: DeliveryEvent, payload: JsonRecord): JsonRecord {
  if (canonicalRepository(payload.repository)) return payload.repository as JsonRecord;

  if (
    event === "installation" &&
    Array.isArray(payload.repositories) &&
    payload.repositories.some(canonicalRepository)
  ) {
    return payload.repositories.find(canonicalRepository) as JsonRecord;
  }

  return reject("WEBHOOK_REPOSITORY_UNSUPPORTED");
}

function positiveNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    reject("WEBHOOK_SUBJECT_INVALID");
  }
  return value;
}

function subjectFor(event: DeliveryEvent, payload: JsonRecord): { kind: SubjectKind; number: number | null } {
  switch (event) {
    case "issues":
    case "issue_comment":
      return { kind: "issue", number: positiveNumber(requiredRecord(payload.issue, "WEBHOOK_SUBJECT_INVALID").number) };
    case "pull_request": {
      const pullRequest = requiredRecord(payload.pull_request, "WEBHOOK_SUBJECT_INVALID");
      const nestedNumber = positiveNumber(pullRequest.number);
      if (payload.number !== undefined && positiveNumber(payload.number) !== nestedNumber) {
        reject("WEBHOOK_SUBJECT_INVALID");
      }
      return { kind: "pull_request", number: nestedNumber };
    }
    case "pull_request_review":
    case "pull_request_review_comment":
      return {
        kind: "pull_request",
        number: positiveNumber(requiredRecord(payload.pull_request, "WEBHOOK_SUBJECT_INVALID").number),
      };
    case "ping":
    case "installation":
      return { kind: "repository", number: null };
  }
}

function timestamp(value: unknown): string {
  const occurredAt = requiredString(value, "WEBHOOK_TIMESTAMP_INVALID");
  if (!Number.isFinite(Date.parse(occurredAt))) reject("WEBHOOK_TIMESTAMP_INVALID");
  return occurredAt;
}

function occurredAtFor(event: DeliveryEvent, payload: JsonRecord, repository: JsonRecord): string {
  switch (event) {
    case "issues":
      return timestamp(requiredRecord(payload.issue, "WEBHOOK_SUBJECT_INVALID").updated_at);
    case "issue_comment": {
      const comment = requiredRecord(payload.comment, "WEBHOOK_TIMESTAMP_INVALID");
      return timestamp(comment.updated_at ?? comment.created_at);
    }
    case "pull_request":
      return timestamp(requiredRecord(payload.pull_request, "WEBHOOK_SUBJECT_INVALID").updated_at);
    case "pull_request_review": {
      const review = requiredRecord(payload.review, "WEBHOOK_TIMESTAMP_INVALID");
      return timestamp(review.submitted_at ?? review.updated_at);
    }
    case "pull_request_review_comment": {
      const comment = requiredRecord(payload.comment, "WEBHOOK_TIMESTAMP_INVALID");
      return timestamp(comment.updated_at ?? comment.created_at);
    }
    case "ping":
      return timestamp(repository.updated_at);
    case "installation": {
      const installation = requiredRecord(payload.installation, "WEBHOOK_TIMESTAMP_INVALID");
      return timestamp(installation.updated_at ?? installation.created_at);
    }
  }
}

export function compactDelivery(
  headers: DeliveryHeaders,
  rawBody: Uint8Array,
  limitBytes: number,
): CompactDelivery | null {
  if (!Number.isSafeInteger(limitBytes) || limitBytes <= 0) reject("WEBHOOK_BODY_LIMIT_INVALID");
  if (rawBody.byteLength > Math.min(limitBytes, MAX_BODY_BYTES)) reject("WEBHOOK_BODY_TOO_LARGE");

  const payload = parsePayload(rawBody);
  const event = deliveryEvent(headers);
  const repository = requireRepository(event, payload);
  const id = deliveryId(headers);
  const action = actionFor(event, payload);
  const actorLogin = requiredString(requiredRecord(payload.sender, "WEBHOOK_ACTOR_INVALID").login, "WEBHOOK_ACTOR_INVALID");
  const occurredAt = occurredAtFor(event, payload, repository);
  if (
    event === "issue_comment" &&
    isRecord(payload.issue) &&
    isRecord(payload.issue.pull_request)
  ) {
    return null;
  }
  const subject = subjectFor(event, payload);

  return {
    deliveryId: id,
    event,
    action,
    repository: REPOSITORY,
    subjectKind: subject.kind,
    subjectNumber: subject.number,
    actorLogin,
    occurredAt,
  };
}
