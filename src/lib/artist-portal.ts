import { z } from "zod";

export const contributorRoles = ["Music", "Lyrics", "Music & lyrics", "Producer", "Performer", "Mixing", "Mastering", "Other"] as const;
export const artistSubmissionSchema = z.object({
  id: z.uuid(),
  submitted_by: z.string().trim().min(1).max(160),
  email: z.email().max(254),
  release_title: z.string().trim().max(200),
  track_title: z.string().trim().min(1).max(200),
  version: z.string().trim().max(100),
  contributors: z.array(z.object({
    name: z.string().trim().min(1).max(160),
    role: z.enum(contributorRoles),
    details: z.string().trim().max(300),
  }).strict()).min(1).max(30),
  writing_shares: z.string().trim().max(2000),
  notes: z.string().trim().max(4000),
}).strict();

export type ArtistSubmission = z.infer<typeof artistSubmissionSchema>;
export type SharedAgreement = { id: string; name: string; status: string | null; file_link: string };
export type PortalSubmission = { id: string; details: ArtistSubmission; created_at: string; reviewed_at: string | null };
export type ArtistPortalData = {
  artist_name: string;
  agreements: { id: string; name: string; status: string | null }[];
  submissions: PortalSubmission[];
};
