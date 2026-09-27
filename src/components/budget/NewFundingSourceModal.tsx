"use client";

import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
interface NewFundingSourceModalProps {
  projectId: string;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
  onTrackAsApplication?: () => void;
}

const TYPES = ["advance", "grant", "partner", "patron", "direct_to_fan", "self"];
const STATUSES = ["research", "pending", "confirmed", "rejected"];

export default function NewFundingSourceModal({ projectId, onClose, onCreated, onTrackAsApplication }: NewFundingSourceModalProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState("grant");
  const [status, setStatus] = useState("pending");
  const [amountPlanned, setAmountPlanned] = useState<number>(0);
  const [amountConfirmed, setAmountConfirmed] = useState<number>(0);
  const [restrictedTo, setRestrictedTo] = useState("");
  const [funder, setFunder] = useState("");
  const [deadline, setDeadline] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function submit() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/funding-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          name: name.trim(),
          type,
          status,
          amount_planned: amountPlanned,
          amount_confirmed: amountConfirmed,
          restricted_to: restrictedTo || null,
          funder: funder || null,
          deadline: deadline || null,
          notes: notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create funding source");
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Add funding source</h3>
          <Button variant="ghost" onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl">×</Button>
        </div>

        {type === "grant" && onTrackAsApplication && <Button variant="outline" type="button" onClick={onTrackAsApplication} className="mb-4 w-full border border-dashed border-border px-3 py-2 text-left text-sm hover:bg-muted"><span className="font-medium">Track as application instead</span><span className="mt-1 block text-xs text-muted-foreground">Use the Grants application drawer for stage, owner, deadline, award, and reporting lifecycle.</span></Button>}

        <div className="space-y-3">
          <Field label="Name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
              placeholder="e.g. KODA Kultur Udgivelsespuljen"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <NativeSelect
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
              >
                {TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Status">
              <NativeSelect
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount planned">
              <Input
                type="number"
                value={amountPlanned}
                onChange={(e) => setAmountPlanned(Number(e.target.value))}
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
              />
            </Field>
            <Field label="Amount confirmed">
              <Input
                type="number"
                value={amountConfirmed}
                onChange={(e) => setAmountConfirmed(Number(e.target.value))}
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Funder">
              <Input
                value={funder}
                onChange={(e) => setFunder(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
                placeholder="KODA, MXD, STEM…"
              />
            </Field>
            <Field label="Restricted to">
              <Input
                value={restrictedTo}
                onChange={(e) => setRestrictedTo(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
                placeholder="production, marketing, export…"
              />
            </Field>
          </div>
          <Field label="Deadline (optional)">
            <Input
              type="text"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
              placeholder="monthly 15th, 2026-12-31…"
            />
          </Field>
          <Field label="Notes">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
            />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline"
            onClick={onClose}
            className="px-4 py-2 text-sm border border-border rounded-md hover:bg-muted"
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={submitting}
            className="px-4 py-2 text-sm bg-foreground text-background rounded-md font-medium disabled:opacity-50"
          >
            {submitting ? "Adding…" : "Add funding source"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
