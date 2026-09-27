import type { CampaignDocument } from "../lib/campaign-rich-text";

export type CampaignEditorSurface =
  | "campaign_goal"
  | "campaign_notes"
  | "public_release_note"
  | "focused_outreach_body"
  | "radio_update_body";

export type CampaignEditorOperation = "draft" | "enrich" | "improve" | "shorten" | "tone" | "custom";
export type CampaignEditorScope = "selection" | "document";

/**
 * The only input a document provider receives. Deliberately no callback,
 * tool, persistence, approval, publication, outreach, or domain-mutation
 * fields are representable here.
 */
export interface CampaignEditorAiProviderInput {
  surface: CampaignEditorSurface;
  operation: CampaignEditorOperation;
  scope: CampaignEditorScope;
  current_document: CampaignDocument;
  selected_document: CampaignDocument | null;
  instruction: string | null;
  context: {
    campaign: { id: string; name: string; goal: string; notes: string };
    release: { id: string; title: string; artist_name: string | null; track_titles: string[] } | null;
    lead: { id: string; target_name: string; musical_fit: string | null; pitch_angle: string | null } | null;
    prompt: { id: string; version: number; text: string } | null;
    accepted_research: Array<{ id: string; value: string; rationale: string; citation_ids: string[] }>;
  };
}

export interface CampaignEditorAiProvider {
  readonly id: "openrouter" | "disabled" | "test";
  readonly model: string;
  transform(input: CampaignEditorAiProviderInput): Promise<{
    replacement_document: CampaignDocument;
    rationale: string;
    citation_ids: string[];
  }>;
}

export const disabledCampaignEditorAiProvider: CampaignEditorAiProvider = {
  id: "disabled",
  model: "disabled",
  async transform(): Promise<never> {
    throw new Error("Campaign editor AI provider is disabled");
  },
};

export function createTestCampaignEditorAiProvider(
  transform: CampaignEditorAiProvider["transform"],
  model = "test-model",
): CampaignEditorAiProvider {
  return { id: "test", model, transform };
}
