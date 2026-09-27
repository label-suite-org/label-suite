import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectedRows: Array<{ id: string }> = [];
  const inserted: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  const updateResults: Array<Array<{ id: string }>> = [];

  return {
    selectedRows,
    inserted,
    updated,
    updateResults,
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => selectedRows),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((value: Record<string, unknown>) => ({
          onConflictDoNothing: vi.fn(async () => inserted.push(value)),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((value: Record<string, unknown>) => {
          updated.push(value);
          return {
            where: vi.fn(() => ({
              returning: vi.fn(async () => updateResults.shift() ?? [{ id: "artist-1" }]),
            })),
          };
        }),
      })),
      transaction: vi.fn(async (callback: (transaction: typeof mocks.db) => Promise<unknown>) => callback(mocks.db)),
    },
  };
});

vi.mock("../lib/db", () => ({ db: mocks.db }));
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-a" })) }));
vi.mock("./integrations", () => audit);

import {
  createArtist,
  createArtistSchema,
  reviewArtistBio,
  nativeUpdateArtistSchema,
  updateArtistForNative,
  updateArtist,
  updateArtistSchema,
} from "./artists";

const bioDocument = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
});

describe("artist contact validation in mutations", () => {
  beforeEach(() => {
    mocks.selectedRows.length = 0;
    mocks.inserted.length = 0;
    mocks.updated.length = 0;
    mocks.updateResults.length = 0;
    vi.clearAllMocks();
  });

  it("rejects createArtist when contact belongs to another org", async () => {
    await expect(createArtist("org-1", {
      name: "Guest Artist",
      contact_id: "other-contact",
    } as never)).rejects.toThrow("Primary contact not found in active workspace");
    expect(mocks.inserted).toHaveLength(0);
  });

  it("accepts createArtist with in-org contact id", async () => {
    mocks.selectedRows.push({ id: "contact-1" });

    const result = await createArtist("org-1", {
      name: "Guest Artist",
      contact_id: "contact-1",
    } as never);

    expect(result.ok).toBe(true);
    expect(mocks.inserted[0]).toMatchObject({
      org_id: "org-1",
      name: "Guest Artist",
      contact_id: "contact-1",
    });
  });

  it("rejects updateArtist when contact belongs to another org", async () => {
    await expect(updateArtist("org-1", {
      id: "artist-1",
      contact_id: "other-contact",
    } as never)).rejects.toThrow("Primary contact not found in active workspace");
    expect(mocks.updated).toHaveLength(0);
  });

  it("accepts updateArtist with in-org contact id", async () => {
    mocks.selectedRows.push({ id: "contact-1" });

    const result = await updateArtist("org-1", {
      id: "artist-1",
      contact_id: "contact-1",
    } as never);

    expect(result.ok).toBe(true);
    expect(mocks.updated[0]).toMatchObject({
      contact_id: "contact-1",
      updated_at: expect.any(Date),
    });
  });

  it("stores a canonical bio document, safe HTML, and invalidates review on edit", async () => {
    await updateArtist("org-1", {
      id: "artist-1",
      bio_document: bioDocument('<script>alert("x")</script> Biography'),
    } as never);

    expect(mocks.updated[0]).toMatchObject({
      bio: '<script>alert("x")</script> Biography',
      bio_document: bioDocument('<script>alert("x")</script> Biography'),
      bio_html: '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; Biography</p>',
      bio_review_status: "draft",
      bio_reviewed_hash: null,
      bio_reviewed_at: null,
      bio_reviewed_by: null,
    });
  });

  it("reviews only an in-tenant current biography with actor provenance", async () => {
    mocks.selectedRows.push({
      id: "artist-1",
      bio: "Reviewed biography",
      bio_document: bioDocument("Reviewed biography"),
      bio_review_status: "draft",
      bio_reviewed_hash: null,
    } as never);

    await reviewArtistBio("org-1", "artist-1", "user-1");

    expect(mocks.updated[0]).toMatchObject({
      bio_review_status: "reviewed",
      bio_reviewed_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      bio_reviewed_by: "user-1",
      bio_reviewed_at: expect.any(Date),
    });
  });

  it("does not review over a concurrently changed biography", async () => {
    mocks.selectedRows.push({
      id: "artist-1",
      bio: "Draft biography",
      bio_document: bioDocument("Draft biography"),
      bio_review_status: "draft",
      bio_reviewed_hash: null,
    } as never);
    mocks.updateResults.push([]);

    await expect(reviewArtistBio("org-1", "artist-1", "user-1"))
      .rejects.toThrow("changed before review");
  });

  it("does not canonicalize or review a malformed stored biography fallback", async () => {
    mocks.selectedRows.push({
      id: "artist-1",
      bio: "Preserve this legacy biography",
      bio_document: { type: "script", content: [] },
      bio_review_status: "reviewed",
      bio_reviewed_hash: "older-review",
    } as never);

    await expect(reviewArtistBio("org-1", "artist-1", "user-1"))
      .rejects.toThrow("replace the invalid biography draft");
    expect(mocks.updated).toHaveLength(0);
  });

  it("keeps biography review capability- and authentication-gated", async () => {
    const { POST } = await import("../pages/api/artists/[id]/bio/review");

    const forbidden = await POST({
      locals: { orgId: "org-1", membershipRole: "member", user: { id: "user-1" } },
      params: { id: "artist-1" },
    } as never);
    expect(forbidden.status).toBe(403);

    const unauthenticated = await POST({
      locals: { orgId: "org-1", membershipRole: "operator" },
      params: { id: "artist-1" },
    } as never);
    expect(unauthenticated.status).toBe(401);
    expect(mocks.updated).toHaveLength(0);
  });
});

