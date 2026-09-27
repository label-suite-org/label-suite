import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  campaignEnrichmentProposalSubmissionSchema,
  type CampaignEnrichmentProposalSubmission,
} from "../../../src/lib/campaign-enrichment-local-tool-contract";
import {
  CampaignEnrichmentClient,
  LocalToolClientError,
  normalizeBaseUrl,
  type CampaignEnrichmentClaimData,
  type CampaignEnrichmentClientOptions,
  type CampaignEnrichmentItemData,
  type CampaignEnrichmentProposalData,
  type CampaignEnrichmentQueueData,
  type CampaignEnrichmentReleaseData,
} from "./client";
import {
  KeychainCredentialError,
  MacOsKeychainCredentialStore,
  type InteractiveCredentialStore,
} from "./keychain";

export const DEFAULT_BASE_URL = "https://suite.truenature.online";
const LOCAL_TOOL_TOKEN_PATTERN = /lsmcp_[A-Za-z0-9-]+_[A-Za-z0-9_-]{43}/g;
const TERMINAL_ESCAPE_PATTERN = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g;
const TERMINAL_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;
const RAW_JSON_CONTROL_PATTERN = /[\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;

type Client = Pick<
  CampaignEnrichmentClient,
  "listQueue" | "getItem" | "claimItem" | "submitProposal" | "releaseItem"
>;

export interface CliDependencies {
  credentials?: InteractiveCredentialStore;
  createClient?: (options: CampaignEnrichmentClientOptions) => Client;
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  write?: (line: string) => void;
  writeError?: (line: string) => void;
  baseUrl?: string;
}

type AuthCommand = {
  area: "auth";
  action: "login" | "status" | "logout";
  baseUrl: string;
};
type EnrichCommand =
  | { area: "enrich"; action: "list"; campaignId: string; limit: number; json: boolean }
  | { area: "enrich"; action: "show"; itemId: string; json: boolean }
  | { area: "enrich"; action: "claim"; itemId: string; revision: string; json: boolean }
  | { area: "enrich"; action: "propose"; itemId: string; file: string; json: boolean }
  | { area: "enrich"; action: "release"; itemId: string; claimId: string; json: boolean };
type CliCommand = AuthCommand | EnrichCommand;

class CliValidationError extends Error {}

export async function runCli(
  args: readonly string[],
  supplied: CliDependencies = {},
): Promise<number> {
  const write = supplied.write ?? ((line: string) => console.log(line));
  const writeError = supplied.writeError ?? ((line: string) => console.error(line));
  let command: CliCommand;
  try {
    command = parseCliCommand(args);
  } catch {
    writeError("Invalid command or input.");
    return 2;
  }

  const credentials = supplied.credentials ?? new MacOsKeychainCredentialStore();
  if (command.area === "auth") {
    return await runAuth(command, credentials, write, writeError);
  }

  let validatedProposal: CampaignEnrichmentProposalSubmission | undefined;
  if (command.action === "propose") {
    try {
      const contents = await (supplied.readFile ?? readFile)(command.file, "utf8");
      validatedProposal = campaignEnrichmentProposalSubmissionSchema.parse(JSON.parse(contents));
    } catch {
      writeError("Invalid proposal file.");
      return 2;
    }
  }

  try {
    const baseUrl = normalizeBaseUrl(supplied.baseUrl ?? DEFAULT_BASE_URL);
    const client = (supplied.createClient ?? ((options) => new CampaignEnrichmentClient(options)))({
      baseUrl,
      credentials,
    });
    return await runEnrich(command, client, validatedProposal, write);
  } catch (error) {
    const failure = mapFailure(error);
    writeError(withRequestId(failure.message, failure.requestId));
    return failure.exitCode;
  }
}

function parseCliCommand(args: readonly string[]): CliCommand {
  const [area, action, ...rest] = args;
  if (area === "auth" && (action === "login" || action === "status" || action === "logout")) {
    const parsed = parseArgs({
      args: rest,
      options: { "base-url": { type: "string" } },
      allowPositionals: true,
      strict: true,
    });
    if (parsed.positionals.length !== 0 || parsed.values["base-url"] === undefined) {
      throw new CliValidationError();
    }
    return { area, action, baseUrl: normalizeBaseUrl(parsed.values["base-url"]) };
  }
  if (area !== "enrich") throw new CliValidationError();
  if (action === "list") {
    const parsed = parseEnrichArgs(rest, {
      campaign: { type: "string" },
      limit: { type: "string" },
      json: { type: "boolean", default: false },
    });
    if (parsed.positionals.length !== 0) throw new CliValidationError();
    const campaignId = bounded(parsed.values.campaign, 128);
    const limitText = parsed.values.limit ?? "20";
    if (!/^\d+$/.test(limitText)) throw new CliValidationError();
    const limit = Number(limitText);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new CliValidationError();
    return { area, action, campaignId, limit, json: parsed.values.json === true };
  }
  if (action === "show") {
    const parsed = parseEnrichArgs(rest, { json: { type: "boolean", default: false } });
    return {
      area,
      action,
      itemId: oneItemId(parsed.positionals),
      json: parsed.values.json === true,
    };
  }
  if (action === "claim") {
    const parsed = parseEnrichArgs(rest, {
      revision: { type: "string" },
      json: { type: "boolean", default: false },
    });
    const revision = parsed.values.revision;
    if (typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision)) throw new CliValidationError();
    return {
      area,
      action,
      itemId: oneItemId(parsed.positionals),
      revision,
      json: parsed.values.json === true,
    };
  }
  if (action === "propose") {
    const parsed = parseEnrichArgs(rest, {
      file: { type: "string" },
      json: { type: "boolean", default: false },
    });
    return {
      area,
      action,
      itemId: oneItemId(parsed.positionals),
      file: bounded(parsed.values.file, 4_096),
      json: parsed.values.json === true,
    };
  }
  if (action === "release") {
    const parsed = parseEnrichArgs(rest, {
      claim: { type: "string" },
      json: { type: "boolean", default: false },
    });
    return {
      area,
      action,
      itemId: oneItemId(parsed.positionals),
      claimId: bounded(parsed.values.claim, 128),
      json: parsed.values.json === true,
    };
  }
  throw new CliValidationError();
}

