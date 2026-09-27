import "dotenv/config";
import { HttpError } from "./errors";

const DEFAULT_SAMPLY_BASE_URL = "https://samply.app/api/v0";
const DEFAULT_SAMPLY_EMBED_BASE_URL = "https://samply.app/embed";

export interface SamplyAvailability {
  configured: boolean;
  reason: "missing_token" | "org_mismatch" | null;
  baseUrl: string;
  configuredOrgId: string | null;
}

export interface SamplyConfig {
  token: string;
  baseUrl: string;
  configuredOrgId: string | null;
}

export interface SamplyProjectSummary {
  id: string;
  name: string;
  object: "project";
  artwork?: string | null;
  color?: string | null;
  creator?: {
    displayName?: string | null;
    email?: string | null;
    photoURL?: string | null;
    uid?: string | null;
  } | null;
  size?: number;
  timeCreated?: number;
  timeModified?: number;
  upload?: {
    enabled?: boolean;
    header?: string | null;
    greeting?: string | null;
    redirect?: string | null;
  } | null;
}

export interface SamplyPlayerSummary {
  id: string;
  name: string;
  projectid: string;
  object: "player";
  color?: string | null;
  folderid?: string | null;
  boxids?: string[] | null;
  public: boolean;
  timeCreated?: number;
  timeModified?: number;
  options?: {
    quality?: "original" | "compressed" | "lossless";
    downloads?: boolean;
    comments?: boolean;
    metadata?: boolean;
    isrc?: boolean;
    loudnessMatch?: boolean;
    studio?: boolean;
    stacks?: boolean;
    samplyCTA?: boolean;
    boxSubtitle?: "artist" | "timestamp" | "none";
  } | null;
}

export interface SamplyBoxSummary {
  id: string;
  object: "file" | "folder" | "stack";
  name: string;
  color?: string | null;
  timeCreated?: number;
  timeModified?: number;
  trashed?: boolean;
  duration?: number | null;
  children?: Array<{ id: string; name: string }>;
}

export interface SamplyDownloadUrl {
  url: string;
  expires: number;
}

export interface SamplyComment {
  id: string;
  object: "comment";
  message: string;
  parentid?: string | null;
  completed?: boolean;
  audioTimestamp?: number | null;
  audioTimestampEnd?: number | null;
  timeCreated?: number;
  timeModified?: number;
}

export interface SamplyWebhook {
  id: string;
  label: string;
  url: string;
  events: string[];
  timeCreated?: number;
  timeModified?: number;
}

export interface CreateSamplyProjectInput {
  name: string;
  upload?: {
    enabled?: boolean;
    header?: string;
    greeting?: string;
    redirect?: string;
  };
  collaborators?: Array<{ email: string; role: "admin" | "editor" | "viewer" }>;
  sortBy?: {
    criterion: "custom" | "name" | "duration" | "size" | "bitDepth" | "sampleRate" | "bitRate" | "channels" | "lufs" | "timeModified" | "timeCreated" | "kind";
    ascending: boolean;
  };
}

export interface CreateSamplyPlayerInput {
  name: string;
  projectid?: string;
  folderid?: string;
  boxids?: string[];
  public?: boolean;
  upload?: {
    enabled?: boolean;
    header?: string;
    greeting?: string;
    redirect?: string;
  };
  options?: {
    quality?: "original" | "compressed" | "lossless";
    metadata?: boolean;
    isrc?: boolean;
    downloads?: boolean;
    comments?: boolean;
    loudnessMatch?: boolean;
    targetLufs?: number;
    loudnessPlatform?: "amazon-music" | "apple-music" | "deezer" | "spotify" | "tidal" | "youtube";
    studio?: boolean;
    stacks?: boolean;
    samplyCTA?: boolean;
    boxSubtitle?: "artist" | "timestamp" | "none";
  };
}

export interface RequestSamplyUploadUrlInput {
  name: string;
  mimeType: string;
  size: number | string;
  parentid?: string;
}

export interface SamplyUploadUrl {
  boxid: string;
  contentType: string;
  metadata: {
    boxpath: string;
    destination: string;
    projectid: string;
  };
  stackid?: string | null;
  url: string;
}

export interface CreateSamplyWebhookInput {
  label: string;
  url: string;
  events: string[];
}

export class SamplyApiError extends HttpError {
  constructor(
    message: string,
    status = 502,
    public readonly details?: string,
  ) {
    super(message, status);
    this.name = "SamplyApiError";
  }
}

export function getSamplyAvailability(orgId: string): SamplyAvailability {
  const token = process.env.SAMPLY_API_TOKEN?.trim();
  const configuredOrgId = normalizeOptionalEnv(process.env.SAMPLY_ORG_ID);
  const baseUrl = normalizeBaseUrl(process.env.SAMPLY_BASE_URL ?? DEFAULT_SAMPLY_BASE_URL);

  if (!token) {
    return { configured: false, reason: "missing_token", baseUrl, configuredOrgId };
  }

  if (configuredOrgId && configuredOrgId !== orgId) {
    return { configured: false, reason: "org_mismatch", baseUrl, configuredOrgId };
  }

  return { configured: true, reason: null, baseUrl, configuredOrgId };
}