describe("native artist mutation contract", () => {
  beforeEach(() => {
    mocks.selectedRows.length = 0;
    mocks.updated.length = 0;
    mocks.updateResults.length = 0;
    audit.recordAuditEvent.mockClear();
  });

  it("requires a loaded timestamp and records actor-attributed before/after evidence", async () => {
    const updatedAt = new Date("2026-08-15T10:00:00.000Z");
    mocks.selectedRows.push({ id: "artist-1", org_id: "org-1", name: "Before", updated_at: updatedAt } as never);
    mocks.updateResults.push([{ id: "artist-1", org_id: "org-1", name: "After", updated_at: new Date("2026-08-15T10:01:00.000Z") } as never]);

    const result = await updateArtistForNative("org-1", {
      id: "artist-1", name: "After", expected_updated_at: updatedAt.toISOString(),
    } as never, "user-1");

    expect(result.id).toBe("artist-1");
    expect(audit.recordAuditEvent).toHaveBeenCalledWith("org-1", expect.objectContaining({
      actor_user_id: "user-1", event_type: "artist.updated", object_type: "artist", object_id: "artist-1",
      before: expect.objectContaining({ name: "Before" }), after: expect.objectContaining({ name: "After" }),
    }), mocks.db);
    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale timestamp before issuing an update", async () => {
    mocks.selectedRows.push({ id: "artist-1", org_id: "org-1", name: "Current", updated_at: new Date("2026-08-15T10:01:00.000Z") } as never);
    await expect(updateArtistForNative("org-1", {
      id: "artist-1", name: "Stale", expected_updated_at: "2026-08-15T10:00:00.000Z",
    } as never, "user-1")).rejects.toThrow("changed while updating");
    expect(mocks.updated).toHaveLength(0);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("keeps native edits capability-shaped and revision-required", () => {
    expect(nativeUpdateArtistSchema.safeParse({ name: "Artist", expected_updated_at: "2026-08-15T10:00:00.000Z" }).success).toBe(true);
    expect(nativeUpdateArtistSchema.safeParse({ name: "Artist" }).success).toBe(false);
  });
});

describe("artist relationship validation", () => {
  it("accepts supported relationship values and keeps contact links", () => {
    expect(createArtistSchema.parse({
      name: "Former Actress",
      relationship: "roster",
      contact_id: "contact-1",
    })).toMatchObject({
      name: "Former Actress",
      relationship: "roster",
      contact_id: "contact-1",
    });
  });

  it("normalizes blank relationship and contact values to null on update", () => {
    expect(updateArtistSchema.parse({
      id: "artist-1",
      relationship: "",
      contact_id: "   ",
    })).toMatchObject({
      id: "artist-1",
      relationship: null,
      contact_id: null,
    });
  });

  it("rejects unsupported relationship values", () => {
    expect(() => createArtistSchema.parse({
      name: "Guest Artist",
      relationship: "label",
    })).toThrow();
  });
});
