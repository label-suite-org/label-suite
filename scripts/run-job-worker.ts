import { enqueueCalendarSyncs } from "../src/server/calendar-sync";
import { jobHandlers } from "../src/server/jobs/handlers";
import { jobStore, runWorkerLoop } from "../src/server/jobs";
import { pool } from "../src/lib/db";

const controller = new AbortController();
const workerId = process.env.LABEL_SUITE_WORKER_ID
  ?? `${process.env.HOSTNAME ?? "local"}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    console.log(`[worker] ${signal} received; stopping after the active handler`);
    controller.abort(signal);
  });
}

console.log(`[worker] starting ${workerId}`);

let scheduling: Promise<void> | undefined;
function scheduleCalendars() {
  if (scheduling || controller.signal.aborted) return;
  scheduling = enqueueCalendarSyncs().catch((error) => console.error("[worker] calendar scheduling failed", error)).finally(() => { scheduling = undefined; });
}
scheduleCalendars();
const calendarTimer = setInterval(scheduleCalendars, 60_000);
calendarTimer.unref();
try {
  await runWorkerLoop(jobStore, jobHandlers, {
    workerId,
    signal: controller.signal,
    leaseMs: numberFromEnv("LABEL_SUITE_JOB_LEASE_MS", 60_000),
    heartbeatMs: numberFromEnv("LABEL_SUITE_JOB_HEARTBEAT_MS", 20_000),
    pollMs: numberFromEnv("LABEL_SUITE_JOB_POLL_MS", 1_000),
    onError(error, job) {
      console.error(`[worker] ${job?.id ?? "queue"} failed`, error);
    },
  });
} finally {
  clearInterval(calendarTimer);
  await scheduling;
  await pool.end();
  console.log(`[worker] stopped ${workerId}`);
}

function numberFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
