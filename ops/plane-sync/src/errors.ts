export class PermanentSyncError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "PermanentSyncError";
    this.code = code;
  }
}

export class RetryableSyncError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "RetryableSyncError";
    this.code = code;
  }
}
