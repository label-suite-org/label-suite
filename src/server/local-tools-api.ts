import { ZodError } from "zod";
import {
  LOCAL_TOOL_API_VERSION,
  localToolClaimConflictDetailsSchema,
  type LocalToolClaimConflictDetails,
  type LocalToolErrorCode,
  type LocalToolErrorEnvelope,
  type LocalToolSuccessEnvelope,
} from "../lib/campaign-enrichment-local-tool-contract";
import { getOrCreateRequestId } from "./request-context";

export const MAX_LOCAL_TOOL_JSON_BYTES = 512 * 1_024;
const MAX_LOCAL_TOOL_JSON_DEPTH = 64;
const MAX_LOCAL_TOOL_JSON_NODES = 10_000;

type LocalToolErrorDefinition = {
  status: number;
  message: string;
  retryable: boolean;
};

const LOCAL_TOOL_ERRORS: Readonly<Record<LocalToolErrorCode, LocalToolErrorDefinition>> = Object.freeze({
  authentication_failed: { status: 401, message: "Authentication failed", retryable: false },
  scope_forbidden: { status: 403, message: "Required scope is not granted", retryable: false },
  invalid_request: { status: 400, message: "Invalid request", retryable: false },
  not_found: { status: 404, message: "Resource not found", retryable: false },
  stale_revision: { status: 409, message: "Resource changed; refresh and try again", retryable: false },
  claim_conflict: { status: 409, message: "Resource is already claimed", retryable: true },
  idempotency_conflict: { status: 409, message: "Idempotency key conflicts with a previous request", retryable: false },
  service_unavailable: { status: 503, message: "Service temporarily unavailable", retryable: true },
  internal_error: { status: 500, message: "Internal server error", retryable: false },
});

export class LocalToolError extends Error {
  readonly code: LocalToolErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details: LocalToolClaimConflictDetails | undefined;

  constructor(code: "claim_conflict", details?: LocalToolClaimConflictDetails);
  constructor(code: Exclude<LocalToolErrorCode, "claim_conflict">);
  constructor(code: LocalToolErrorCode, details?: unknown) {
    const definition = LOCAL_TOOL_ERRORS[code];
    super(definition.message);
    this.name = "LocalToolError";
    this.code = code;
    this.status = definition.status;
    this.retryable = definition.retryable;
    if (details !== undefined) {
      if (code !== "claim_conflict") {
        throw new Error("Error details are only allowed for claim conflicts");
      }
      this.details = localToolClaimConflictDetailsSchema.parse(details);
    }
  }
}

export function localToolJson<T>(
  data: T,
  status = 200,
  requestId = getOrCreateRequestId(),
): Response {
  const envelope: LocalToolSuccessEnvelope<T> = {
    version: LOCAL_TOOL_API_VERSION,
    request_id: requestId,
    data,
  };
  return jsonResponse(envelope, status, requestId);
}

export function handleLocalToolError(
  error: unknown,
  requestId = getOrCreateRequestId(),
): Response {
  const localToolError = error instanceof LocalToolError
    ? error
    : error instanceof ZodError
      ? new LocalToolError("invalid_request")
      : new LocalToolError("internal_error");

  if (!(error instanceof LocalToolError) && !(error instanceof ZodError)) {
    console.error(`[local-tools-api] Unhandled error for request ${requestId}`);
  }

  const errorPayload: LocalToolErrorEnvelope["error"] = localToolError.code === "claim_conflict"
    ? {
        code: localToolError.code,
        message: localToolError.message,
        retryable: localToolError.retryable,
        ...(localToolError.details ? { details: localToolError.details } : {}),
      }
    : {
        code: localToolError.code,
        message: localToolError.message,
        retryable: localToolError.retryable,
      };
  const envelope: LocalToolErrorEnvelope = {
    version: LOCAL_TOOL_API_VERSION,
    request_id: requestId,
    error: errorPayload,
  };
  return jsonResponse(envelope, localToolError.status, requestId);
}

export async function readLocalToolJson(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^(0|[1-9]\d*)$/.test(declaredLength)) throw new LocalToolError("invalid_request");
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length > MAX_LOCAL_TOOL_JSON_BYTES) {
      throw new LocalToolError("invalid_request");
    }
  }
  if (!request.body) throw new LocalToolError("invalid_request");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_LOCAL_TOOL_JSON_BYTES) {
        await reader.cancel();
        throw new LocalToolError("invalid_request");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof LocalToolError) throw error;
    throw new LocalToolError("invalid_request");
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw new LocalToolError("invalid_request");
  }
  assertBoundedJsonStructure(value);
  return value;
}

function assertBoundedJsonStructure(value: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    nodes += 1;
    if (nodes > MAX_LOCAL_TOOL_JSON_NODES || current.depth > MAX_LOCAL_TOOL_JSON_DEPTH) {
      throw new LocalToolError("invalid_request");
    }
    if (current.value === null || typeof current.value !== "object") continue;
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>);
    for (const child of children) pending.push({ value: child, depth: current.depth + 1 });
  }
}

function jsonResponse(data: unknown, status: number, requestId: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
    },
  });
}
