import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proposalRows: [] as Array<Record<string, unknown>>,
  recordAuditEvent: vi.fn(),
  transaction: vi.fn(),
  update: vi.fn(),
}));

vi.mock("../lib/db", () => ({
  db: {
    transaction: mocks.transaction,
  },
}));
vi.mock("./integrations", () => ({ recordAuditEvent: mocks.recordAuditEvent }));

import {
  canonicalProposalAcceptanceReady,
  citedEnrichmentEvidenceSchema,
  decideCanonicalEnrichmentProposal,
  proposalAuditEventType,
} from "./contact-authority";

describe("canonical contact authority contracts", () => {
  it("only accepts a Gmail citation that identifies the source message", () => {
    expect(citedEnrichmentEvidenceSchema.safeParse(null).success).toBe(false);
    expect(citedEnrichmentEvidenceSchema.safeParse({ message_id: "" }).success).toBe(false);
    expect(citedEnrichmentEvidenceSchema.parse({
      message_id: "gmail-message-1",
      thread_id: "thread-1",
      from: "sender@example.test",
      subject: "Introductions",
      date: "Wed, 17 Sep 2026 10:00:00 +0000",
    })).toMatchObject({ message_id: "gmail-message-1" });
  });

  it("projects eligibility with exactly the canonical source and strict evidence rules", () => {
    const valid = { status: "pending", source_type: "gmail", field: "email", evidence: { message_id: "fixture" } };
    expect(canonicalProposalAcceptanceReady(valid)).toBe(true);
    expect(canonicalProposalAcceptanceReady({ ...valid, source_type: "GMAIL" })).toBe(false);
    expect(canonicalProposalAcceptanceReady({ ...valid, evidence: { message_id: "fixture", extra: true } })).toBe(false);
  });
  it("uses stable proposal audit event names", () => {
    expect(proposalAuditEventType("ignore")).toBe("contact.proposal_ignored");
    expect(proposalAuditEventType("accept")).toBe("contact.proposal_accepted");
  });

  it("claims a pending proposal but rolls back before audit when its acceptance lacks a citation", async () => {
    const tx = {
      update: mocks.update.mockImplementation(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: vi.fn(async () => mocks.proposalRows.splice(0, 1)) })),
        })),
      })),
    };
    mocks.transaction.mockImplementation(async (work: (transaction: typeof tx) => unknown) => work(tx));
    mocks.proposalRows.push({
      id: "proposal-1", contact_id: "contact-1", field: "email", value: "new@example.test",
      status: "applied", evidence: null, source_type: "gmail",
    });

    await expect(decideCanonicalEnrichmentProposal(
      { orgId: "org-1", actorUserId: "user-1" },
      "contact-1",
      { id: "proposal-1", action: "accept", expectedRevision: "2026-09-17T10:00:00.123456Z" },
    )).rejects.toThrow("requires cited Gmail message evidence");
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });
});
