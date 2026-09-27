import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import BudgetDepartment from "../budget/BudgetDepartment";
import { ContactsBook } from "../contacts/ContactsBook";
import GrantsFundingCockpit from "../grants/GrantsFundingCockpit";
import { MemberSettings, SettingsStatus, runSerializedAccessMutation, type SettingsInvitation, type SettingsMember } from "./SettingsShell";

const user = { id: "owner-1", name: "Owner Person", email: "owner@example.com" };
const members: SettingsMember[] = [
  { membershipId: "membership-1", orgId: "org-1", userId: "owner-1", name: "Owner Person", email: "owner@example.com", role: "owner", joinedAt: "2026-01-01T00:00:00.000Z" },
  { membershipId: "membership-2", orgId: "org-1", userId: "fundraiser-1", name: "Fundraiser Person", email: "fundraiser@example.com", role: "fundraiser", joinedAt: "2026-07-01T00:00:00.000Z" },
];
const invitations: SettingsInvitation[] = [
  { id: "invite-1", orgId: "org-1", email: "pending@example.com", normalizedEmail: "pending@example.com", role: "fundraiser", status: "pending", invitedByUserId: "owner-1", acceptedByUserId: null, expiresAt: "2026-07-20T00:00:00.000Z", acceptedAt: null, revokedAt: null, lastSentAt: "2026-07-13T00:00:00.000Z", createdAt: "2026-07-13T00:00:00.000Z" },
];

