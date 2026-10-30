import { z } from "zod";

const id = z.string().trim().min(1).max(160);
export const pitchDraftSchema = z.object({
  id: z.uuid(),
  expected_version: z.number().int().nonnegative(),
  campaign_id: id.nullable(),
  sync_deal_id: id.nullable(),
  release_id: id,
  contact_id: id,
  title: z.string().trim().min(1).max(180),
  message: z.string().trim().max(4000),
  credits: z.string().trim().max(2000),
  rights_note: z.string().trim().max(2000),
  reply_email: z.email().max(254),
  file_ids: z.array(id).min(1).max(30).refine(ids => new Set(ids).size === ids.length, "Choose each version only once"),
  downloads: z.boolean(),
}).strict().refine(input => Boolean(input.campaign_id) !== Boolean(input.sync_deal_id), "Choose one campaign or sync opportunity");
export type PitchDraft = z.infer<typeof pitchDraftSchema>;

export const pitchFollowupSchema = z.object({
  id: z.uuid(), expected_version: z.number().int().positive(),
  status: z.enum(["draft", "sent", "replied", "closed"]),
  sent_date: z.iso.date().nullable(),
  response_note: z.string().trim().max(4000),
  next_action: z.string().trim().max(500),
  due_date: z.iso.date().nullable(),
}).strict().refine(input => !["sent", "replied"].includes(input.status) || Boolean(input.sent_date), "Record the date sent")
  .refine(input => !input.due_date || Boolean(input.next_action), "Add the next action for this follow-up date");

export interface PitchRecording {
  file_id: string; track_id: string; box_id: string; title: string;
  file_name: string; version: string | null; isrc: string | null;
}

export function pitchPublicPath(orgId: string, token: string) {
  return `/listen/${encodeURIComponent(orgId)}/${token}`;
}

// Project/folder/stack scopes can silently gain new files. A pitch uses only
// individually selected files, with access to other versions disabled.
export function pitchPlayerInput(pitch: { id: string; remote_project_id: string; recordings: PitchRecording[]; downloads: boolean }) {
  return {
    name: `Label Suite pitch ${pitch.id}`, projectid: pitch.remote_project_id,
    boxids: pitch.recordings.map(file => file.box_id), public: false,
    upload: { enabled: false },
    options: { downloads: pitch.downloads, comments: false, stacks: false, metadata: false, isrc: false, studio: true, samplyCTA: false },
  };
}

export function pitchPlayerMatches(player: { projectid: string; folderid?: string | null; boxids?: string[] | null; options?: { stacks?: boolean; downloads?: boolean; comments?: boolean } | null }, pitch: Parameters<typeof pitchPlayerInput>[0]) {
  const ids = pitch.recordings.map(file => file.box_id);
  return player.projectid === pitch.remote_project_id && !player.folderid
    && player.boxids?.length === ids.length && new Set(player.boxids).size === ids.length
    && ids.every(id => player.boxids!.includes(id))
    && player.options?.stacks === false && player.options.downloads === pitch.downloads && player.options.comments === false;
}
