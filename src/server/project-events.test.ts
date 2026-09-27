import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const eventRows: Array<Record<string, unknown>>[] = [];
  const limitRows: Array<Record<string, unknown>[]> = [];
  const inserted: Array<Record<string, unknown>> = [];
  const updatedRows: Array<{ id: string }> = [{ id: "event-1" }];
  const updated: Array<Record<string, unknown>> = [];

  const baseWhere = () => ({
    limit: vi.fn(async () => limitRows.length ? limitRows.shift()! : []),
    orderBy: vi.fn(async () => eventRows.length ? eventRows.shift()! : []),
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
      set: vi.fn((value: Record<string, unknown>) => {
        updated.push(value);
        return {
          where: vi.fn(() => ({ returning: vi.fn(async () => updatedRows) })),
        };
      }),
    })),
  };

  return { db, eventRows, limitRows, inserted, updatedRows, updated };
});

vi.mock("../lib/db", () => ({ db: mocks.db }));

import { NotFoundError } from "./errors";
import { createProjectEvent, getProjectEvent, listProjectEvents, updateProjectEvent } from "./project-events";
import { eventTypeSchema } from "../lib/projects-events-core";


describe("project event mutations", () => {
  beforeEach(() => {
    mocks.eventRows.length = 0;
    mocks.limitRows.length = 0;
    mocks.inserted.length = 0;
    mocks.updated.length = 0;
    mocks.updatedRows.length = 0;
    mocks.updatedRows.push({ id: "event-1" });
    vi.clearAllMocks();
  });

  test.each(["tour", "release_party", "music_video_production"])("accepts the approved %s event type", (eventType) => {
    expect(eventTypeSchema.parse(eventType)).toBe(eventType);
  });

  test("creates standalone events without project lookup", async () => {
    const result = await createProjectEvent("org-1", {
      title: "Press shoot",
      event_type: "shoot",
      start_date: "2026-08-02",
      project_id: null,
    } as never);

    expect(result.id).toEqual(expect.any(String));
    expect(mocks.db.select).not.toHaveBeenCalled();
    expect(mocks.inserted[0]).toMatchObject({ org_id: "org-1", project_id: null, all_day: true });
  });

  test("accepts event attached to in-tenant project", async () => {
    mocks.limitRows.push([{ id: "project-1" }]);
    await createProjectEvent("org-1", {
      title: "Show",
      event_type: "concert",
      start_date: "2026-08-03",
      project_id: "project-1",
    } as never);

    expect(mocks.db.select).toHaveBeenCalled();
    expect(mocks.inserted[0]).toMatchObject({ org_id: "org-1", project_id: "project-1" });
  });

  test("rejects an event project from another workspace", async () => {
    await expect(createProjectEvent("org-1", {
      title: "Show",
      event_type: "concert",
      start_date: "2026-08-03",
      project_id: "other-org-project",
    } as never)).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.inserted).toHaveLength(0);
  });

  test("rejects a non-tenant event artist", async () => {
    await expect(createProjectEvent("org-1", {
      title: "Rehearsal",
      event_type: "rehearsal",
      start_date: "2026-08-01",
      artist_id: "other-org-artist",
    } as never)).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.inserted).toHaveLength(0);
  });

  test("rejects a non-tenant event release", async () => {
    await expect(createProjectEvent("org-1", {
      title: "Release party",
      event_type: "release_party",
      start_date: "2026-08-01",
      release_id: "other-org-release",
    } as never)).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.inserted).toHaveLength(0);
  });

  test("rejects a non-tenant event contact", async () => {
    await expect(createProjectEvent("org-1", {
      title: "Press",
      event_type: "meeting",
      start_date: "2026-08-01",
      contact_id: "other-org-contact",
    } as never)).rejects.toBeInstanceOf(NotFoundError);
  });

  test("rejects a non-tenant owner contact", async () => {
    await expect(createProjectEvent("org-1", {
      title: "Press",
      event_type: "meeting",
      start_date: "2026-08-01",
      owner_contact_id: "other-org-owner",
    } as never)).rejects.toBeInstanceOf(NotFoundError);
  });

  test("detaches an event by writing a null project link", async () => {
    await updateProjectEvent("org-1", { id: "event-1", project_id: null } as never);
    expect(mocks.db.select).not.toHaveBeenCalled();
    expect(mocks.updated[0]).toMatchObject({ project_id: null });
  });
});

describe("project event read paths", () => {
  test("lists and gets event records", async () => {
    mocks.eventRows.push([{ id: "event-1", project_id: "project-1" }]);
    const rows = await listProjectEvents("org-1", { project_id: "project-1" });
    expect(rows).toHaveLength(1);

    mocks.limitRows.push([{ id: "event-1" }]);
    const row = await getProjectEvent("org-1", "event-1");
    expect(row).toMatchObject({ id: "event-1" });
  });
});
