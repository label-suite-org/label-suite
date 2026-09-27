import { syncCalendar } from "../calendar-sync";
import { runValidationSweep } from "../../lib/readiness";
import type { JobHandlerRegistry } from "./types";
import { collectNativeNotifications } from "../native-notification-collection";
import { dispatchNativeNotifications } from "../native-notification-delivery";

export const jobHandlers: JobHandlerRegistry = {
  notification_sync: async (job, context) => {
    if (job.schemaVersion !== 1) throw new Error("Unsupported notification sync version");
    const collection = await collectNativeNotifications(job.orgId, context.signal);
    return { ...collection, delivery: await dispatchNativeNotifications(job.orgId, context.signal) };
  },
  calendar_sync: async (job, context) => {
    if (job.schemaVersion !== 1) throw new Error("Unsupported calendar sync version");
    return syncCalendar(job.orgId, context.signal);
  },
  validation_sweep: async (job) => {
    if (job.schemaVersion !== 1) {
      const error = new Error(`Unsupported validation_sweep schema version: ${job.schemaVersion}`) as Error & { retryable: boolean };
      error.retryable = false;
      throw error;
    }
    return runValidationSweep(job.orgId);
  },
};
