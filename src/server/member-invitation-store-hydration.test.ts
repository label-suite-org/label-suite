import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  execute: vi.fn(), insert: vi.fn(), update: vi.fn(), select: vi.fn(),
  transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(database)),
}));

vi.mock("../lib/db", () => ({ db: database }));
vi.mock("./email", () => ({ sendWorkspaceInvitationEmail: vi.fn() }));

import { acceptInvitation, getInvitationContext, hashInvitationToken, listWorkspaceInvitations } from "./member-invitations";

const rawInvitation = (overrides: Record<string, unknown> = {}) => ({
  id: "inv-1", org_id: "org-1", email: "julie@example.com", normalized_email: "julie@example.com",
  role: "fundraiser", token_digest: hashInvitationToken("raw-token"), status: "pending",
  invited_by_user_id: "owner-1", accepted_by_user_id: null,
  expires_at: "2099-07-20 12:00:00.000", accepted_at: "2026-07-14 12:00:00.000", revoked_at: null,
  last_sent_at: "2026-07-13 12:00:00.000", created_at: "2026-07-13 10:30:00.000",
  ...overrides,
});

describe("raw invitation timestamp hydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.execute.mockResolvedValue({ rows: [rawInvitation()] });
  });

  it("hydrates raw timestamp strings before invitation context expiry checks", async () => {
    await expect(getInvitationContext("raw-token")).resolves.toEqual({ email: "julie@example.com" });
  });

  it("hydrates raw timestamp strings before accepting an invitation", async () => {
    database.insert
      .mockReturnValueOnce({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [{ id: "membership-1" }] }) }) })
      .mockReturnValueOnce({ values: async () => undefined });
    database.update.mockReturnValue({ set: () => ({ where: () => ({ returning: async () => [{ id: "inv-1" }] }) }) });

    await expect(acceptInvitation({ token: "raw-token", userId: "user-1", userEmail: "julie@example.com" }))
      .resolves.toMatchObject({ orgId: "org-1", role: "fundraiser", alreadyAccepted: false });
  });

  it("matches Drizzle UTC semantics for raw timestamp-without-timezone strings", async () => {
    database.select.mockReturnValue({
      from: () => ({ where: () => ({ orderBy: async () => [rawInvitation()] }) }),
    });
    const [invitation] = await listWorkspaceInvitations("org-1");
    expect(invitation.expiresAt).toEqual(new Date("2099-07-20T12:00:00.000Z"));
    expect(invitation.acceptedAt).toEqual(new Date("2026-07-14T12:00:00.000Z"));
    expect(invitation.lastSentAt).toEqual(new Date("2026-07-13T12:00:00.000Z"));
    expect(invitation.createdAt).toEqual(new Date("2026-07-13T10:30:00.000Z"));
  });

  it("preserves nullable expiry compatibility as an expired invitation", async () => {
    database.execute.mockResolvedValue({ rows: [rawInvitation({ expires_at: null })] });
    await expect(getInvitationContext("raw-token")).rejects.toMatchObject({ code: "INVITATION_INVALID" });
  });

  it("rejects malformed non-null timestamp data", async () => {
    database.select.mockReturnValue({
      from: () => ({ where: () => ({ orderBy: async () => [rawInvitation({ expires_at: "not-a-date" })] }) }),
    });
    await expect(listWorkspaceInvitations("org-1")).rejects.toThrow("Invitation row has invalid expires_at");
  });
});