function parseEnrichArgs<T extends Record<string, { type: "string" | "boolean"; default?: boolean }>>(
  args: readonly string[],
  options: T,
) {
  return parseArgs({ args, options, allowPositionals: true, strict: true });
}

function oneItemId(positionals: string[]): string {
  if (positionals.length !== 1) throw new CliValidationError();
  return bounded(positionals[0], 128);
}

function bounded(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > maximum) {
    throw new CliValidationError();
  }
  return value;
}

async function runAuth(
  command: AuthCommand,
  credentials: InteractiveCredentialStore,
  write: (line: string) => void,
  writeError: (line: string) => void,
): Promise<number> {
  try {
    if (command.action === "login") {
      await credentials.login(command.baseUrl);
      write(`Credential stored in macOS Keychain for ${command.baseUrl}.`);
    } else if (command.action === "status") {
      await credentials.read(command.baseUrl);
      write(`Authenticated for ${command.baseUrl}.`);
    } else {
      await credentials.logout(command.baseUrl);
      write(`Credential removed from macOS Keychain for ${command.baseUrl}.`);
    }
    return 0;
  } catch (error) {
    if (error instanceof KeychainCredentialError && error.code === "credential_not_found") {
      writeError(`No credential in macOS Keychain for ${command.baseUrl}.`);
      return 3;
    }
    writeError("macOS Keychain unavailable.");
    return 5;
  }
}

