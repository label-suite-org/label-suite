"use client";

import { useRef, useState, type FormEvent } from "react";
import type { MembershipRole } from "../../server/tenant";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { SectionIntro, SettingsStatus } from "./SettingsControls";
import type { SettingsInvitation, SettingsMember, SettingsUser } from "./settings-types";

import { NativeSelect } from "@/components/ui/native-select";
const assignableRoles = ["operator", "fundraiser", "member", "payee"] as const;

type AccessMutationLock = { current: boolean };
type AccessMutationOutcome =
  | { kind: "busy" }
  | { kind: "success"; refreshError?: string }
  | { kind: "mutation-error"; error: string; refreshError?: string };

export async function runSerializedAccessMutation({
  lock,
  action,
  refresh,
}: {
  lock: AccessMutationLock;
  action: () => Promise<Response>;
  refresh: () => Promise<void>;
}): Promise<AccessMutationOutcome> {
  if (lock.current) return { kind: "busy" };
  lock.current = true;

  async function reconcile(): Promise<string | undefined> {
    try {
      await refresh();
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : "Failed to refresh workspace access";
    }
  }

  try {
    let response: Response;
    try {
      response = await action();
    } catch (error) {
      return {
        kind: "mutation-error",
        error: error instanceof Error ? error.message : "Member update failed",
        refreshError: await reconcile(),
      };
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        kind: "mutation-error",
        error: payload.error ?? "Member update failed",
        refreshError: await reconcile(),
      };
    }

    return { kind: "success", refreshError: await reconcile() };
  } finally {
    lock.current = false;
  }
}

