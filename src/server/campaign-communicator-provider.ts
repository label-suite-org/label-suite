import type { CitationEvidence } from "./campaign-communicator-core";

export type ResearchSuggestionField = "musical_fit" | "pitch_angle" | "contact_route" | "programming_focus";

export type ResearchLeadInput = {
  campaign_name: string;
  artist_name: string;
  release_title: string;
  target_name: string;
  target_url: string | null;
};

export type ResearchSuggestion = {
  field: ResearchSuggestionField;
  value: string;
  rationale: string;
  evidence: CitationEvidence[];
};

export type ResearchLeadResult = {
  suggestions: ResearchSuggestion[];
};

export type CitedEvidence = readonly [CitationEvidence, ...CitationEvidence[]];

export type AcceptedDraftSuggestion = Omit<ResearchSuggestion, "evidence"> & {
  status: "accepted";
  evidence: CitedEvidence;
};

export type GenerateDraftInput = {
  campaign_name: string;
  artist_name: string;
  release_title: string;
  recipient_name: string | null;
  target_name: string;
  channel: "email" | "instagram_dm" | "soundcloud_message" | "other";
  instruction: string | null;
  suggestions: readonly AcceptedDraftSuggestion[];
};

export type GeneratedDraftResult = {
  subject: string | null;
  body: string;
};

/**
 * Generates domain data only. Persistence, approvals, pipeline stages, and sends
 * remain outside this server-only boundary.
 */
export interface CampaignCommunicatorProvider {
  id: "openrouter" | "disabled" | "test";
  model: string;
  researchLead(input: ResearchLeadInput): Promise<ResearchLeadResult>;
  generateDraft(input: GenerateDraftInput): Promise<GeneratedDraftResult>;
}

export { getCampaignCommunicatorProvider } from "./openrouter-campaign-communicator";
