export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Not found") {
    super(message, 404);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends HttpError {
  constructor(message: string) {
    super(message, 409);
    this.name = "ConflictError";
  }
}

export function isPostgresSerializationFailure(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : null;
  return [error, cause].some((value) => typeof value === "object" && value !== null && "code" in value && value.code === "40001");
}
