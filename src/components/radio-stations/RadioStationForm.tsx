"use client";

import { useState, type FormEvent } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
export interface RadioStation {
  id: string;
  name: string;
  call_sign?: string | null;
  frequency?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  dj_name?: string | null;
  tier?: string | null;
  notes?: string | null;
}

const TIER_OPTIONS = [
  { value: "A", label: "A — Top Priority" },
  { value: "B", label: "B — High" },
  { value: "C", label: "C — Medium" },
  { value: "D", label: "D — Low" },
  { value: "NACC 1", label: "NACC 1" },
  { value: "NACC 1.5", label: "NACC 1.5" },
  { value: "NACC 2", label: "NACC 2" },
  { value: "NACC 3", label: "NACC 3" },
  { value: "NACC 4", label: "NACC 4" },
  { value: "JBE, Mediabase", label: "JBE, Mediabase" },
  { value: "SubModern", label: "SubModern" },
  { value: "Spinning", label: "Spinning" },
];

export function RadioStationForm({
  initial,
  onClose,
}: {
  initial?: RadioStation | null;
  onClose: () => void;
}) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name || "");
  const [callSign, setCallSign] = useState(initial?.call_sign || "");
  const [frequency, setFrequency] = useState(initial?.frequency || "");
  const [city, setCity] = useState(initial?.city || "");
  const [state, setState] = useState(initial?.state || "");
  const [country, setCountry] = useState(initial?.country || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [website, setWebsite] = useState(initial?.website || "");
  const [djName, setDjName] = useState(initial?.dj_name || "");
  const [tier, setTier] = useState(initial?.tier || "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        name,
        call_sign: callSign || null,
        frequency: frequency || null,
        city: city || null,
        state: state || null,
        country: country || null,
        email: email || null,
        phone: phone || null,
        website: website || null,
        dj_name: djName || null,
        tier: tier || null,
        notes: notes || null,
      };
      const res = await fetch("/api/radio-stations", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? { ...body, id: initial!.id } : body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to ${isEdit ? "update" : "create"} radio station`);
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
        <label className="block text-sm font-medium text-foreground mb-1">Station Name *</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required
          className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Call Sign</label>
          <Input value={callSign} onChange={(e) => setCallSign(e.target.value)} placeholder="KEXP"
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background" />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Frequency</label>
          <Input value={frequency} onChange={(e) => setFrequency(e.target.value)} placeholder="90.3 FM"
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">City</label>
          <Input value={city} onChange={(e) => setCity(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background" />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">State</label>
          <Input value={state} onChange={(e) => setState(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background" />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Country</label>
          <Input value={country} onChange={(e) => setCountry(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Email</label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background" />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Phone</label>
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Website</label>
          <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://..."
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background" />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">DJ Name</label>
          <Input value={djName} onChange={(e) => setDjName(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">Tier / Radio tag</label>
        <Input
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          list="radio-tier-options"
          placeholder="NACC 1, JBE, Mediabase, SubModern…"
          className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
        />
        <datalist id="radio-tier-options">
          {TIER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </datalist>
        <p className="mt-1 text-xs text-muted-foreground">Use the real chart/network tag from the station list; not only A/B/C/D.</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">Notes</label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
          className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</Button>
        <Button type="submit" disabled={loading}
          className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/80 disabled:opacity-50">
          {loading ? "Saving..." : isEdit ? "Save Changes" : "Create Radio Station"}
        </Button>
      </div>
    </form>
  );
}
