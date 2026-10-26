import Decimal from "decimal.js";
import { z } from "zod";

const text = z.string().trim().max(12000).default("");
const date = z.union([z.literal(""), z.iso.date()]).default("");
export const syncDetailsSchema = z
  .object({
    recording_title: z.string().trim().min(1).max(500),
    version_name: z.string().trim().min(1).max(200),
    provenance: z.string().trim().min(1).max(12000),
    production_type: text,
    episode_scene: text,
    use_type: text,
    duration_uses: text,
    media: text,
    territories: text,
    term: text,
    term_start: text,
    exclusivity: text,
    promotion: text,
    soundtrack: text,
    credits: text,
    options: text,
    fee_amount: z
      .union([z.literal(""), z.string().regex(/^\d{1,12}(\.\d{1,8})?$/)])
      .default(""),
    currency: z
      .union([z.literal(""), z.string().regex(/^[A-Z]{3}$/)])
      .default(""),
    fee_basis: z
      .enum(["unknown", "master_only", "publishing_only", "per_side", "all_in"])
      .default("unknown"),
    commercial_status: z
      .enum([
        "enquiry",
        "negotiating",
        "accepted_in_principle",
        "declined",
        "cancelled",
      ])
      .default("enquiry"),
    mfn: z
      .enum(["unknown", "requested", "agreed", "not_agreed", "not_applicable"])
      .default("unknown"),
    mfn_terms: text,
    authority: text,
    represented_share: text,
    required_approvals: text,
    master_status: z
      .enum(["unknown", "pending", "approved", "declined"])
      .default("unknown"),
    publishing_status: z
      .enum(["unknown", "pending", "approved", "declined"])
      .default("unknown"),
    master_evidence: text,
    publishing_evidence: text,
    master_responsible: text,
    publishing_responsible: text,
    contract_status: z
      .enum(["unknown", "draft", "signed", "effective", "needs_review"])
      .default("unknown"),
    signed_date: date,
    effective_conditions: text,
    contract_document_id: text,
    delivery_status: z
      .enum(["unknown", "pending", "delivered", "acknowledged"])
      .default("unknown"),
    delivery_file: text,
    delivery_format: text,
    delivery_recipient: text,
    delivery_date: date,
    delivery_evidence: text,
    delivery_due: date,
    invoice_reference: text,
    invoice_document_id: text,
    invoice_date: date,
    payment_due: date,
    deductions: text,
    settlement_status: z
      .enum(["unknown", "pending", "reviewed", "paid"])
      .default("unknown"),
    settlement_document_id: text,
    settlement_evidence: text,
    cue_status: z
      .enum(["unknown", "requested", "received", "submitted", "not_applicable"])
      .default("unknown"),
    cue_document_id: text,
    cue_evidence: text,
    writers_publishers: text,
    final_usage: text,
    release_date: date,
    expiry_date: date,
    use_evidence: text,
  })
  .strict();
export type SyncDetails = z.infer<typeof syncDetailsSchema>;
export type SyncField = keyof SyncDetails;
export function syncDraft(): SyncDetails {
  // Required strings are kept empty in an unsaved form, validated on save.
  return {
    ...syncDetailsSchema.parse({
      recording_title: "New recording",
      version_name: "Version to confirm",
      provenance: "To confirm",
    }),
    recording_title: "",
    version_name: "",
    provenance: "",
  };
}
export const syncSaveSchema = z
  .object({
    id: z.uuid(),
    expected_version: z.number().int().nonnegative(),
    production: z.string().trim().min(1).max(500),
    artist_id: text,
    release_id: text,
    track_id: text,
    contact_id: text,
    asset_id: text,
    licensee: text,
    details: syncDetailsSchema,
    next_action: text,
    owner: text,
    due_date: date,
  })
  .strict();
export type SyncSave = z.infer<typeof syncSaveSchema>;
export const receiptSchema = z
  .object({
    id: z.uuid(),
    deal_id: z.uuid(),
    amount: z
      .string()
      .regex(/^\d{1,12}(\.\d{1,8})?$/)
      .refine((v) => new Decimal(v).gt(0), "Amount must be positive"),
    currency: z.string().regex(/^[A-Z]{3}$/),
    received_date: z.iso.date(),
    reference: z.string().trim().min(1).max(500),
    document_id: text,
  })
  .strict();
