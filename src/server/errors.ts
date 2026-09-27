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
