import { listArtistOptions } from "./artists";
import { listCampaignOptions } from "./campaigns";
import { listContactOptions } from "./contacts";
import { listProjectDocuments } from "./documents";
import { listGrantApplications } from "./grants";
import { listProjectMediaAssets } from "./media-assets";
import { listOpsTasksForProject } from "./ops-tasks";
import { listProjectEvents } from "./project-events";
import { getProject, listProjects } from "./projects";
import { listReleaseOptions } from "./releases";

type ListItem = { id: string; [key: string]: unknown };
type EventSeamRow = {
  id: string;
  event_id?: string | null;
  linked_release_id?: string | null;
  linked_artist_id?: string | null;
  linked_contact_id?: string | null;
  linked_campaign_id?: string | null;
  [key: string]: unknown;
};
type CampaignSeamRow = {
  id: string;
  campaign_name: string | null;
  campaign_type: string | null;
  status: string | null;
  linked_artist_id: string | null;
  linked_release_id: string | null;
  [key: string]: unknown;
};

export type EventSharedContext = {
  shared_campaigns: {
    id: string;
    campaign_name: string | null;
    campaign_type: string | null;
    status: string | null;
    linked_artist_id: string | null;
    linked_release_id: string | null;
    artist_name?: string | null;
    release_title?: string | null;
  }[];
  tasks: EventSeamRow[];
  documents: { id: string; [key: string]: unknown }[];
  mediaAssets: { id: string; [key: string]: unknown }[];
};

export type ProjectWorkspaceEventContext = {
  event: {
    id?: string | null;
    artist_id: string | null;
    release_id: string | null;
    contact_id: string | null;
  };
  campaignRows: Array<CampaignSeamRow>;
  taskRows: Array<EventSeamRow>;
  documentRows: Array<{ id: string; release_id: string | null; artist_id: string | null; contact_id: string | null; [key: string]: unknown }>;
  mediaAssetRows: Array<{ id: string; linked_release_id: string | null; linked_artist_id: string | null; [key: string]: unknown }>;
};

function hasLink(eventValue: string | null, linkedValue: string | null | undefined) {
  return Boolean(eventValue && linkedValue && eventValue === linkedValue);
}

function mergeById<T extends ListItem>(left: T[] = [], right: T[] = []) {
  const deduped = [...left, ...right];
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const item of deduped) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

function isCampaignTask(task: EventSeamRow, campaignIds: string[]) {
  return Boolean(task.linked_campaign_id && campaignIds.includes(task.linked_campaign_id));
}

export function buildEventSharedContext(input: ProjectWorkspaceEventContext) {
  const matchingCampaignIds = input.campaignRows.map((campaign) => campaign.id);

  const matchingTasks = input.taskRows.filter((task) =>
    hasLink(input.event.id ?? null, task.event_id as string | null) ||
    hasLink(input.event.release_id, task.linked_release_id as string | null) ||
    hasLink(input.event.artist_id, task.linked_artist_id as string | null) ||
    hasLink(input.event.contact_id, task.linked_contact_id as string | null) ||
    isCampaignTask(task, matchingCampaignIds),
  );

  const matchingDocuments = input.documentRows.filter((document) =>
    hasLink(input.event.release_id, document.release_id) ||
    hasLink(input.event.artist_id, document.artist_id) ||
    hasLink(input.event.contact_id, document.contact_id),
  );

  const matchingMediaAssets = input.mediaAssetRows.filter((asset) =>
    hasLink(input.event.release_id, asset.linked_release_id) ||
    hasLink(input.event.artist_id, asset.linked_artist_id),
  );

  return {
    shared_campaigns: input.campaignRows,
    tasks: matchingTasks,
    documents: matchingDocuments,
    mediaAssets: matchingMediaAssets,
  };
}

export function mergeProjectAndSeamContext(projectWorkspace: {
  id?: string;
  name?: string;
  events?: ListItem[];
  tasks?: { id: string; [key: string]: unknown }[];
  documents?: { id: string; [key: string]: unknown }[];
  mediaAssets?: { id: string; [key: string]: unknown }[];
}, sharedContext: EventSharedContext) {
  return {
    ...projectWorkspace,
    tasks: mergeById(projectWorkspace.tasks || [], sharedContext.tasks as EventSeamRow[]),
    documents: mergeById(projectWorkspace.documents || [], sharedContext.documents as { id: string; [key: string]: unknown }[]),
    mediaAssets: mergeById(projectWorkspace.mediaAssets || [], sharedContext.mediaAssets as { id: string; [key: string]: unknown }[]),
    shared_campaigns: sharedContext.shared_campaigns,
  };
}

export function hasEventSharedContext(context: EventSharedContext) {
  return context.shared_campaigns.length > 0 || context.tasks.length > 0 || context.documents.length > 0 || context.mediaAssets.length > 0;
}

/** Aggregates existing tenant-scoped shared records without copying them into Events tables. */
export async function getProjectWorkspaceDetail(orgId: string, projectId: string) {
  const project = await getProject(orgId, projectId);
  if (!project) return null;

  const [events, tasks, documents, mediaAssets, grantApplications, artists, releases, campaigns, contacts, projects] = await Promise.all([
    listProjectEvents(orgId, { project_id: projectId }),
    listOpsTasksForProject(orgId, projectId),
    listProjectDocuments(orgId, projectId),
    listProjectMediaAssets(orgId, projectId),
    listGrantApplications(orgId).then((items) => items.filter((item) => item.project_id === projectId)),
    listArtistOptions(orgId), listReleaseOptions(orgId), listCampaignOptions(orgId), listContactOptions(orgId), listProjects(orgId),
  ]);

  return {
    workspace: { ...project, events, tasks, documents, mediaAssets, grantApplications },
    options: { artists, releases, campaigns, contacts, projects: projects.map(({ id, name }) => ({ id, name })) },
  };
}