export function MemberSettings({
  user,
  role,
  initialMembers,
  initialInvitations,
}: {
  user: SettingsUser;
  role: MembershipRole;
  initialMembers: SettingsMember[];
  initialInvitations: SettingsInvitation[];
}) {
  const canManage = role === "owner";
  const [members, setMembers] = useState(initialMembers);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"" | typeof assignableRoles[number]>("");
  const [pendingRoles, setPendingRoles] = useState<Record<string, typeof assignableRoles[number]>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusWarning, setStatusWarning] = useState<string | null>(null);
  const mutationInFlight = useRef(false);
  const isMutating = busyKey !== null;

  async function refreshMembers() {
    const [membersResponse, invitationsResponse] = await Promise.all([
      fetch("/api/members"),
      fetch("/api/invitations"),
    ]);
    if (!membersResponse.ok || !invitationsResponse.ok) throw new Error("Failed to refresh workspace access");
    const [nextMembers, nextInvitations] = await Promise.all([membersResponse.json(), invitationsResponse.json()]);
    setMembers(nextMembers);
    setInvitations(nextInvitations);
  }

  async function mutate(key: string, action: () => Promise<Response>, success: string) {
    if (mutationInFlight.current) return false;
    setBusyKey(key);
    setStatusError(null);
    setStatusMessage(null);
    setStatusWarning(null);
    try {
      const outcome = await runSerializedAccessMutation({ lock: mutationInFlight, action, refresh: refreshMembers });
      if (outcome.kind === "busy") return false;
      if (outcome.kind === "mutation-error") {
        setStatusError(outcome.error);
        setStatusWarning(outcome.refreshError ? `The latest access list could not be loaded: ${outcome.refreshError}` : null);
        return false;
      }
      setStatusMessage(success);
      setStatusWarning(outcome.refreshError ? `Update saved, but the latest access list could not be loaded: ${outcome.refreshError}` : null);
      return true;
    } finally {
      setBusyKey(null);
    }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !inviteRole) return;
    const invited = await mutate("invite", () => fetch("/api/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), role: inviteRole }),
    }), `Invitation sent to ${email.trim()}.`);
    if (invited) {
      setEmail("");
      setInviteRole("");
    }
  }

  async function applyRole(member: SettingsMember) {
    const nextRole = pendingRoles[member.userId];
    if (!nextRole || nextRole === member.role) return;
    if (!window.confirm(`Change ${member.name || member.email}'s role from ${member.role} to ${nextRole}?`)) return;
    const changed = await mutate(`member:${member.userId}`, () => fetch(`/api/members/${encodeURIComponent(member.userId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: nextRole }),
    }), `${member.name || member.email} is now ${nextRole}.`);
    if (changed) {
      setPendingRoles((current) => {
        const next = { ...current };
        delete next[member.userId];
        return next;
      });
    }
  }

  async function removeMember(member: SettingsMember) {
    if (!window.confirm(`Remove ${member.name || member.email} from this workspace?`)) return;
    await mutate(`member:${member.userId}`, () => fetch(`/api/members/${encodeURIComponent(member.userId)}`, {
      method: "DELETE",
    }), `${member.name || member.email} was removed.`);
  }

  async function updateInvitation(invitation: SettingsInvitation, action: "resend" | "revoke") {
    if (action === "revoke" && !window.confirm(`Revoke the invitation to ${invitation.email}?`)) return;
    await mutate(`invite:${invitation.id}`, () => fetch(`/api/invitations/${encodeURIComponent(invitation.id)}/${action}`, {
      method: "POST",
    }), action === "resend" ? `Invitation resent to ${invitation.email}.` : `Invitation to ${invitation.email} was revoked.`);
  }

  const pendingInvitations = invitations.filter((invitation) => invitation.status === "pending");

  return (
    <div className="space-y-4">
      <SectionIntro title="Members" description="Access overview for the active workspace." />
      <SettingsStatus statusError={statusError} statusMessage={statusMessage} statusWarning={statusWarning} />
      <Card>
        <CardHeader>
          <CardTitle>Current members</CardTitle>
          <CardDescription>{canManage ? "Owners can update roles and remove workspace access." : "Read-only for your role."}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {members.map((member) => {
            const label = member.name?.trim() || member.email;
            const pendingRole = pendingRoles[member.userId] ?? member.role;
            const roleChanged = pendingRole !== member.role;
            return (
              <div key={member.membershipId} className="flex flex-col gap-3 rounded-lg border border-border px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{label}{member.userId === user.id ? " (you)" : ""}</p>
                  <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {canManage && member.role !== "owner" ? (
                    <NativeSelect
                      aria-label={`Role for ${label}`}
                      value={pendingRole}
                      disabled={isMutating}
                      onChange={(event) => setPendingRoles((current) => ({ ...current, [member.userId]: event.target.value as typeof assignableRoles[number] }))}
                      className="h-9 rounded-lg border border-border bg-background px-3 text-sm capitalize outline-none focus:ring-2 focus:ring-ring/30"
                    >
                      {assignableRoles.map((assignableRole) => <option key={assignableRole} value={assignableRole}>{assignableRole}</option>)}
                    </NativeSelect>
                  ) : <Badge variant="outline" className="capitalize">{member.role}</Badge>}
                  {canManage && member.role !== "owner" && (
                    <>
                      <Button type="button" variant="outline" disabled={isMutating || !roleChanged} onClick={() => void applyRole(member)} aria-label={`Apply role for ${label}`}>Apply</Button>
                      <Button type="button" variant="ghost" disabled={isMutating} onClick={() => void removeMember(member)} aria-label={`Remove ${label}`}>Remove</Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {!members.length && <p className="text-sm text-muted-foreground">No members found.</p>}
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Invite member</CardTitle>
            <CardDescription>Send one workspace invitation with the access level they need.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={invite} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
              <Input name="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teammate@example.com" aria-label="Invite email" disabled={isMutating} />
              <NativeSelect name="role" required value={inviteRole} onChange={(event) => setInviteRole(event.target.value as typeof inviteRole)} disabled={isMutating} aria-label="Invitation role" className="h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30">
                <option value="">Select role</option>
                {assignableRoles.map((assignableRole) => <option key={assignableRole} value={assignableRole}>{assignableRole}</option>)}
              </NativeSelect>
              <Button type="submit" disabled={isMutating || !email.trim() || !inviteRole}>Invite member</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Pending invitations</CardTitle>
          <CardDescription>{canManage ? "Resend or revoke invitations that have not been accepted." : "Invitations awaiting acceptance."}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {pendingInvitations.map((invitation) => {
            const expired = new Date(invitation.expiresAt).getTime() <= Date.now();
            return (
              <div key={invitation.id} className="flex flex-col gap-3 rounded-lg border border-border px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">{invitation.email}</p>
                    <Badge variant={expired ? "outline" : "secondary"}>{expired ? "Expired" : "Pending"}</Badge>
                    <Badge variant="outline" className="capitalize">{invitation.role}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Expires {formatAccessDate(invitation.expiresAt)}</p>
                </div>
                {canManage && (
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" disabled={isMutating} onClick={() => void updateInvitation(invitation, "resend")} aria-label={`Resend invitation to ${invitation.email}`}>Resend</Button>
                    <Button type="button" variant="ghost" disabled={isMutating} onClick={() => void updateInvitation(invitation, "revoke")} aria-label={`Revoke invitation to ${invitation.email}`}>Revoke</Button>
                  </div>
                )}
              </div>
            );
          })}
          {!pendingInvitations.length && <p className="text-sm text-muted-foreground">No pending invitations.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function formatAccessDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}