async function runEnrich(
  command: EnrichCommand,
  client: Client,
  validatedProposal: CampaignEnrichmentProposalSubmission | undefined,
  write: (line: string) => void,
): Promise<number> {
  if (command.action === "list") {
    const result = await client.listQueue({ campaign_id: command.campaignId, limit: command.limit });
    outputResult(result, command.json, write, formatQueue);
    return 0;
  }
  if (command.action === "show") {
    const result = await client.getItem(command.itemId);
    outputResult(result, command.json, write, formatItem);
    return 0;
  }
  if (command.action === "claim") {
    const result = await client.claimItem(command.itemId, { expected_lead_revision: command.revision });
    outputResult(result, command.json, write, formatClaim);
    return 0;
  }
  if (command.action === "propose") {
    if (validatedProposal === undefined) throw new CliValidationError();
    const result = await client.submitProposal(command.itemId, validatedProposal);
    outputResult(result, command.json, write, formatProposal);
    return 0;
  }
  const result = await client.releaseItem(command.itemId, command.claimId);
  outputResult(result, command.json, write, formatRelease);
  return 0;
}

function outputResult<T>(
  result: { version: string; request_id: string; data: T },
  json: boolean,
  write: (line: string) => void,
  format: (data: T) => string[],
) {
  if (json) {
    write(terminalSafeJson(result));
    return;
  }
  for (const line of format(result.data)) write(terminalSafeText(line));
}

function formatQueue(data: CampaignEnrichmentQueueData): string[] {
  if (data.items.length === 0) return ["No enrichment items."];
  return data.items.map((item) => (
    `${item.item_id} — ${item.target_name} — ${item.campaign_name} — missing: ${item.missing_enrichment_fields.join(", ")}`
  ));
}

function formatItem(data: CampaignEnrichmentItemData): string[] {
  return [
    `${data.item_id} — ${data.target_name} — ${data.campaign_name} — missing: ${data.missing_enrichment_fields.join(", ")}`,
  ];
}

function formatClaim(data: CampaignEnrichmentClaimData): string[] {
  return [`Claim ${data.id} active until ${data.expires_at}.`];
}

function formatProposal(data: CampaignEnrichmentProposalData): string[] {
  const noun = data.suggestions.length === 1 ? "suggestion" : "suggestions";
  return [`Proposal run ${data.run_id} submitted with ${data.suggestions.length} ${noun}.`];
}

function formatRelease(_data: CampaignEnrichmentReleaseData): string[] {
  return ["Claim released."];
}

function mapFailure(error: unknown): { exitCode: 2 | 3 | 4 | 5; message: string; requestId?: string } {
  if (error instanceof LocalToolClientError) {
    const requestId = error.requestId;
    if (error.code === "authentication_failed" || error.code === "scope_forbidden") {
      return { exitCode: 3, message: error.message, requestId };
    }
    if (
      error.code === "stale_revision"
      || error.code === "claim_conflict"
      || error.code === "idempotency_conflict"
    ) {
      return { exitCode: 4, message: error.message, requestId };
    }
    if (error.code === "invalid_request" || error.code === "not_found") {
      return { exitCode: 2, message: error.message, requestId };
    }
    return { exitCode: 5, message: "Label Suite unavailable.", requestId };
  }
  return { exitCode: 5, message: "Label Suite unavailable.", requestId: safeRequestId(error) };
}

function withRequestId(message: string, requestId: string | undefined): string {
  return requestId === undefined ? message : `${message} Request ID: ${requestId}`;
}

function safeRequestId(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("requestId" in error)) return undefined;
  const requestId = error.requestId;
  return typeof requestId === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(requestId)
    ? requestId
    : undefined;
}

function terminalSafeText(value: string): string {
  return value
    .replace(LOCAL_TOOL_TOKEN_PATTERN, "[REDACTED]")
    .replace(TERMINAL_ESCAPE_PATTERN, "")
    .replace(TERMINAL_CONTROL_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function terminalSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(LOCAL_TOOL_TOKEN_PATTERN, "[REDACTED]")
    .replace(RAW_JSON_CONTROL_PATTERN, (character) => (
      `\\u${character.codePointAt(0)?.toString(16).padStart(4, "0")}`
    ));
}
