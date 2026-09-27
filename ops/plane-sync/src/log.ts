import type { SanitizedLogEvent } from "./types.js";

export function logSyncEvent(event: SanitizedLogEvent): void {
  const record: SanitizedLogEvent = {
    level: event.level,
    code: event.code,
    revision: event.revision,
    ...(event.deliveryId === undefined ? {} : { deliveryId: event.deliveryId }),
    ...(event.event === undefined ? {} : { event: event.event }),
    ...(event.action === undefined ? {} : { action: event.action }),
    ...(event.subjectNumber === undefined ? {} : { subjectNumber: event.subjectNumber }),
    ...(event.planeWorkItemId === undefined ? {} : { planeWorkItemId: event.planeWorkItemId }),
    ...(event.outcome === undefined ? {} : { outcome: event.outcome }),
    ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
  };
  console.log(JSON.stringify(record));
}
