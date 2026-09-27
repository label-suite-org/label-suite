import { createHash } from "node:crypto";

export type FinanceTransactionInput = {
  source_provider: string;
  account_label: string;
  external_transaction_id?: string | null;
  occurred_at: string;
  posted_at?: string | null;
  amount: string;
  currency: string;
  direction: "credit" | "debit";
  description?: string | null;
  raw_evidence: Record<string, unknown>;
  idempotency_key?: string;
};

export type NormalizedFinanceTransaction = Omit<FinanceTransactionInput, "idempotency_key" | "amount" | "currency" | "source_provider" | "account_label" | "external_transaction_id" | "description" | "posted_at"> & {
  source_provider: string;
  account_label: string;
  external_transaction_id: string | null;
  posted_at: string | null;
  amount: string;
  currency: string;
  description: string | null;
  idempotency_key: string;
};

export function stableJsonStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJsonStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function hashRawFinanceEvidence(evidence: Record<string, unknown>) {
  return createHash("sha256").update(stableJsonStringify(evidence)).digest("hex");
}

function normalizeAmount(value: string) {
  const amount = value.trim();
  if (!/^\d+(?:\.\d{1,8})?$/.test(amount) || Number(amount) <= 0) {
    throw new Error("amount must be a positive decimal with up to 8 fractional digits");
  }
  return amount.replace(/\.?(0+)$/, "").replace(/\.$/, "") || "0";
}

export function normalizeFinanceTransaction(input: FinanceTransactionInput): NormalizedFinanceTransaction {
  const provider = input.source_provider.trim().toLowerCase();
  const account = input.account_label.trim();
  const currency = input.currency.trim().toUpperCase();
  if (!provider || !account) throw new Error("source_provider and account_label are required");
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("currency must be a three-letter code");
  const amount = normalizeAmount(input.amount);
  const externalId = input.external_transaction_id?.trim() || null;
  const description = input.description?.trim() || null;
  const idempotencyKey = input.idempotency_key?.trim() || [provider, account, input.occurred_at, amount, currency, input.direction, externalId ?? "no-external-id", hashRawFinanceEvidence(input.raw_evidence)].join(":");
  return {
    source_provider: provider,
    account_label: account,
    external_transaction_id: externalId,
    occurred_at: input.occurred_at,
    posted_at: input.posted_at ?? null,
    amount,
    currency,
    direction: input.direction,
    description,
    raw_evidence: input.raw_evidence,
    idempotency_key: idempotencyKey,
  };
}

export function deriveFinanceExceptionIdempotencyKey(transactionId: string) {
  return `finance_reconciliation:unmatched:${transactionId}`;
}

export function compareDecimalStrings(left: string, right: string) {
  const [leftWhole, leftFraction = ""] = left.split(".");
  const [rightWhole, rightFraction = ""] = right.split(".");
  const whole = BigInt(leftWhole) - BigInt(rightWhole);
  if (whole !== 0n) return whole > 0n ? 1 : -1;
  const fraction = BigInt((leftFraction + "0".repeat(8)).slice(0, 8)) - BigInt((rightFraction + "0".repeat(8)).slice(0, 8));
  return fraction === 0n ? 0 : fraction > 0n ? 1 : -1;
}
