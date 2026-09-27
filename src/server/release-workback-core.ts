import { openStatus, type ReleaseTimelineTask, type ReleaseTimelinePhaseKey } from "./release-timeline-core";

export const WORKBACK_CHECKLIST: { key: string; title: string; phase: ReleaseTimelinePhaseKey; offsetDays: number }[] = [
  { key: "scope", title: "Confirm tracklist and release plan", phase: "strategy_lock", offsetDays: -56 },
  { key: "masters", title: "Approve final masters", phase: "assets_metadata", offsetDays: -42 },
  { key: "artwork", title: "Approve final artwork", phase: "assets_metadata", offsetDays: -35 },
  { key: "metadata", title: "Complete metadata and credits", phase: "assets_metadata", offsetDays: -35 },
  { key: "delivery", title: "Deliver release to distributor", phase: "distribution_dsp", offsetDays: -28 },
  { key: "pitch", title: "Submit DSP pitch", phase: "distribution_dsp", offsetDays: -21 },
  { key: "announcement", title: "Publish release announcement", phase: "campaign_rollout", offsetDays: -21 },
  { key: "press", title: "Send press and radio follow-ups", phase: "campaign_rollout", offsetDays: -14 },
  { key: "launch", title: "Check live links and publish release posts", phase: "release_week", offsetDays: 0 },
  { key: "review", title: "Review release results and next actions", phase: "post_release", offsetDays: 14 },
];

export function dateAtOffset(releaseDate: string, days: number) {
  const date = new Date(`${releaseDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
export const normalizedTitle = (title: string) => title.trim().toLowerCase().replace(/\s+/g, " ");
export function workBucket(item: { status: string; dueDate: string | null }, today: string) {
  if (!openStatus(item.status)) return "Done";
  if (!item.dueDate) return "Unscheduled";
  if (item.dueDate < today) return "Overdue";
  return item.dueDate <= dateAtOffset(today, 7) ? "Next 7 days" : "Upcoming";
}
export function reschedulePreview(tasks: ReleaseTimelineTask[], releaseDate: string | null) {
  if (!releaseDate) return [];
  return tasks.filter((task) => openStatus(task.status) && task.offsetDays != null && task.dueDate !== dateAtOffset(releaseDate, task.offsetDays))
    .map((task) => ({ id: task.id, title: task.title, dueDate: task.dueDate, offsetDays: task.offsetDays!, updatedAt: task.updatedAt ?? null, newDate: dateAtOffset(releaseDate, task.offsetDays!) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
