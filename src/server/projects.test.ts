import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const inserted: Array<Record<string, unknown>> = [];
  const updatedRows: Array<{ id: string }> = [{ id: "project-1" }];
  const limitRows: Array<{ id: string }>[] = [];
  const orderByRows: Array<Record<string, unknown>>[] = [];

  const baseWhere = () => ({
    limit: vi.fn(async () => limitRows.length ? limitRows.shift()! : []),
    orderBy: vi.fn(async () => orderByRows.length ? orderByRows.shift()! : []),
  });

  const queryChain: any = {
    leftJoin: vi.fn(() => queryChain),
    where: vi.fn(() => baseWhere()),
  };

  const db = {
    transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>): Promise<unknown> => work(db)),
    select: vi.fn(() => ({
      from: vi.fn(() => queryChain),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((value: Record<string, unknown>) => {
        inserted.push(value);
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ returning: vi.fn(async () => updatedRows) })),
      })),
    })),
  };

  return {
    db,
    inserted,
    limitRows,
    orderByRows,
    updatedRows,
  };
});

vi.mock("../lib/db", () => ({ db: mocks.db }));

import { createDocument, listProjectDocuments, updateDocument } from "./documents";
import { createMediaAsset, listProjectMediaAssets, updateMediaAsset } from "./media-assets";
import { createProject, getProject, listProjects, updateProject } from "./projects";
import { buildEventSharedContext, hasEventSharedContext, mergeProjectAndSeamContext } from "./project-workspace";

const project = {
  id: "project-1",
  name: "Autumn tour",
  project_type: "tour",
  status: "planning",
};

describe("project mutation validation", () => {
  beforeEach(() => {
    mocks.inserted.length = 0;
    mocks.updatedRows.length = 0;
    mocks.updatedRows.push({ id: "project-1" });
    mocks.limitRows.length = 0;
    mocks.orderByRows.length = 0;
    vi.clearAllMocks();
  });

  test("creates project metadata with new fields", async () => {
    mocks.limitRows.push([{ id: "contact-2" }]);
    const result = await createProject("org-1", {
      name: "Autumn tour",
      project_type: "tour",
      description: "Nordic launch window",
      owner_contact_id: "contact-2",
      start_date: "2026-08-01",
      end_date: "2026-08-15",
      location_name: "Copenhagen",
      country_code: "DK",
      timezone: "Europe/Copenhagen",
      health: "on_track",
      status: "planned",
      currency: "DKK",
      total_planned: 12000,
      baseline_funding: 10000,
      track_count: 2,
      singles_count: 1,
      notes: "Primary kickoff",
    });

    expect(result.id).toEqual(expect.any(String));
    expect(result).toMatchObject({ ok: true });
    expect(mocks.inserted[0]).toMatchObject({
      org_id: "org-1",
      name: "Autumn tour",
      project_type: "tour",
      description: "Nordic launch window",
      owner_contact_id: "contact-2",
      start_date: "2026-08-01",
      end_date: "2026-08-15",
      location_name: "Copenhagen",
      country_code: "DK",
      timezone: "Europe/Copenhagen",
      health: "on_track",
      total_planned: 12000,
      baseline_funding: 10000,
      track_count: 2,
      singles_count: 1,
      notes: "Primary kickoff",
    });
  });

  test("rejects an artist link that is not in the same workspace", async () => {
    await expect(createProject("org-1", {
      name: "Tour",
      artist_id: "other-org-artist",
    } as never)).rejects.toThrow("Artist not found in active workspace");

    expect(mocks.inserted).toHaveLength(0);
  });

  test("rejects a release link that is not in the same workspace", async () => {
    mocks.limitRows.push([]);
    await expect(createProject("org-1", {
      name: "Tour",
      release_id: "other-org-release",
    } as never)).rejects.toThrow("Release not found in active workspace");
    expect(mocks.inserted).toHaveLength(0);
  });

  test("rejects an owner contact not in the same workspace", async () => {
    mocks.limitRows.push([{ id: "artist-1" }]);
    mocks.limitRows.push([]);
    await expect(createProject("org-1", {
      name: "Tour",
      artist_id: "artist-1",
      owner_contact_id: "other-org-contact",
    } as never)).rejects.toThrow("Contact not found in active workspace");
    expect(mocks.inserted).toHaveLength(0);
  });

  test("rejects update when project is outside the organization", async () => {
    mocks.updatedRows.length = 0;
    await expect(updateProject("org-1", { id: "other-org-project", name: "Changed" } as never))
      .rejects.toThrow("Project not found");
  });
});

describe("project scoped helpers", () => {
  test("lists documents linked to a project", async () => {
    mocks.orderByRows.push([{ id: "doc-1", project_id: "project-1", name: "Scope notes" }]);
    mocks.orderByRows.push([{ id: "asset-1", project_id: "project-1", asset_name: "Poster" }]);

    const rows = await listProjectDocuments("org-1", "project-1");
    const mediaRows = await listProjectMediaAssets("org-1", "project-1");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "doc-1", project_id: "project-1" });
    expect(mediaRows).toHaveLength(1);
    expect(mediaRows[0]).toMatchObject({ id: "asset-1", project_id: "project-1" });
  });

  test("rejects createDocument when project_id is outside active workspace", async () => {
    mocks.limitRows.push([]);
    await expect(createDocument("org-1", { name: "Specsheet", project_id: "other-project" } as never)).rejects.toThrow(
      "Project not found in active workspace",
    );
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  test("rejects updateDocument when project_id is outside active workspace", async () => {
    mocks.limitRows.push([]);
    await expect(updateDocument("org-1", { id: "document-1", project_id: "other-project" } as never)).rejects.toThrow(
      "Project not found in active workspace",
    );
  });
});

