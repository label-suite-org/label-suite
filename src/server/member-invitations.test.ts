import { createHash } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  INVITATION_TTL_MS,
  acceptInvitation,
  changeMemberRole,
  createInvitation,
  hashInvitationToken,
  normalizeInvitationEmail,
  removeMember,
  resendInvitation,
  revokeInvitation,
  type InvitationRecord,
  type MemberInvitationDependencies,
  type WorkspaceMemberRecord,
} from "./member-invitations";

const NOW = new Date("2026-07-13T12:00:00.000Z");

function invitation(overrides: Partial<InvitationRecord> = {}): InvitationRecord {
  return {
    id: "inv-1",
    orgId: "org-1",
    email: "julie@example.com",
    normalizedEmail: "julie@example.com",
    role: "fundraiser",
    tokenDigest: hashInvitationToken("old-token"),
    status: "pending",
    invitedByUserId: "owner-1",
    acceptedByUserId: null,
    expiresAt: new Date(NOW.getTime() + INVITATION_TTL_MS),
    acceptedAt: null,
    revokedAt: null,
    lastSentAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

function member(overrides: Partial<WorkspaceMemberRecord> = {}): WorkspaceMemberRecord {
  return {
    membershipId: "membership-1",
    orgId: "org-1",
    userId: "user-1",
    name: "Julie",
    email: "julie@example.com",
    role: "fundraiser",
    joinedAt: NOW,
    ...overrides,
  };
}

function createHarness() {
  const state = {
    invitations: [] as InvitationRecord[],
    members: [] as WorkspaceMemberRecord[],
    audits: [] as Array<Record<string, unknown>>,
    lockCount: 0,
    bootstrapDigests: [] as string[],
    adoptedContexts: [] as Array<{ orgId: string; userId?: string }>,
  };

  const tx = {
    findMemberByEmail: vi.fn(async (orgId: string, normalizedEmail: string) =>
      state.members.find((row) => row.orgId === orgId && normalizeInvitationEmail(row.email) === normalizedEmail) ?? null),
    findMemberByUserId: vi.fn(async (orgId: string, userId: string) =>
      state.members.find((row) => row.orgId === orgId && row.userId === userId) ?? null),
    countOwners: vi.fn(async (orgId: string) => state.members.filter((row) => row.orgId === orgId && row.role === "owner").length),
    findPendingInvitation: vi.fn(async (orgId: string, normalizedEmail: string) =>
      state.invitations.find((row) => row.orgId === orgId && row.normalizedEmail === normalizedEmail && row.status === "pending") ?? null),
    findInvitationById: vi.fn(async (orgId: string, id: string) =>
      state.invitations.find((row) => row.orgId === orgId && row.id === id) ?? null),
    adoptInvitationBootstrap: vi.fn(async (digest: string) => {
      state.bootstrapDigests.push(digest);
    }),
    findInvitationByDigest: vi.fn(async (digest: string) =>
      state.invitations.find((row) => row.tokenDigest === digest) ?? null),
    findInvitationByDigestForUpdate: vi.fn(async (digest: string) => {
      state.lockCount += 1;
      return state.invitations.find((row) => row.tokenDigest === digest) ?? null;
    }),
    adoptInvitationContext: vi.fn(async (orgId: string, userId?: string) => {
      state.adoptedContexts.push({ orgId, userId });
    }),
    insertInvitation: vi.fn(async (row: InvitationRecord) => state.invitations.push(row)),
    updateInvitation: vi.fn(async (
      id: string,
      changes: Partial<InvitationRecord>,
      expectation?: { status?: string; tokenDigest?: string | null },
    ) => {
      const row = state.invitations.find((candidate) => candidate.id === id);
      if (!row) return false;
      if (expectation?.status !== undefined && row.status !== expectation.status) return false;
      if (expectation?.tokenDigest !== undefined && row.tokenDigest !== expectation.tokenDigest) return false;
      Object.assign(row, changes);
      return true;
    }),
    insertMembership: vi.fn(async (row: WorkspaceMemberRecord) => {
      if (state.members.some((candidate) => candidate.orgId === row.orgId && candidate.userId === row.userId)) return false;
      state.members.push(row);
      return true;
    }),
    updateMembershipRole: vi.fn(async (orgId: string, userId: string, role: WorkspaceMemberRecord["role"]) => {
      const row = state.members.find((candidate) => candidate.orgId === orgId && candidate.userId === userId);
      if (!row) return false;
      row.role = role;
      return true;
    }),
    deleteMembership: vi.fn(async (orgId: string, userId: string) => {
      const index = state.members.findIndex((candidate) => candidate.orgId === orgId && candidate.userId === userId);
      if (index < 0) return false;
      state.members.splice(index, 1);
      return true;
    }),
    listMembers: vi.fn(async (orgId: string) => state.members.filter((row) => row.orgId === orgId)),
    listInvitations: vi.fn(async (orgId: string) => state.invitations.filter((row) => row.orgId === orgId)),
    insertAuditLog: vi.fn(async (row: Record<string, unknown>) => state.audits.push(row)),
  };

  const dependencies: MemberInvitationDependencies = {
    store: {
      transaction: vi.fn(async (callback) => callback(tx)),
      listMembers: tx.listMembers,
      listInvitations: tx.listInvitations,
    },
    sendInvitationEmail: vi.fn(async () => ({ messageId: "message-1", status: "sent" as const })),
    now: () => new Date(NOW),
    randomBytes: vi.fn(() => Buffer.alloc(32, 7)),
    randomUUID: vi.fn()
      .mockReturnValueOnce("inv-1")
      .mockReturnValueOnce("membership-1")
      .mockReturnValue("audit-1"),
  };

  return { dependencies, state, tx };
}

describe("invitation primitives", () => {
  test("normalizes email by trimming and lowercasing", () => {
    expect(normalizeInvitationEmail("  Julie.Hultberg94@GMAIL.COM  ")).toBe("julie.hultberg94@gmail.com");
  });

  test("hashes invitation tokens with deterministic SHA-256", () => {
    expect(hashInvitationToken("secret-token")).toBe(createHash("sha256").update("secret-token").digest("hex"));
  });

  test("uses a seven-day lifetime", () => {
    expect(INVITATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("workspace invitations", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  test("creates a 32-byte-token invitation and persists only its digest", async () => {
    const result = await createInvitation({
      orgId: "org-1", email: " Julie@Example.com ", role: "fundraiser", invitedByUserId: "owner-1",
      inviterName: "Malthe", workspaceName: "True Nature", acceptBaseUrl: "https://labels.example.com/invite",
    }, harness.dependencies);

    const expectedToken = Buffer.alloc(32, 7).toString("base64url");
    expect(harness.dependencies.randomBytes).toHaveBeenCalledWith(32);
    expect(Buffer.from(expectedToken, "base64url")).toHaveLength(32);
    expect(result.invitation).not.toHaveProperty("token");
    expect(harness.state.invitations[0]).toMatchObject({
      normalizedEmail: "julie@example.com",
      tokenDigest: hashInvitationToken(expectedToken),
      role: "fundraiser",
      status: "pending",
      expiresAt: new Date(NOW.getTime() + INVITATION_TTL_MS),
    });
    expect(JSON.stringify(harness.state.invitations[0])).not.toContain(expectedToken);
    expect(harness.dependencies.sendInvitationEmail).toHaveBeenCalledWith(expect.objectContaining({
      toEmail: "julie@example.com",
      acceptUrl: `https://labels.example.com/invite#${expectedToken}`,
    }));
    expect(harness.state.audits[0]).toMatchObject({ action: "invitation.created", actorUserId: "owner-1" });
  });

  test.each(["owner", "unknown"])("rejects disallowed invite role %s", async (role) => {
    await expect(createInvitation({
      orgId: "org-1", email: "julie@example.com", role: role as never, invitedByUserId: "owner-1",
      inviterName: "Malthe", workspaceName: "True Nature", acceptBaseUrl: "https://labels.example.com/invite",
    }, harness.dependencies)).rejects.toMatchObject({ status: 400 });
  });

  test("rejects an existing workspace member", async () => {
    harness.state.members.push(member());
    await expect(createInvitation({
      orgId: "org-1", email: "JULIE@example.com", role: "fundraiser", invitedByUserId: "owner-1",
      inviterName: "Malthe", workspaceName: "True Nature", acceptBaseUrl: "https://labels.example.com/invite",
    }, harness.dependencies)).rejects.toMatchObject({ status: 409 });
  });

  test("rejects a second pending invitation for the same normalized email", async () => {
    harness.state.invitations.push(invitation());
    await expect(createInvitation({
      orgId: "org-1", email: " JULIE@EXAMPLE.COM ", role: "fundraiser", invitedByUserId: "owner-1",
      inviterName: "Malthe", workspaceName: "True Nature", acceptBaseUrl: "https://labels.example.com/invite",
    }, harness.dependencies)).rejects.toMatchObject({ status: 409 });
  });

  test("translates a raced pending-invitation unique violation into a safe conflict", async () => {
    harness.tx.insertInvitation.mockRejectedValue(Object.assign(new Error("sensitive database detail"), {
      code: "23505",
      constraint: "org_invitations_pending_email_unique_idx",
    }));
    await expect(createInvitation({
      orgId: "org-1", email: "julie@example.com", role: "fundraiser", invitedByUserId: "owner-1",
      inviterName: "Malthe", workspaceName: "True Nature", acceptBaseUrl: "https://labels.example.com/invite",
    }, harness.dependencies)).rejects.toMatchObject({ status: 409, message: "A pending invitation already exists for this email" });
  });

  test("keeps a pending invitation revocable when delivery fails", async () => {
    vi.mocked(harness.dependencies.sendInvitationEmail).mockResolvedValue({ messageId: "", status: "failed", error: "private provider detail" });
    await expect(createInvitation({
      orgId: "org-1", email: "julie@example.com", role: "fundraiser", invitedByUserId: "owner-1",
      inviterName: "Malthe", workspaceName: "True Nature", acceptBaseUrl: "https://labels.example.com/invite",
    }, harness.dependencies)).rejects.toMatchObject({ status: 502, message: "Invitation was created, but the email could not be delivered" });
    expect(harness.state.invitations[0].status).toBe("pending");
  });

  test("resend rotates the digest and invalidates the old token", async () => {
    harness.state.invitations.push(invitation());
    const oldDigest = harness.state.invitations[0].tokenDigest;
    await resendInvitation({
      orgId: "org-1", invitationId: "inv-1", actorUserId: "owner-1", inviterName: "Malthe",
      workspaceName: "True Nature", acceptBaseUrl: "https://labels.example.com/invite",
    }, harness.dependencies);
    expect(harness.state.invitations[0].tokenDigest).not.toBe(oldDigest);
    expect(harness.state.audits[0]).toMatchObject({ action: "invitation.resent" });
    await expect(acceptInvitation({ token: "old-token", userId: "user-1", userEmail: "julie@example.com" }, harness.dependencies))
      .rejects.toThrow("Invitation is invalid or expired");
  });

  test("allows exactly one concurrent resend to rotate and send", async () => {
    harness.state.invitations.push(invitation());
    vi.mocked(harness.dependencies.randomBytes)
      .mockReturnValueOnce(Buffer.alloc(32, 8))
      .mockReturnValueOnce(Buffer.alloc(32, 9));

    let readCount = 0;
    let releaseBoth!: () => void;
    const bothRead = new Promise<void>((resolve) => { releaseBoth = resolve; });
    harness.tx.findInvitationById.mockImplementation(async (orgId: string, id: string) => {
      const row = harness.state.invitations.find((candidate) => candidate.orgId === orgId && candidate.id === id);
      const snapshot = row ? { ...row } : null;
      readCount += 1;
      if (readCount === 2) releaseBoth();
      await bothRead;
      return snapshot;
    });

    const input = {
      orgId: "org-1", invitationId: "inv-1", actorUserId: "owner-1", inviterName: "Malthe",
      workspaceName: "True Nature", acceptBaseUrl: "https://labels.example.com/invite",
    };
    const results = await Promise.allSettled([
      resendInvitation(input, harness.dependencies),
      resendInvitation(input, harness.dependencies),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(harness.dependencies.sendInvitationEmail).toHaveBeenCalledTimes(1);
  });

  test("revokes a pending invitation and audits it", async () => {
    harness.state.invitations.push(invitation());
    await revokeInvitation({ orgId: "org-1", invitationId: "inv-1", actorUserId: "owner-1" }, harness.dependencies);
    expect(harness.state.invitations[0]).toMatchObject({ status: "revoked", revokedAt: NOW });
    expect(harness.state.audits[0]).toMatchObject({ action: "invitation.revoked" });
  });
});

describe("invitation acceptance", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
    harness.state.invitations.push(invitation());
  });

  test("locks the invitation and creates the exact fundraiser membership atomically", async () => {
    const result = await acceptInvitation({ token: "old-token", userId: "user-1", userEmail: " JULIE@example.com " }, harness.dependencies);
    expect(harness.state.lockCount).toBe(1);
    expect(harness.state.bootstrapDigests).toEqual([hashInvitationToken("old-token")]);
    expect(harness.state.adoptedContexts).toEqual([{ orgId: "org-1", userId: "user-1" }]);
    expect(harness.tx.adoptInvitationBootstrap).toHaveBeenCalledBefore(harness.tx.findInvitationByDigest);
    expect(harness.tx.findInvitationByDigest).toHaveBeenCalledBefore(harness.tx.adoptInvitationContext);
    expect(harness.tx.adoptInvitationContext).toHaveBeenCalledBefore(harness.tx.findInvitationByDigestForUpdate);
    expect(result).toMatchObject({ orgId: "org-1", role: "fundraiser", alreadyAccepted: false });
    expect(harness.state.members[0]).toMatchObject({ orgId: "org-1", userId: "user-1", role: "fundraiser" });
    expect(harness.state.invitations[0]).toMatchObject({ status: "accepted", acceptedByUserId: "user-1", acceptedAt: NOW });
    expect(harness.state.invitations[0].tokenDigest).toBe(hashInvitationToken("old-token"));
    expect(harness.state.audits[0]).toMatchObject({ action: "invitation.accepted", actorUserId: "user-1" });
    expect(harness.dependencies.store.transaction).toHaveBeenCalledTimes(1);
  });

  test("denies a signed-in user with the wrong email", async () => {
    await expect(acceptInvitation({ token: "old-token", userId: "user-2", userEmail: "other@example.com" }, harness.dependencies))
      .rejects.toThrow("Invitation is invalid or expired");
    expect(harness.state.members).toHaveLength(0);
  });

  test("denies an expired invitation neutrally", async () => {
    harness.state.invitations[0].expiresAt = new Date(NOW.getTime() - 1);
    await expect(acceptInvitation({ token: "old-token", userId: "user-1", userEmail: "julie@example.com" }, harness.dependencies))
      .rejects.toThrow("Invitation is invalid or expired");
  });

  test("returns the existing membership only for the same accepted user", async () => {
    await acceptInvitation({ token: "old-token", userId: "user-1", userEmail: "julie@example.com" }, harness.dependencies);
    harness.state.members[0].name = "Julie";
    harness.state.members[0].role = "operator";
    harness.state.invitations[0].normalizedEmail = "previous-address@example.com";
    harness.state.invitations[0].expiresAt = new Date(NOW.getTime() - 1);
    await expect(acceptInvitation({ token: "old-token", userId: "user-1", userEmail: "julie@example.com" }, harness.dependencies))
      .resolves.toMatchObject({ orgId: "org-1", role: "operator", alreadyAccepted: true });
    await expect(acceptInvitation({ token: "old-token", userId: "user-2", userEmail: "julie@example.com" }, harness.dependencies))
      .rejects.toThrow("Invitation is invalid or expired");
    expect(harness.state.members).toHaveLength(1);
    expect(harness.state.audits).toHaveLength(1);
  });

  test("returns invited email context only for a live continuation token", async () => {
    const { getInvitationContext } = await import("./member-invitations");
    await expect(getInvitationContext("old-token", harness.dependencies)).resolves.toEqual({ email: "julie@example.com" });
    expect(harness.tx.findInvitationByDigest).toHaveBeenCalledWith(hashInvitationToken("old-token"));
    expect(harness.tx.findInvitationByDigestForUpdate).not.toHaveBeenCalled();
    expect(harness.state.bootstrapDigests).toEqual([hashInvitationToken("old-token")]);
    expect(harness.state.adoptedContexts).toEqual([]);
    harness.state.invitations[0].expiresAt = new Date(NOW.getTime() - 1);
    await expect(getInvitationContext("old-token", harness.dependencies)).rejects.toThrow("Invitation is invalid or expired");
  });

  test("denies a raced acceptance when membership insertion loses", async () => {
    harness.tx.insertMembership.mockResolvedValue(false);
    await expect(acceptInvitation({ token: "old-token", userId: "user-1", userEmail: "julie@example.com" }, harness.dependencies))
      .rejects.toThrow("Invitation is invalid or expired");
    expect(harness.tx.updateInvitation).not.toHaveBeenCalled();
  });

  test("rejects when the locked invitation no longer matches the bootstrap row", async () => {
    harness.tx.findInvitationByDigestForUpdate.mockResolvedValue(invitation({ id: "inv-2", orgId: "org-2" }));
    await expect(acceptInvitation({ token: "old-token", userId: "user-1", userEmail: "julie@example.com" }, harness.dependencies))
      .rejects.toThrow("Invitation is invalid or expired");
    expect(harness.state.members).toHaveLength(0);
    expect(harness.tx.insertMembership).not.toHaveBeenCalled();
  });
});

describe("member administration", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  test("changes a member role and writes the old and new role audit data", async () => {
    harness.state.members.push(member());
    await changeMemberRole({ orgId: "org-1", userId: "user-1", role: "operator", actorUserId: "owner-1" }, harness.dependencies);
    expect(harness.state.members[0].role).toBe("operator");
    expect(harness.state.audits[0]).toMatchObject({
      action: "member.role_changed", beforeData: { role: "fundraiser" }, afterData: { role: "operator" },
    });
  });

  test.each(["change", "remove"])("protects the last owner from %s", async (operation) => {
    harness.state.members.push(member({ userId: "owner-1", role: "owner" }));
    const result = operation === "change"
      ? changeMemberRole({ orgId: "org-1", userId: "owner-1", role: "member", actorUserId: "owner-1" }, harness.dependencies)
      : removeMember({ orgId: "org-1", userId: "owner-1", actorUserId: "owner-1" }, harness.dependencies);
    await expect(result).rejects.toMatchObject({ status: 409 });
  });

  test("removes a member and audits the action", async () => {
    harness.state.members.push(member());
    await removeMember({ orgId: "org-1", userId: "user-1", actorUserId: "owner-1" }, harness.dependencies);
    expect(harness.state.members).toHaveLength(0);
    expect(harness.state.audits[0]).toMatchObject({ action: "member.removed", actorUserId: "owner-1" });
  });
});