export function getSamplyConfig(orgId: string): SamplyConfig {
  const availability = getSamplyAvailability(orgId);
  if (!availability.configured) {
    if (availability.reason === "org_mismatch") {
      throw new HttpError(`Samply is configured for org ${availability.configuredOrgId}, not ${orgId}`, 403);
    }
    throw new HttpError("SAMPLY_API_TOKEN is required", 503);
  }

  return {
    token: requireEnv("SAMPLY_API_TOKEN"),
    baseUrl: availability.baseUrl,
    configuredOrgId: availability.configuredOrgId,
  };
}

export function buildSamplyEmbedUrl(playerId: string, color?: string | null): string {
  const url = new URL(`${DEFAULT_SAMPLY_EMBED_BASE_URL}/${encodeURIComponent(playerId)}`);
  const normalizedColor = color?.replace(/^#/, "").trim();
  if (normalizedColor) {
    url.searchParams.set("color", normalizedColor);
  }
  return url.toString();
}

export async function listSamplyProjects(orgId: string): Promise<SamplyProjectSummary[]> {
  return samplyRequest<SamplyProjectSummary[]>(orgId, "/projects");
}

export async function getSamplyProject(
  orgId: string,
  projectId: string,
): Promise<SamplyProjectSummary> {
  return samplyRequest<SamplyProjectSummary>(orgId, `/projects/${encodeURIComponent(projectId)}`);
}

export function normalizeSamplyProjectId(input: string): string {
  const value = input.trim();
  if (!value) return "";

  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const projectMarkerIndex = parts.findIndex((part) => part === "p" || part === "projects");
    if (projectMarkerIndex >= 0 && parts[projectMarkerIndex + 1]) {
      return decodeURIComponent(parts[projectMarkerIndex + 1]).trim();
    }
    if (url.hostname.includes("samply") && parts[0]) {
      return decodeURIComponent(parts[0]).trim();
    }
  } catch {
    // Not a URL; treat the value as a raw project id below.
  }

  return value.split(/[?#]/, 1)[0]?.replace(/^\/+|\/+$/g, "").trim() ?? "";
}

export async function createSamplyProject(
  orgId: string,
  input: CreateSamplyProjectInput,
): Promise<SamplyProjectSummary> {
  return samplyRequest<SamplyProjectSummary>(orgId, "/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createSamplyPlayer(
  orgId: string,
  input: CreateSamplyPlayerInput,
): Promise<SamplyPlayerSummary> {
  return samplyRequest<SamplyPlayerSummary>(orgId, "/players", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listSamplyPlayers(orgId: string): Promise<SamplyPlayerSummary[]> {
  return samplyRequest<SamplyPlayerSummary[]>(orgId, "/players");
}

export async function listSamplyProjectFiles(
  orgId: string,
  projectId: string,
): Promise<SamplyBoxSummary[]> {
  return samplyRequest<SamplyBoxSummary[]>(orgId, `/projects/${encodeURIComponent(projectId)}/all`);
}

export async function getSamplyProjectFile(
  orgId: string,
  projectId: string,
  fileId: string,
): Promise<SamplyBoxSummary> {
  return samplyRequest<SamplyBoxSummary>(
    orgId,
    `/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`,
  );
}

export async function getSamplyDownloadUrl(
  orgId: string,
  projectId: string,
  fileId: string,
): Promise<SamplyDownloadUrl> {
  return samplyRequest<SamplyDownloadUrl>(
    orgId,
    `/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/download`,
  );
}

export async function requestSamplyUploadUrl(
  orgId: string,
  projectId: string,
  input: RequestSamplyUploadUrlInput,
): Promise<SamplyUploadUrl> {
  return samplyRequest<SamplyUploadUrl>(orgId, `/projects/${encodeURIComponent(projectId)}/files`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listSamplyComments(
  orgId: string,
  projectId: string,
  fileId: string,
): Promise<SamplyComment[]> {
  return samplyRequest<SamplyComment[]>(
    orgId,
    `/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/comments`,
  );
}

export async function createSamplyWebhook(
  orgId: string,
  input: CreateSamplyWebhookInput,
): Promise<SamplyWebhook> {
  return samplyRequest<SamplyWebhook>(orgId, "/webhooks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

async function samplyRequest<T>(
  orgId: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const config = getSamplyConfig(orgId);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${config.token}`);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new SamplyApiError(
      `Samply API request failed with ${response.status}`,
      response.status,
      details.slice(0, 400),
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeOptionalEnv(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
