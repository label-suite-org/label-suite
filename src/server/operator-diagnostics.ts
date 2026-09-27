import type { QueueHealth } from "./jobs/types";
import { projectNativeReleaseDetail, type NativeReleaseDetailSource } from "./native-releases";
import type { ReleaseTimeline } from "./release-timeline-core";
import { LocalToolError } from "./local-tools-api";
import type {
  OperatorJobsHealth,
  OperatorOperationsBrief,
  OperatorOperationsBriefInput,
} from "../lib/operator-diagnostics-contract";

type ReleaseDetail = Omit<NativeReleaseDetailSource, "timeline">;
type CampaignDetail = {
  id: string;
  campaign_name: string;
  campaign_type: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  goal: string | null;
  linked_release_id: string | null;
  release_title: string | null;
  linked_artist_id: string | null;
  artist_name: string | null;
};

export type OperatorDiagnosticsDependencies = {
  getJobsHealth(orgId: string): Promise<QueueHealth>;
  getReleaseDetail(orgId: string, releaseId: string): Promise<ReleaseDetail | null>;
  getReleaseTimeline(orgId: string, releaseId: string): Promise<ReleaseTimeline>;
  getCampaignDetail(orgId: string, campaignId: string): Promise<CampaignDetail | null>;
};

const defaultDependencies: OperatorDiagnosticsDependencies = {
  getJobsHealth: async (orgId) => (await import("./jobs")).jobStore.health(orgId),
  getReleaseDetail: async (orgId, releaseId) => (await import("./releases")).getReleaseDetail(orgId, releaseId),
  getReleaseTimeline: async (orgId, releaseId) => (await import("./release-timeline")).getReleaseTimeline(orgId, releaseId),
  getCampaignDetail: async (orgId, campaignId) => (await import("./campaigns")).getCampaignDetail(orgId, campaignId),
};

export async function getOperatorJobsHealth(
  orgId: string,
  dependencies: OperatorDiagnosticsDependencies = defaultDependencies,
): Promise<OperatorJobsHealth> {
  const health = await dependencies.getJobsHealth(orgId);
  return {
    queued: health.queued,
    running: health.running,
    failed: health.failed,
    oldest_queued_at: health.oldestQueuedAt?.toISOString() ?? null,
    expired_leases: health.expiredLeases,
    active_workers: health.activeWorkers,
  };
}

export async function getOperatorOperationsBrief(
  orgId: string,
  input: OperatorOperationsBriefInput,
  dependencies: OperatorDiagnosticsDependencies = defaultDependencies,
): Promise<OperatorOperationsBrief> {
  if (input.resource_type === "campaign") {
    const campaign = await dependencies.getCampaignDetail(orgId, input.resource_id);
    if (!campaign) throw new LocalToolError("not_found");
    return projectCampaignOperationsBrief(campaign);
  }

  const release = await dependencies.getReleaseDetail(orgId, input.resource_id);
  if (!release) throw new LocalToolError("not_found");
  const timeline = await dependencies.getReleaseTimeline(orgId, input.resource_id);
  const projected = projectNativeReleaseDetail({
    ...release,
    timeline: {
      ...timeline,
      childReleases: timeline.phases.flatMap((phase) => phase.childReleases),
    },
  });
  return {
    resource_type: "release",
    record: {
      id: projected.release.id,
      title: projected.release.title,
      artist_name: projected.release.artist_name,
      status: projected.release.status,
      release_date: projected.release.release_date,
      format: projected.release.format,
      phase: projected.phase,
    },
    readiness: {
      state: projected.readiness.state,
      blockers: projected.readiness.blockers.slice(0, 20),
      next_action: projected.next_action,
    },
  };
}

export function projectCampaignOperationsBrief(campaign: CampaignDetail): OperatorOperationsBrief {
  const blockers: Array<{ code: "release" | "artist" | "goal"; message: string }> = [];
  if (!campaign.linked_release_id) blockers.push({ code: "release", message: "No release is linked." });
  if (!campaign.linked_artist_id) blockers.push({ code: "artist", message: "No artist is linked." });
  if (!campaign.goal?.trim()) blockers.push({ code: "goal", message: "No campaign goal is recorded." });

  return {
    resource_type: "campaign",
    record: {
      id: campaign.id,
      name: campaign.campaign_name,
      campaign_type: campaign.campaign_type,
      status: campaign.status,
      start_date: campaign.start_date,
      end_date: campaign.end_date,
      linked_release_id: campaign.linked_release_id,
      release_title: campaign.release_title,
      linked_artist_id: campaign.linked_artist_id,
      artist_name: campaign.artist_name,
      goal_recorded: Boolean(campaign.goal?.trim()),
    },
    readiness: {
      state: blockers.length > 0 ? "attention" : "clear",
      blockers,
      next_action: {
        label: blockers.length > 0 ? "Review campaign" : "Open campaign",
        href: `/campaigns/${encodeURIComponent(campaign.id)}`,
      },
    },
  };
}
