import { PermanentSyncError, RetryableSyncError } from "./errors.js";
import { processDelivery, type ProcessorDeps } from "./processor.js";

export async function runWorkerOnce(
  deps: ProcessorDeps,
  now: Date,
  revision = "unknown",
): Promise<"idle" | "completed" | "retry" | "failed"> {
  const claimed = deps.store.claimNext(now);
  if (claimed === null) return "idle";
  const startedAt = deps.now().valueOf();
  const context = {
    deliveryId: claimed.deliveryId,
    event: claimed.event,
    action: claimed.action,
    subjectNumber: claimed.subjectNumber ?? undefined,
  };
  try {
    const result = await processDelivery(deps, claimed);
    deps.store.completeDelivery(claimed.lease, now);
    deps.log({
      level: "info",
      code: "delivery_completed",
      revision,
      ...context,
      outcome: result.outcome,
      durationMs: Math.max(0, deps.now().valueOf() - startedAt),
    });
    return "completed";
  } catch (error) {
    const permanent = error instanceof PermanentSyncError;
    const code = error instanceof PermanentSyncError || error instanceof RetryableSyncError ? error.code : "unexpected_failure";
    if (permanent) {
      deps.store.failDelivery(claimed.lease, code, now);
      deps.log({
        level: "error",
        code,
        revision,
        ...context,
        durationMs: Math.max(0, deps.now().valueOf() - startedAt),
      });
      return "failed";
    }

    deps.store.retryDelivery(claimed.lease, code, now);
    const exhausted = claimed.attemptCount >= 8;
    const finalCode = exhausted ? "retry_exhausted" : code;
    deps.log({
      level: exhausted ? "error" : "warn",
      code: finalCode,
      revision,
      ...context,
      durationMs: Math.max(0, deps.now().valueOf() - startedAt),
    });
    return exhausted ? "failed" : "retry";
  }
}