export type SyncReceipt = z.infer<typeof receiptSchema>;

const material: SyncField[] = [
  "recording_title",
  "version_name",
  "production_type",
  "episode_scene",
  "use_type",
  "duration_uses",
  "media",
  "territories",
  "term",
  "term_start",
  "exclusivity",
  "promotion",
  "soundtrack",
  "credits",
  "options",
  "fee_amount",
  "currency",
  "fee_basis",
  "mfn",
  "mfn_terms",
  "authority",
  "represented_share",
  "required_approvals",
];
export function revisedSyncDetails(
  before: SyncSave | null,
  next: SyncSave,
): SyncDetails {
  const d = { ...next.details };
  if (
    before &&
    (material.some((key) => before.details[key] !== d[key]) ||
      [
        "production",
        "artist_id",
        "release_id",
        "track_id",
        "asset_id",
        "licensee",
      ].some(
        (key) => before[key as keyof SyncSave] !== next[key as keyof SyncSave],
      ))
  ) {
    d.master_status = "pending";
    d.publishing_status = "pending";
    d.contract_status = "needs_review";
    if (d.commercial_status === "accepted_in_principle")
      d.commercial_status = "negotiating";
  }
  if (before) {
    const recordingChanged =
      before.track_id !== next.track_id ||
      before.asset_id !== next.asset_id ||
      ["recording_title", "version_name", "delivery_file"].some(
        (key) => before.details[key as SyncField] !== d[key as SyncField],
      );
    if (recordingChanged) {
      d.delivery_status = "pending";
      d.cue_status = "unknown";
    }
    if (
      [
        "fee_amount",
        "currency",
        "fee_basis",
        "deductions",
        "authority",
        "represented_share",
      ].some((key) => before.details[key as SyncField] !== d[key as SyncField])
    ) {
      d.settlement_status = "pending";
    }
  }
  if (d.master_status === "approved" && (!d.master_evidence || !d.authority))
    throw new Error("Master approval needs authority and evidence");
  if (d.publishing_status === "approved" && !d.publishing_evidence)
    throw new Error("Publishing approval needs evidence");
  if (
    ["signed", "effective"].includes(d.contract_status) &&
    (!d.contract_document_id || !d.signed_date)
  )
    throw new Error("Signed contracts need a document and signing date");
  if (d.contract_status === "effective" && !d.effective_conditions)
    throw new Error(
      "Record evidence that the effectiveness conditions are satisfied",
    );
  if (
    ["delivered", "acknowledged"].includes(d.delivery_status) &&
    (!d.delivery_file ||
      !d.delivery_date ||
      !d.delivery_recipient ||
      !d.delivery_evidence)
  )
    throw new Error(
      "Delivery needs the exact file, date, recipient and evidence",
    );
  if (
    ["reviewed", "paid"].includes(d.settlement_status) &&
    (!d.settlement_document_id || !d.settlement_evidence)
  )
    throw new Error("Settlement needs a reviewed worksheet and evidence");
  if (["received", "submitted"].includes(d.cue_status) && !d.cue_evidence)
    throw new Error("Cue-sheet status needs evidence");
  return d;
}
export function syncMoney(
  details: SyncDetails,
  receipts: { amount: string; currency: string }[],
) {
  const totals: Record<string, string> = {};
  for (const r of receipts)
    totals[r.currency] = new Decimal(totals[r.currency] ?? 0)
      .plus(r.amount)
      .toFixed();
  const comparable =
    details.currency &&
    details.fee_amount !== "" &&
    ["master_only", "publishing_only"].includes(details.fee_basis) &&
    details.commercial_status === "accepted_in_principle";
  const balance = comparable
    ? new Decimal(details.fee_amount)
        .minus(totals[details.currency] ?? 0)
        .toFixed()
    : null;
  return {
    totals,
    balance,
    status:
      balance !== null
        ? new Decimal(balance).lte(0)
          ? "received"
          : totals[details.currency]
            ? "part_received"
            : "not_received"
        : receipts.length
          ? "receipts_recorded"
          : "unknown",
  };
}
export function syncFee(d: SyncDetails) {
  return d.fee_amount === ""
    ? "Fee unknown"
    : `${new Decimal(d.fee_amount).toFixed()} ${d.currency || "(currency unconfirmed)"}`;
}
export const syncLabel = (value: string) => value.replaceAll("_", " ");
