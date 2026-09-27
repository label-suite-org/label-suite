"use client";

import { useState, type SubmitEvent } from "react";
import { contactReason, getContactOptionsForScope, type RightsContactOption } from "./contactEligibility";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
export interface RoleData {
  id?: string;
  contact_id?: string | null;
  role?: string | null;
  ownership_type?: string | null;
  scope?: string | null;
  percent_share?: number | null;
  clearance_status?: string | null;
}

const SCOPES = ["Publishing", "Master", "Mechanical"];
const CLEARANCE = ["Signed", "Confirmed", "Pending", "Unknown"];
const OWNERSHIP = ["Rights", "Credit"];

const inputCls =
  "w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900";

export function RoleForm({
  workId,
  contacts,
  role,
  filterRightsContacts = false,
  onClose,
}: {
  workId: string;
  contacts: RightsContactOption[];
  role?: RoleData;
  filterRightsContacts?: boolean;
  onClose: () => void;
}) {
  const editing = !!role?.id;
  const [contactId, setContactId] = useState(role?.contact_id ?? "");
  const [roleName, setRoleName] = useState(role?.role ?? "");
  const [ownership, setOwnership] = useState(role?.ownership_type ?? "Rights");
  const [scope, setScope] = useState(role?.scope ?? "Publishing");
  const [share, setShare] = useState(role?.percent_share == null ? "" : String(role.percent_share));
  const [clearance, setClearance] = useState(role?.clearance_status ?? "Unknown");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const shouldFilterContacts = filterRightsContacts && ownership !== "Credit";
  const contactOptions = shouldFilterContacts
    ? getContactOptionsForScope(contacts, scope, contactId)
    : { eligible: contacts, currentOnly: null };

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        work_id: workId,
        contact_id: contactId || null,
        role: roleName,
        ownership_type: ownership,
        scope,
        percent_share: share === "" ? null : Number(share),
        clearance_status: clearance,
      };
      if (editing) payload.id = role!.id;

      const res = await fetch("/api/roles", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save role");
      }
      window.location.reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-neutral-700 mb-1">Role / Credit *</label>
        <Input
          value={roleName}
          onChange={(e) => setRoleName(e.target.value)}
          required
          placeholder="Producer, Songwriter, Vocalist…"
          className={inputCls}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-700 mb-1">Contact</label>
        <NativeSelect value={contactId} onChange={(e) => setContactId(e.target.value)} className={inputCls}>
          <option value="">— Unassigned —</option>
          {contactOptions.currentOnly ? (
            <optgroup label="Current selection">
              <option value={contactOptions.currentOnly.id}>{contactOptions.currentOnly.name} (review eligibility)</option>
            </optgroup>
          ) : null}
          <optgroup label={shouldFilterContacts ? "Rights candidates" : "Contacts"}>
            {contactOptions.eligible.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{contactReason(c, scope) ? ` - ${contactReason(c, scope)}` : ""}
              </option>
            ))}
          </optgroup>
        </NativeSelect>
        {shouldFilterContacts ? (
          <p className="mt-1 text-xs text-neutral-400">
            {scope === "Master"
              ? "Filtered to artists, producers, labels, master owners, and contacts already used on master rights."
              : "Filtered to writers, composers, publishers, PRO/IPI artists, producers, and contacts already used on publishing rights."}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Scope</label>
          <NativeSelect value={scope} onChange={(e) => setScope(e.target.value)} className={inputCls}>
            {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
          </NativeSelect>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Ownership</label>
          <NativeSelect value={ownership} onChange={(e) => setOwnership(e.target.value)} className={inputCls}>
            {OWNERSHIP.map((o) => <option key={o} value={o}>{o}</option>)}
          </NativeSelect>
          <p className="text-xs text-neutral-400 mt-1">
            Credit lines are not counted in clearance calculations.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Share %</label>
          <Input
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={share}
            onChange={(e) => setShare(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Clearance</label>
          <NativeSelect value={clearance} onChange={(e) => setClearance(e.target.value)} className={inputCls}>
            {CLEARANCE.map((c) => <option key={c} value={c}>{c}</option>)}
          </NativeSelect>
        </div>
      </div>

      <p className="text-xs text-neutral-400">
        Clearance weights: Signed 100%, Confirmed 75%, Pending 25%, Unknown 0%.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" type="button" onClick={onClose} className="px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900">Cancel</Button>
        <Button variant="ghost"
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded-lg hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? "Saving…" : editing ? "Save changes" : "Add role"}
        </Button>
      </div>
    </form>
  );
}