describe("document and media link guards", () => {
  test.each([
    ["artist", { name: "Contract", artist_id: "other-artist" }, "Artist not found in active workspace"],
    ["release", { name: "Contract", release_id: "other-release" }, "Release not found in active workspace"],
    ["contact", { name: "Contract", contact_id: "other-contact" }, "Contact not found in active workspace"],
  ])("rejects a document %s owner outside the active workspace", async (_owner, input, message) => {
    mocks.limitRows.push([]);
    await expect(createDocument("org-1", input as never)).rejects.toThrow(message);
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  test.each([
    ["artist", { asset_name: "Poster", linked_artist_id: "other-artist" }, "Artist not found in active workspace"],
    ["release", { asset_name: "Poster", linked_release_id: "other-release" }, "Release not found in active workspace"],
  ])("rejects a media %s owner outside the active workspace", async (_owner, input, message) => {
    mocks.limitRows.push([]);
    await expect(createMediaAsset("org-1", input as never)).rejects.toThrow(message);
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  test("rejects createMediaAsset when project_id is outside active workspace", async () => {
    mocks.limitRows.push([]);
    await expect(createMediaAsset("org-1", { asset_name: "Poster", project_id: "other-project" } as never)).rejects.toThrow(
      "Project not found in active workspace",
    );
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  test("rejects updateMediaAsset when project_id is outside active workspace", async () => {
    mocks.limitRows.push([]);
    await expect(updateMediaAsset("org-1", { id: "media-1", project_id: "other-project" } as never)).rejects.toThrow(
      "Project not found in active workspace",
    );
  });

  test("does not match null-link seam rows", () => {
    const sharedContext = buildEventSharedContext({
      event: { id: null, artist_id: null, release_id: null, contact_id: null },
      campaignRows: [],
      taskRows: [
        { id: "task-1", linked_release_id: null, linked_artist_id: null, linked_contact_id: null },
        { id: "task-2", linked_release_id: "release-1", linked_artist_id: null, linked_contact_id: null },
      ],
      documentRows: [{ id: "doc-1", release_id: null, artist_id: null, contact_id: null, name: "Sheet" }],
      mediaAssetRows: [{ id: "asset-1", linked_release_id: null, linked_artist_id: null, asset_name: "Photo" }],
    });

    expect(hasEventSharedContext(sharedContext)).toBe(false);
    expect(sharedContext).toMatchObject({ tasks: [], documents: [], mediaAssets: [] });
  });

  test("preserves project workspace rows while adding seam links", () => {
    const sharedContext = buildEventSharedContext({
      event: { id: "event-1", artist_id: "artist-1", release_id: "release-1", contact_id: null },
      campaignRows: [{ id: "campaign-1", campaign_name: "Launch", campaign_type: "social", status: "active", linked_artist_id: "artist-1", linked_release_id: null }],
      taskRows: [
        { id: "task-project", task_name: "Project task", status: "todo" },
        { id: "task-seam", linked_release_id: "release-1", task_name: "Seam task", status: "todo", event_id: null, linked_artist_id: null, linked_contact_id: null, linked_campaign_id: null },
      ],
      documentRows: [
        { id: "doc-project", name: "Project doc", release_id: null, artist_id: null, contact_id: null },
        { id: "doc-seam", name: "Seam doc", release_id: "release-1", artist_id: null, contact_id: null },
      ],
      mediaAssetRows: [
        { id: "asset-project", asset_name: "Project asset", linked_release_id: null, linked_artist_id: null },
        { id: "asset-seam", asset_name: "Seam asset", linked_release_id: "release-1", linked_artist_id: null },
      ],
    });

    const mergedContext = mergeProjectAndSeamContext({
      id: "project-1",
      name: "Autumn tour",
      events: [{ id: "event-project", title: "Project event" }],
      tasks: [{ id: "task-project", task_name: "Project task", status: "todo" }],
      documents: [{ id: "doc-project", name: "Project doc" }],
      mediaAssets: [{ id: "asset-project", asset_name: "Project asset" }],
    }, sharedContext);

    expect(mergedContext.name).toBe("Autumn tour");
    expect(mergedContext.tasks).toHaveLength(2);
    expect(mergedContext.documents).toHaveLength(2);
    expect(mergedContext.mediaAssets).toHaveLength(2);
    expect(mergedContext.tasks.map((task) => task.id)).toEqual(expect.arrayContaining(["task-project", "task-seam"]));
    expect(mergedContext.documents.map((doc) => doc.id)).toEqual(expect.arrayContaining(["doc-project", "doc-seam"]));
    expect(mergedContext.mediaAssets.map((asset) => asset.id)).toEqual(expect.arrayContaining(["asset-project", "asset-seam"]));
  });

  test("adds tasks that explicitly link to the event", () => {
    const sharedContext = buildEventSharedContext({
      event: { id: "event-1", artist_id: null, release_id: null, contact_id: null },
      campaignRows: [],
      taskRows: [
        { id: "task-event", event_id: "event-1", linked_release_id: null, linked_artist_id: null, linked_contact_id: null },
        { id: "task-other-event", event_id: "event-2", linked_release_id: null, linked_artist_id: null, linked_contact_id: null },
      ],
      documentRows: [],
      mediaAssetRows: [],
    });

    expect(sharedContext.tasks.map((task) => task.id)).toEqual(["task-event"]);
  });
});

describe("project read paths", () => {
  test("lists and gets projects", async () => {
    mocks.orderByRows.push([{ ...project }]);
    const rows = await listProjects("org-1");
    expect(rows).toHaveLength(1);

    mocks.limitRows.push([project]);
    const row = await getProject("org-1", "project-1");
    expect(row).toMatchObject(project);
  });
});
