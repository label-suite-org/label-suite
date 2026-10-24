import { ZodError } from "zod";
import { handleApiError, json } from "./api";
import { getOrCreateRequestId } from "./request-context";
import { HttpError } from "./errors";

export async function readFanJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new HttpError("Expected JSON", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError("Missing body", 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32 * 1024) { await reader.cancel(); throw new HttpError("Request too large", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpError("Invalid JSON", 400); }
}

export function handleFanError(error: unknown) {
  if (error instanceof HttpError || error instanceof ZodError) return handleApiError(error);
  const cause = error instanceof Error ? error.cause : error;
  if (cause && typeof cause === "object" && "code" in cause && cause.code === "23505") return json({ error: "That value is already in use" }, 409);
  const requestId = getOrCreateRequestId();
  // Database errors can contain email addresses and tokens in query parameters.
  console.error(`[fans] Request failed: ${requestId}`);
  return json({ error: "Unable to complete the request", request_id: requestId }, 500, requestId);
}
