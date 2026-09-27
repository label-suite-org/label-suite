"use client";

import { useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
const SOURCE_OPTIONS = ["Spotify", "Apple Music", "Tidal", "CD Baby", "DistroKid", "YouTube Music", "Amazon Music", "Pandora", "Other"];

const PAID_OUT_OPTIONS = ["unpaid", "pending", "paid"];

const REVENUE_TYPE_OPTIONS = ["streaming", "download", "sync", "mechanical", "performance", "advance", "other"];

export interface RoyaltyRecord {
  id: string;
  record_name: string;
  statement_period?: string | null;
  source?: string | null;
  artist_id?: string | null;
  release_id?: string | null;
  gross_revenue?: number | null;
  costs?: number | null;
  net_revenue?: number | null;
  paid_out?: string | null;
  payment_date?: string | null;
  notes?: string | null;
  revenue_type?: string | null;
  revenue_month?: string | null;
  source_contact_id?: string | null;
  payment_method?: string | null;
  artist_name?: string | null;
  release_title?: string | null;
}

export function RoyaltyForm({
  initial,
  artists,
  releases,
  onClose,
}: {
  initial?: RoyaltyRecord | null;
  artists: Array<{ id: string; name: string }>;
  releases: Array<{ id: string; title: string }>;
  onClose: () => void;
}) {
  const formId = useId();
  const isEdit = !!initial;
  const [recordName, setRecordName] = useState(initial?.record_name || "");
  const [statementPeriod, setStatementPeriod] = useState(initial?.statement_period || "");
  const [source, setSource] = useState(initial?.source || "");
  const [artistId, setArtistId] = useState(initial?.artist_id || "");
  const [releaseId, setReleaseId] = useState(initial?.release_id || "");
  const [grossRevenue, setGrossRevenue] = useState(initial?.gross_revenue?.toString() || "");
  const [costs, setCosts] = useState(initial?.costs?.toString() || "");
  const [netRevenue, setNetRevenue] = useState(initial?.net_revenue?.toString() || "");
  const [paidOut, setPaidOut] = useState(initial?.paid_out || "unpaid");
  const [paymentDate, setPaymentDate] = useState(initial?.payment_date || "");
  const [revenueType, setRevenueType] = useState(initial?.revenue_type || "");
  const [revenueMonth, setRevenueMonth] = useState(initial?.revenue_month || "");
  const [paymentMethod, setPaymentMethod] = useState(initial?.payment_method || "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: { preventDefault: () => void; currentTarget: HTMLFormElement }) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        record_name: recordName.trim(),
        statement_period: statementPeriod || null,
        source: source || null,
        artist_id: artistId || null,
        release_id: releaseId || null,
        gross_revenue: grossRevenue ? Number(grossRevenue) : null,
        costs: costs ? Number(costs) : null,
        net_revenue: netRevenue ? Number(netRevenue) : null,
        paid_out: paidOut,
        payment_date: paymentDate || null,
        revenue_type: revenueType || null,
        revenue_month: revenueMonth || null,
        payment_method: paymentMethod || null,
        notes: notes || null,
      };
      const res = await fetch("/api/royalties", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? { ...body, id: initial!.id } : body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to ${isEdit ? "update" : "create"} royalty record`);
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
        <label htmlFor={`${formId}-record-name`} className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Record Name *</label>
        <Input
          id={`${formId}-record-name`}
          value={recordName}
          onChange={(e) => setRecordName(e.target.value)}
          required
          className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${formId}-statement-period`} className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Statement Period</label>
          <Input
            id={`${formId}-statement-period`}
            value={statementPeriod}
            onChange={(e) => setStatementPeriod(e.target.value)}
            placeholder="e.g. Q1 2025"
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
          />
        </div>
        <div>
          <label htmlFor={`${formId}-source`} className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Source</label>
          <NativeSelect
            id={`${formId}-source`}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
          >
            <option value="">— Select source —</option>
            {SOURCE_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${formId}-artist`} className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Artist</label>
          <NativeSelect
            id={`${formId}-artist`}
            value={artistId}
            onChange={(e) => setArtistId(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
          >
            <option value="">— Select artist —</option>
            {artists.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label htmlFor={`${formId}-release`} className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Release</label>
          <NativeSelect
            id={`${formId}-release`}
            value={releaseId}
            onChange={(e) => setReleaseId(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
          >
            <option value="">— Select release —</option>
            {releases.map((r) => (
              <option key={r.id} value={r.id}>{r.title}</option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${formId}-revenue-type`} className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Revenue Type</label>
          <NativeSelect
            id={`${formId}-revenue-type`}
            value={revenueType}
            onChange={(e) => setRevenueType(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
          >
            <option value="">— Select type —</option>
            {REVENUE_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label htmlFor={`${formId}-revenue-month`} className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Revenue Month</label>
          <Input
            id={`${formId}-revenue-month`}
            type="month"
            value={revenueMonth}
            onChange={(e) => setRevenueMonth(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label htmlFor={`${formId}-gross-revenue`} className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Gross Revenue</label>
          <Input
            id={`${formId}-gross-revenue`}
            type="number"
            step="0.01"
            value={grossRevenue}
            onChange={(e) => setGrossRevenue(e.target.value)}
            placeholder="0.00"
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
          />
        </div>
        <div>
          <label htmlFor={`${formId}-costs`} className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Costs</label>
          <Input
            id={`${formId}-costs`}
            type="number"
            step="0.01"
            value={costs}
            onChange={(e) => setCosts(e.target.value)}
            placeholder="0.00"
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
          />
        </div>
        <div>
          <label htmlFor={`${formId}-net-revenue`} className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Net Revenue</label>
          <Input
            id={`${formId}-net-revenue`}
            type="number"
            step="0.01"
            value={netRevenue}
            onChange={(e) => setNetRevenue(e.target.value)}
            placeholder="0.00"
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${formId}-payment-status`} className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Payment Status</label>
          <NativeSelect
            id={`${formId}-payment-status`}
            value={paidOut}
            onChange={(e) => setPaidOut(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
          >
            {PAID_OUT_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label htmlFor={`${formId}-payment-date`} className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Payment Date</label>
          <Input
            id={`${formId}-payment-date`}
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
          />
        </div>
      </div>

      <div>
        <label htmlFor={`${formId}-payment-method`} className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Payment Method</label>
        <Input
          id={`${formId}-payment-method`}
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
          placeholder="e.g. Wire, PayPal, ACH"
          className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
        />
      </div>

      <div>
        <label htmlFor={`${formId}-notes`} className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Notes</label>
        <Textarea
          id={`${formId}-notes`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2 justify-end">
        <Button variant="ghost"
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Saving..." : isEdit ? "Save Changes" : "Create Royalty Record"}
        </Button>
      </div>
    </form>
  );
}
