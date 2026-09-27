import type { loadCampaignDiscoveryWorkspace } from "./campaign-discovery";

type DiscoveryWorkspace = Awaited<ReturnType<typeof loadCampaignDiscoveryWorkspace>>;
type DiscoveryRun = DiscoveryWorkspace["runs"][number];
type DiscoveryCandidate = DiscoveryRun["channels"][number];
type DiscoveryEvidence = DiscoveryCandidate["evidence"][number];

function projectEvidence(evidence: DiscoveryEvidence) {
  return {
    id: evidence.provider_item_id,
    title: evidence.title,
    url: evidence.url,
    published_at: evidence.published_at,
    provenance: {
      provider: evidence.provider,
      query: evidence.query,
      retrieved_at: evidence.retrieved_at,
    },
  };
}

function projectCandidate(candidate: DiscoveryCandidate) {
  const accepted = candidate.review.state === "promoted" && candidate.review.promoted_lead_id !== null;
  return {
    identity: {
      provider: "youtube",
      channel_id: candidate.provider_channel_id,
      title: candidate.title,
      url: candidate.url,
    },
    evidence: candidate.evidence.map(projectEvidence),
    exact_match_evidence: candidate.exact_match_evidence.map(projectEvidence),
    prospective_fit: candidate.prospective_fit,
    relevance: candidate.relevance,
    activity_freshness: candidate.activity_freshness,
    review: candidate.review,
    proposal_status: candidate.review.state,
    canonical_promotion: accepted
      ? { status: "accepted", lead_id: candidate.review.promoted_lead_id, outcome: candidate.review.promotion_outcome }
      : { status: "not_accepted", lead_id: null, outcome: null },
  };
}

/** Native read projection; discovery candidates remain non-canonical until explicit promotion. */
export function projectNativeCampaignDiscoveryWorkspace(workspace: DiscoveryWorkspace) {
  return {
    availability: workspace.availability,
    query_preview: workspace.query_preview,
    estimated_cost_units: workspace.estimated_cost_units,
    runs: workspace.runs.map((run) => ({
      id: run.id,
      status: run.status,
      created_at: run.created_at,
      estimated_cost_units: run.estimated_cost_units,
      queries: run.queries,
      candidates: run.channels.map(projectCandidate),
      truncation: run.truncation,
    })),
    page: workspace.page,
  };
}
