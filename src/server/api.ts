import { ZodError, type ZodType } from "zod";
import { HttpError } from "./errors";
import { getOrCreateRequestId } from "./request-context";

export function json(
  data: unknown,
  status = 200,
  requestId = getOrCreateRequestId(),
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
    },
  });
}

export async function parseJson<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new HttpError("Invalid JSON body", 400);
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(formatZodError(result.error), 400);
  }

  return result.data;
}

export function handleApiError(error: unknown): Response {
  if (error instanceof HttpError) {
    return json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
  }

  if (error instanceof ZodError) {
    return json({ error: formatZodError(error) }, 400);
  }

  if (isPostgresUniqueViolation(error)) {
    const suffix = error.constraint ? ` (${error.constraint})` : "";
    return json({ error: `Record conflicts with an existing unique value${suffix}` }, 409);
  }

  const requestId = getOrCreateRequestId();
  logUnexpectedApiError(requestId, error);
  return json({ error: "Internal server error", request_id: requestId }, 500, requestId);
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("; ");
}

function isPostgresUniqueViolation(
  error: unknown,
): error is { code: string; constraint?: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function logUnexpectedApiError(requestId: string, error: unknown): void {
  console.error(`[api] Unhandled error for request ${requestId}`, error);
}
