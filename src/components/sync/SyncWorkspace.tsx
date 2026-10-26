import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  syncDraft,
  syncFee,
  syncLabel,
  type SyncSave,
  type SyncField,
} from "../../lib/sync";
import type {
  getSyncDeal,
  listSyncDeals,
  syncOptions,
} from "../../server/sync";

type RecordData = Awaited<ReturnType<typeof getSyncDeal>>;
type Options = Awaited<ReturnType<typeof syncOptions>>;
type Item = Awaited<ReturnType<typeof listSyncDeals>>[number];
const inputStyle = "w-full rounded-md border bg-background px-3 py-2 text-sm";
const groups: { title: string; fields: [SyncField, string][] }[] = [
  {
    title: "Recording and source",
    fields: [
      ["recording_title", "Recording title"],
      ["version_name", "Exact version"],
      ["provenance", "Source / owner report"],
    ],
  },
  {
    title: "Use and terms",
    fields: [
      ["production_type", "Production type"],
      ["episode_scene", "Episode / scene"],
      ["use_type", "Use type"],
      ["duration_uses", "Duration and number of uses"],
      ["media", "Media"],
      ["territories", "Territories"],
      ["term", "Term (explicitly state perpetual if agreed)"],
      ["term_start", "Term starts when"],
      ["exclusivity", "Exclusivity"],
      ["promotion", "Trailers and promotion"],
      ["soundtrack", "Soundtrack rights"],
      ["credits", "Required credits"],
      ["options", "Options and additional uses"],
    ],
  },
  {
    title: "Fee and negotiation",
    fields: [
      ["commercial_status", "Commercial progress"],
      ["fee_amount", "Reported / agreed fee"],
      ["currency", "Currency code (blank if unconfirmed)"],
      ["fee_basis", "Fee covers"],
      ["mfn", "MFN status"],
      ["mfn_terms", "MFN comparator, scope and terms"],
    ],
  },
  {
    title: "Rights and approvals",
    fields: [
      ["authority", "Label authority and agreement reference"],
      ["represented_share", "Share represented"],
      ["required_approvals", "Required approvals / third-party conditions"],
      ["master_status", "Master clearance"],
      ["master_responsible", "Master responsible party"],
      ["master_evidence", "Master approval evidence"],
      ["publishing_status", "Publishing clearance"],
      ["publishing_responsible", "Publishing responsible party"],
      ["publishing_evidence", "Publishing approval evidence"],
    ],
  },
  {
    title: "Contract",
    fields: [
      ["contract_status", "Contract status"],
      ["contract_document_id", "Licence document"],
      ["signed_date", "Signed date"],
      ["effective_conditions", "Effectiveness conditions and evidence"],
    ],
  },
  {
    title: "Delivery",
    fields: [
      ["delivery_status", "Delivery status"],
      ["delivery_file", "Exact file / version delivered"],
      ["delivery_format", "File format"],
      ["delivery_recipient", "Recipient"],
      ["delivery_due", "Delivery deadline"],
      ["delivery_date", "Delivery date"],
      ["delivery_evidence", "Delivery / acknowledgement evidence"],
    ],
  },
  {
    title: "Invoice and settlement",
    fields: [
      ["invoice_reference", "Invoice / accounting reference"],
      ["invoice_document_id", "Invoice document"],
      ["invoice_date", "Invoice date"],
      ["payment_due", "Payment due"],
      ["deductions", "Documented fees, tax, withholding and charges"],
      ["settlement_status", "Settlement status"],
      ["settlement_document_id", "Reviewed settlement worksheet"],
      ["settlement_evidence", "Settlement / payout evidence"],
    ],
  },
  {
    title: "Cue sheet and follow-up",
    fields: [
      ["cue_status", "Cue-sheet status"],
      ["cue_document_id", "Cue-sheet document"],
      ["cue_evidence", "Cue-sheet receipt / submission evidence"],
      [
        "writers_publishers",
        "Original writers, publishers and society identifiers",
      ],
      ["final_usage", "Final duration and use type"],
      ["release_date", "Release / air date"],
      ["expiry_date", "Expiry / next option date"],
      ["use_evidence", "Released use / credit evidence"],
    ],
  },
];
const choices: Partial<Record<SyncField, string[]>> = {
  commercial_status: [
    "enquiry",
    "negotiating",
    "accepted_in_principle",
    "declined",
    "cancelled",
  ],
  fee_basis: [
    "unknown",
    "master_only",
    "publishing_only",
    "per_side",
    "all_in",
  ],
  mfn: ["unknown", "requested", "agreed", "not_agreed", "not_applicable"],
  master_status: ["unknown", "pending", "approved", "declined"],
  publishing_status: ["unknown", "pending", "approved", "declined"],
  contract_status: ["unknown", "draft", "signed", "effective", "needs_review"],
  delivery_status: ["unknown", "pending", "delivered", "acknowledged"],
  settlement_status: ["unknown", "pending", "reviewed", "paid"],
  cue_status: [
    "unknown",
    "requested",
    "received",
    "submitted",
    "not_applicable",
  ],
};
export function SyncList({
  items,
  artistId,
  releaseId,
}: {
  items: Item[];
  artistId?: string;
  releaseId?: string;
}) {
  const visible = items.filter(
    ({ deal }) =>
      (!artistId || deal.artist_id === artistId) &&
      (!releaseId || deal.release_id === releaseId),
  );
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Sync</h1>
          <p className="text-muted-foreground">
            Licences, delivery and money — one place for each placement.
          </p>
        </div>
        <Button
          render={
            <a
              href={`/sync/new${artistId ? `?artist=${encodeURIComponent(artistId)}` : releaseId ? `?release=${encodeURIComponent(releaseId)}` : ""}`}
            />
          }
        >
          New deal
        </Button>
      </div>
      {!visible.length ? (
        <p className="rounded-xl border p-8 text-muted-foreground">
          No sync deals here yet. Add the production and recording to start.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visible.map(
            ({ deal, next_action, owner, due_date, task_status }) => (
              <a
                key={deal.id}
                href={`/sync/${deal.id}`}
                className="rounded-xl border p-5 transition-colors hover:bg-muted/40"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <h2 className="font-semibold">{deal.production}</h2>
                  <span>{syncFee(deal.details)}</span>
                </div>
                <p className="mt-1">
                  {deal.details.recording_title} · {deal.details.version_name}
                </p>
                <p className="mt-3 text-sm text-muted-foreground">
                  {syncLabel(deal.details.commercial_status)} · Master{" "}
                  {deal.details.master_status} · Publishing{" "}
                  {deal.details.publishing_status}
                </p>
                <p className="mt-3 text-sm">
                  {next_action || "Set a next action"}
                  {task_status ? ` · ${task_status}` : ""}
                </p>
                <p className="text-sm text-muted-foreground">
                  {[owner, due_date].filter(Boolean).join(" · ")}
                </p>
              </a>
            ),
          )}
        </div>
      )}
    </div>
  );
}
function formValue(record: RecordData): SyncSave {
  const d = record.deal;
  return {
    id: d.id,
    expected_version: d.version,
    production: d.production,
    artist_id: d.artist_id ?? "",
    release_id: d.release_id ?? "",
    track_id: d.track_id ?? "",
    contact_id: d.contact_id ?? "",
    asset_id: d.asset_id ?? "",
    licensee: d.licensee ?? "",
    details: d.details,
    next_action: record.next_action ?? "",
    owner: record.owner ?? "",
    due_date: record.due_date ?? "",
  };
}
export function SyncEditor({
  initial,
  options,
  artistId = "",
  releaseId = "",
}: {
  initial: RecordData | null;
  options: Options;
  artistId?: string;
  releaseId?: string;
}) {
  const [record, setRecord] = useState(initial);
  const [form, setForm] = useState<SyncSave>(() =>
    initial
      ? formValue(initial)
      : {
          id: crypto.randomUUID(),
          expected_version: 0,
          production: "",
          artist_id: artistId,
          release_id: releaseId,
          track_id: "",
          contact_id: "",
          asset_id: "",
          licensee: "",
          details: syncDraft(),
          next_action: "",
          owner: "",
          due_date: "",
        },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [receipt, setReceipt] = useState({
    id: crypto.randomUUID(),
    amount: "",
    currency: "",
    received_date: "",
    reference: "",
    document_id: "",
  });
  function detail(key: SyncField, value: string) {
    setForm((f) => ({ ...f, details: { ...f.details, [key]: value } }));
  }
  async function mutate(action: "save" | "receipt") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          input: action === "save" ? form : { ...receipt, deal_id: form.id },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save");
      if (action === "save") {
        if (!record) {
          window.location.assign(`/sync/${data.deal.id}`);
          return;
        }
        setForm(formValue(data));
        setRecord(data);
        setNotice(
          data.deal.details.contract_status === "needs_review"
            ? "Saved. Material terms changed; review and approve the new revision."
            : "Saved.",
        );
      } else {
        // Refresh collection evidence without discarding unsaved licence edits.
        setRecord((current) =>
          current
            ? { ...current, receipts: data.receipts, money: data.money }
            : data,
        );
        setReceipt({
          id: crypto.randomUUID(),
          amount: "",
          currency: "",
          received_date: "",
          reference: "",
          document_id: "",
        });
        setNotice("Receipt recorded.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function select(
    label: string,
    value: string,
    onChange: (v: string) => void,
    rows: { id: string; label: string | null }[],
  ) {
    return (
      <label className="grid gap-1 text-sm">
        {label}
        <select
          aria-label={label}
          className={inputStyle}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Unconfirmed / not linked</option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label || r.id}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <a href="/sync" className="text-sm underline">
        ← All sync deals
      </a>
      <header>
        <h1 className="text-2xl font-semibold">
          {record?.deal.production || "New sync deal"}
        </h1>
        <p className="text-muted-foreground">
          Keep the requested use, approvals and evidence together.
        </p>
        {record && (
          <p className="mt-2">
            {syncFee(record.deal.details)} ·{" "}
            {syncLabel(record.deal.details.fee_basis)} · Revision{" "}
            {record.deal.version}
          </p>
        )}
      </header>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive p-3 text-destructive"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border p-3">
          {notice}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void mutate("save");
        }}
        className="space-y-5"
      >
        <fieldset disabled={busy} className="space-y-5">
          <section className="grid gap-4 rounded-xl border p-5 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              Production
              <Input
                required
                value={form.production}
                onChange={(e) =>
                  setForm({ ...form, production: e.target.value })
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              Licensee / billing entity
              <Input
                value={form.licensee}
                onChange={(e) => setForm({ ...form, licensee: e.target.value })}
              />
            </label>
            {select(
              "Artist",
              form.artist_id,
              (v) => setForm({ ...form, artist_id: v }),
              options.artists,
            )}
            {select(
              "Release",
              form.release_id,
              (v) => setForm({ ...form, release_id: v, track_id: "" }),
              options.releases,
            )}
            {select(
              "Catalog recording",
              form.track_id,
              (v) => setForm({ ...form, track_id: v }),
              options.tracks.filter(
                (t) => !form.release_id || t.release_id === form.release_id,
              ),
            )}
            {select(
              "Supervisor / contact",
              form.contact_id,
              (v) => setForm({ ...form, contact_id: v }),
              options.contacts,
            )}
            {select(
              "Linked media asset",
              form.asset_id,
              (v) => setForm({ ...form, asset_id: v }),
              options.assets,
            )}
          </section>
          <section className="rounded-xl border p-5">
            <h2 className="mb-3 font-semibold">Next action</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Saved to Tasks, where you can complete it and manage further
              follow-ups.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">
                Action
                <Input
                  value={form.next_action}
                  onChange={(e) =>
                    setForm({ ...form, next_action: e.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                Owner
                <Input
                  value={form.owner}
                  onChange={(e) => setForm({ ...form, owner: e.target.value })}
                />
              </label>
              <label className="grid gap-1 text-sm">
                Due date
                <Input
                  type="date"
                  value={form.due_date}
                  onChange={(e) =>
                    setForm({ ...form, due_date: e.target.value })
                  }
                />
              </label>
            </div>
            {record?.deal.task_id && (
              <a
                className="mt-2 block text-sm underline"
                href={`/ops-tasks?task=${encodeURIComponent(record.deal.task_id)}`}
              >
                Open Tasks · {record.task_status}
              </a>
            )}
          </section>
          {groups.map((group, index) => (
            <details
              key={group.title}
              open={index === 0 || index === 2}
              className="rounded-xl border p-5"
            >
              <summary className="cursor-pointer font-semibold">
                {group.title}
              </summary>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {group.fields.map(([key, label]) =>
                  key.endsWith("_document_id") ? (
                    <div key={key}>
                      {select(
                        label,
                        form.details[key],
                        (v) => detail(key, v),
                        options.documents,
                      )}
                    </div>
                  ) : (
                    <label key={key} className="grid gap-1 text-sm">
                      {label}
                      {choices[key] ? (
                        <select
                          aria-label={label}
                          className={inputStyle}
                          value={form.details[key]}
                          onChange={(e) => detail(key, e.target.value)}
                        >
                          {choices[key]!.map((v) => (
                            <option key={v} value={v}>
                              {syncLabel(v)}
                            </option>
                          ))}
                        </select>
                      ) : key.endsWith("_date") || key.endsWith("_due") ? (
                        <Input
                          type="date"
                          value={form.details[key]}
                          onChange={(e) => detail(key, e.target.value)}
                        />
                      ) : key === "fee_amount" || key === "currency" ? (
                        <Input
                          inputMode={key === "fee_amount" ? "decimal" : "text"}
                          value={form.details[key]}
                          onChange={(e) =>
                            detail(
                              key,
                              key === "currency"
                                ? e.target.value.toUpperCase()
                                : e.target.value,
                            )
                          }
                        />
                      ) : (
                        <textarea
                          rows={2}
                          className={inputStyle}
                          value={form.details[key]}
                          onChange={(e) => detail(key, e.target.value)}
                        />
                      )}
                    </label>
                  ),
                )}
              </div>
            </details>
          ))}
          <p className="text-sm text-muted-foreground">
            Changing material terms requires approval again. Earlier signed
            terms remain in revision history. Settlement uses the reviewed
            agreement; catalog shares are not applied automatically.
          </p>
          <Button type="submit">{busy ? "Saving…" : "Save deal"}</Button>
        </fieldset>
      </form>
      {record && (
        <section className="space-y-4 rounded-xl border p-5">
          <h2 className="font-semibold">Money received</h2>
          <p>
            {syncLabel(record.money.status)}
            {record.money.balance !== null
              ? ` · Uncollected fee ${record.money.balance} ${record.deal.details.currency}`
              : " · Balance awaits a confirmed single-side fee and currency"}
          </p>
          <p className="text-sm text-muted-foreground">
            Receipts are evidence of collection, not artist payouts or royalty
            postings. Match them to the accounting record. Do not record the
            same transfer twice.
          </p>
          {record.receipts.map((r) => (
            <p key={r.id} className="text-sm">
              {r.received_date} · {r.amount} {r.currency} · {r.reference}
            </p>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void mutate("receipt");
            }}
            className="grid gap-3 sm:grid-cols-2"
          >
            <fieldset disabled={busy} className="contents">
              {(
                [
                  ["amount", "Amount"],
                  ["currency", "Currency"],
                  ["received_date", "Received date"],
                  ["reference", "Accounting / bank reference"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="grid gap-1 text-sm">
                  {label}
                  <Input
                    required
                    type={key === "received_date" ? "date" : "text"}
                    value={receipt[key]}
                    onChange={(e) =>
                      setReceipt({
                        ...receipt,
                        [key]:
                          key === "currency"
                            ? e.target.value.toUpperCase()
                            : e.target.value,
                      })
                    }
                  />
                </label>
              ))}
              {select(
                "Receipt document",
                receipt.document_id,
                (v) => setReceipt({ ...receipt, document_id: v }),
                options.documents,
              )}
              <Button type="submit" className="self-end">
                Record receipt
              </Button>
            </fieldset>
          </form>
        </section>
      )}
      {record && (
        <section className="rounded-xl border p-5">
          <h2 className="mb-3 font-semibold">Revision history</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Each saved revision preserves the terms and the person who recorded
            them.
          </p>
          {record.revisions.map((r) => (
            <details key={r.id} className="border-t py-3">
              <summary className="cursor-pointer">
                Revision {r.version} · {new Date(r.created_at).toLocaleString()}{" "}
                · {syncLabel(r.snapshot.details.contract_status)}
              </summary>
              <p className="mt-2 text-sm">
                {r.snapshot.production}
                {r.snapshot.licensee ? ` · ${r.snapshot.licensee}` : ""} ·
                Recorded by {r.actor_id}
              </p>
              <dl className="mt-3 grid gap-2 text-sm">
                {groups
                  .flatMap((g) => g.fields)
                  .filter(([k]) => r.snapshot.details[k])
                  .map(([k, label]) => (
                    <div key={k}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="whitespace-pre-wrap break-words">
                        {k.endsWith("_document_id")
                          ? options.documents.find(
                              (d) => d.id === r.snapshot.details[k],
                            )?.label || "Document no longer available"
                          : choices[k]
                            ? syncLabel(r.snapshot.details[k])
                            : r.snapshot.details[k]}
                      </dd>
                    </div>
                  ))}
              </dl>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