describe("MemberSettings", () => {
  it("keeps a saved mutation message separate from a refresh warning", () => {
    const html = renderToStaticMarkup(<SettingsStatus statusMessage="Role updated." statusError={null} statusWarning="Latest list could not be loaded." />);

    expect(html).toContain("Role updated.");
    expect(html).toContain("Latest list could not be loaded.");
  });

  it("reconciles after a network error and preserves a separate refresh warning", async () => {
    const refresh = vi.fn().mockRejectedValue(new Error("Refresh connection lost"));
    const outcome = await runSerializedAccessMutation({
      lock: { current: false },
      action: vi.fn().mockRejectedValue(new Error("Mutation response lost")),
      refresh,
    });

    expect(refresh).toHaveBeenCalledOnce();
    expect(outcome).toEqual({
      kind: "mutation-error",
      error: "Mutation response lost",
      refreshError: "Refresh connection lost",
    });
  });

  it("serializes access mutations with a synchronous lock", async () => {
    let finishFirst!: (response: Response) => void;
    const lock = { current: false };
    const first = runSerializedAccessMutation({
      lock,
      action: () => new Promise<Response>((resolve) => { finishFirst = resolve; }),
      refresh: vi.fn().mockResolvedValue(undefined),
    });
    const secondAction = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const second = await runSerializedAccessMutation({ lock, action: secondAction, refresh: vi.fn() });

    expect(second).toEqual({ kind: "busy" });
    expect(secondAction).not.toHaveBeenCalled();
    finishFirst(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    await first;
  });

  it("gives an owner one invite form without defaulting the role", () => {
    const html = renderToStaticMarkup(<MemberSettings user={user} role="owner" initialMembers={members} initialInvitations={invitations} />);

    expect(html).toContain("Invite member");
    expect(html).toContain("name=\"email\"");
    expect(html).toContain("name=\"role\"");
    expect(html).toContain("Select role");
    expect(html).not.toContain("option selected=\"\" value=\"fundraiser\"");
    expect(html).not.toContain("Julie");
  });

  it("shows manageable current members without an owner role option", () => {
    const html = renderToStaticMarkup(<MemberSettings user={user} role="owner" initialMembers={members} initialInvitations={invitations} />);

    expect(html).toContain("Fundraiser Person");
    expect(html).toContain("aria-label=\"Role for Fundraiser Person\"");
    expect(html).toContain("value=\"operator\"");
    expect(html).toContain("value=\"fundraiser\"");
    expect(html).not.toContain("value=\"owner\"");
    expect(html).toContain("Apply role for Fundraiser Person");
    expect(html).toContain("Remove Fundraiser Person");
  });

  it("shows pending invitation status, expiry, resend, and revoke controls", () => {
    const html = renderToStaticMarkup(<MemberSettings user={user} role="owner" initialMembers={members} initialInvitations={invitations} />);

    expect(html).toContain("Pending invitations");
    expect(html).toContain("pending@example.com");
    expect(html).toContain("Pending");
    expect(html).toContain("Expires");
    expect(html).toContain("Resend invitation to pending@example.com");
    expect(html).toContain("Revoke invitation to pending@example.com");
  });

  it("renders a read-only list for non-owners", () => {
    const html = renderToStaticMarkup(<MemberSettings user={{ ...user, id: "fundraiser-1" }} role="fundraiser" initialMembers={members} initialInvitations={invitations} />);

    expect(html).toContain("Read-only for your role");
    expect(html).toContain("Owner Person");
    expect(html).toContain("Fundraiser Person");
    expect(html).not.toContain("Invite member");
    expect(html).not.toContain("Remove Fundraiser Person");
    expect(html).not.toContain("Resend invitation");
  });
});

describe("fundraiser mutation affordances", () => {
  it("keeps grants, budget, and contacts editing available", () => {
    const emptyWorkspace = { projects: [], applications: [], opportunities: [], assets: [], calendarEvents: [] };
    const grants = renderToStaticMarkup(<GrantsFundingCockpit workspace={emptyWorkspace} canMutate />);
    const budget = renderToStaticMarkup(<BudgetDepartment projects={[]} hasLegacyItems={false} artistOptions={[]} releaseOptions={[]} canMutate />);
    const contacts = renderToStaticMarkup(<ContactsBook contacts={[]} organizations={[]} canMutate canEnrichContacts={false} />);

    expect(grants).not.toContain("Read-only for your role");
    expect(budget).toContain("New project");
    expect(contacts).toContain("New Contact");
    expect(contacts).toContain("Gmail enrichment requires operator access.");
  });

  it("suppresses mutation controls when a domain is denied", () => {
    const budget = renderToStaticMarkup(<BudgetDepartment projects={[]} hasLegacyItems={false} artistOptions={[]} releaseOptions={[]} canMutate={false} />);
    const contacts = renderToStaticMarkup(<ContactsBook contacts={[]} organizations={[]} canMutate={false} />);

    expect(budget).toContain("Read-only for your role");
    expect(budget).not.toContain("New project");
    expect(contacts).toContain("Read-only for your role");
    expect(contacts).not.toContain("New Contact");
  });

  it("keeps fundraiser contact editing but hides operator-only Gmail enrichment", () => {
    const contact = {
      id: "contact-1", name: "Fundraiser Contact", email: "contact@example.com", phone: null,
      image_url: null, website: null, linkedin_url: null, address: null, role: null, company: null,
      notes: null, organization_links: [],
    };
    const fundraiser = renderToStaticMarkup(<ContactsBook contacts={[contact]} organizations={[]} canMutate canEnrichContacts={false} />);
    const operator = renderToStaticMarkup(<ContactsBook contacts={[contact]} organizations={[]} canMutate canEnrichContacts />);

    expect(fundraiser).toContain("New Contact");
    expect(fundraiser).not.toContain("Connect Gmail");
    expect(fundraiser).not.toContain("Scan Gmail");
    expect(fundraiser).toContain("Gmail enrichment requires operator access.");
    expect(operator).toContain("Connect Gmail");
    expect(operator).not.toContain("Gmail enrichment requires operator access.");
  });

  it("shows enrichment provenance alongside the reviewable suggestion", () => {
    const contact = {
      id: "contact-1", name: "Enrichment Contact", email: null, phone: null,
      image_url: null, website: null, linkedin_url: null, address: null, role: null, company: null,
      notes: null, organization_links: [],
    };
    const html = renderToStaticMarkup(
      <ContactsBook
        contacts={[contact]}
        organizations={[]}
        canMutate
        canEnrichContacts
        gmailConnected
        gmailConnection={{ email: "operator@example.com", status: "connected", last_scan_at: "2026-08-16T10:00:00.000Z" }}
        enrichmentSuggestions={[{
          id: "suggestion-1",
          contact_id: "contact-1",
          field: "phone",
          value: "+45 12 34 56 78",
          normalized_value: "4512345678",
          confidence: 0.74,
          evidence: { from: "sender@example.com", subject: "Signature", date: "Sat, 16 Aug 2026 10:00:00 +0200" },
          source_type: "gmail",
          source_email: "operator@example.com",
          status: "pending",
          created_at: "2026-08-16T10:05:00.000Z",
        }]}
      />,
    );

    expect(html).toContain("Source: Gmail · operator@example.com");
    expect(html).toContain("Provenance: gmail · operator@example.com");
    expect(html).toContain("observed");
  });
});
