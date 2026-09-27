import { createPrivateKey, createSign, type KeyObject } from "node:crypto";
import { PermanentSyncError, RetryableSyncError } from "./errors.js";
import type { GitHubIssueContext, GitHubIssueState, GitHubPullRequestContext } from "./types.js";

const API_BASE_URL = "https://api.github.com";
const JWT_LIFETIME_SECONDS = 10 * 60;
const JWT_BACKDATE_SECONDS = 60;
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 10 * 1_000;
const MAX_ISSUE_PAGES = 100;
const MAX_CLOSING_PULL_REQUEST_PAGES = 100;
const MAX_SAME_REPOSITORY_CLOSING_PULL_REQUESTS = 20;
const GRAPHQL_RATE_LIMIT_DISCRIMINATORS = new Set(["RATE_LIMITED"]);
const GRAPHQL_TRANSIENT_DISCRIMINATORS = new Set(["INTERNAL", "SERVICE_UNAVAILABLE", "TRANSIENT"]);

type GitHubRepository = "label-suite-org/label-suite_neon_r2";

export interface GitHubClientOptions {
  appId: string;
  installationId: string;
  privateKeyBase64: string;
  repository: GitHubRepository;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface CachedInstallationToken {
  token: string;
  expiresAtMs: number;
}

interface JsonHttpResponse {
  response: Response;
  body: unknown;
}

interface JsonRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(value: unknown, code: string): JsonRecord {
  if (!isRecord(value)) throw new PermanentSyncError(code);
  return value;
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value) throw new PermanentSyncError(code);
  return value;
}

function requiredPositiveNumber(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new PermanentSyncError(code);
  return value;
}

function requiredNonNegativeNumber(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new PermanentSyncError(code);
  return value;
}

function importPrivateKey(privateKeyBase64: string): KeyObject {
  let decoded: Buffer | null = null;
  try {
    if (typeof privateKeyBase64 !== "string" || !privateKeyBase64) throw new Error("private key is missing");
    decoded = Buffer.from(privateKeyBase64, "base64");
    if (decoded.byteLength === 0) throw new Error("private key is empty");
    return createPrivateKey(decoded);
  } catch {
    throw new PermanentSyncError("github_private_key_invalid");
  } finally {
    decoded?.fill(0);
  }
}

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function issueFromGraphQl(payload: unknown): GitHubIssueState {
  const data = requiredRecord(payload, "github_response_invalid");
  const repository = requiredRecord(data.data, "github_response_invalid");
  const issue = requiredRecord(requiredRecord(repository.repository, "github_response_invalid").issue, "github_issue_invalid");
  const labelNodes = requiredRecord(issue.labels, "github_issue_invalid").nodes;
  if (!Array.isArray(labelNodes)) throw new PermanentSyncError("github_issue_invalid");

  const state = requiredString(issue.state, "github_issue_invalid");
  if (state !== "OPEN" && state !== "CLOSED") throw new PermanentSyncError("github_issue_invalid");
  const stateReason = issue.stateReason;
  if (stateReason !== null && stateReason !== "COMPLETED" && stateReason !== "NOT_PLANNED" && stateReason !== "REOPENED") {
    throw new PermanentSyncError("github_issue_invalid");
  }

  return {
    number: requiredPositiveNumber(issue.number, "github_issue_invalid"),
    title: requiredString(issue.title, "github_issue_invalid"),
    state,
    stateReason,
    labels: labelNodes.map((label) => requiredString(requiredRecord(label, "github_issue_invalid").name, "github_issue_invalid")),
    url: requiredString(issue.url, "github_issue_invalid"),
    updatedAt: requiredString(issue.updatedAt, "github_issue_invalid"),
  };
}

interface ClosingPullRequestPage {
  issue: GitHubIssueState;
  totalCount: number;
  references: Array<{ state: "OPEN" | "CLOSED" | "MERGED"; repository: string }>;
  hasNextPage: boolean;
  endCursor: string | null;
}

function closingPullRequestPageFromGraphQl(payload: unknown): ClosingPullRequestPage {
  const data = requiredRecord(payload, "github_response_invalid");
  const repository = requiredRecord(data.data, "github_response_invalid");
  const issue = requiredRecord(requiredRecord(repository.repository, "github_response_invalid").issue, "github_issue_invalid");
  const connection = requiredRecord(issue.closedByPullRequestsReferences, "github_issue_invalid");
  const totalCount = requiredNonNegativeNumber(connection.totalCount, "github_issue_invalid");
  if (!Array.isArray(connection.nodes) || connection.nodes.length > 20 || connection.nodes.length > totalCount) {
    throw new PermanentSyncError("github_issue_invalid");
  }
  const references: ClosingPullRequestPage["references"] = connection.nodes.map((value) => {
    const reference = requiredRecord(value, "github_issue_invalid");
    const state = requiredString(reference.state, "github_issue_invalid");
    if (state !== "OPEN" && state !== "CLOSED" && state !== "MERGED") {
      throw new PermanentSyncError("github_issue_invalid");
    }
    const pullRequestRepository = requiredRecord(reference.repository, "github_issue_invalid");
    return {
      state,
      repository: requiredString(pullRequestRepository.nameWithOwner, "github_issue_invalid"),
    };
  });
  const pageInfo = requiredRecord(connection.pageInfo, "github_issue_invalid");
  const hasNextPage = requiredBoolean(pageInfo.hasNextPage, "github_issue_invalid");
  const endCursor = pageInfo.endCursor;
  if (endCursor !== null && (typeof endCursor !== "string" || !endCursor)) {
    throw new PermanentSyncError("github_issue_invalid");
  }
  if (hasNextPage && endCursor === null) throw new PermanentSyncError("github_issue_invalid");

  return { issue: issueFromGraphQl(payload), totalCount, references, hasNextPage, endCursor };
}

function requiredBoolean(value: unknown, code: string): boolean {
  if (typeof value !== "boolean") throw new PermanentSyncError(code);
  return value;
}

function pullRequestContextFromGraphQl(payload: unknown, repositoryName: GitHubRepository): GitHubPullRequestContext {
  const data = requiredRecord(payload, "github_response_invalid");
  const repository = requiredRecord(data.data, "github_response_invalid");
  const pullRequest = requiredRecord(
    requiredRecord(repository.repository, "github_response_invalid").pullRequest,
    "github_pull_request_invalid",
  );
  const rawState = requiredString(pullRequest.state, "github_pull_request_invalid");
  if (rawState !== "OPEN" && rawState !== "CLOSED" && rawState !== "MERGED") {
    throw new PermanentSyncError("github_pull_request_invalid");
  }
  const state = requiredBoolean(pullRequest.merged, "github_pull_request_invalid") ? "MERGED" : rawState;
  const closingReferences = requiredRecord(pullRequest.closingIssuesReferences, "github_pull_request_invalid");
  if (requiredNonNegativeNumber(closingReferences.totalCount, "github_pull_request_invalid") > 20) {
    throw new PermanentSyncError("github_closing_references_limit");
  }
  const references = closingReferences.nodes;
  if (!Array.isArray(references)) throw new PermanentSyncError("github_pull_request_invalid");

  return {
    pullRequest: {
      number: requiredPositiveNumber(pullRequest.number, "github_pull_request_invalid"),
      state,
      isDraft: requiredBoolean(pullRequest.isDraft, "github_pull_request_invalid"),
      url: requiredString(pullRequest.url, "github_pull_request_invalid"),
      updatedAt: requiredString(pullRequest.updatedAt, "github_pull_request_invalid"),
    },
    closingIssueNumbers: references.flatMap((reference) => {
      const item = requiredRecord(reference, "github_pull_request_invalid");
      const referenceRepository = requiredRecord(item.repository, "github_pull_request_invalid");
      return referenceRepository.nameWithOwner === repositoryName
        ? [requiredPositiveNumber(item.number, "github_pull_request_invalid")]
        : [];
    }),
  };
}

function issueFromRest(value: unknown): GitHubIssueState {
  const issue = requiredRecord(value, "github_issue_invalid");
  const state = requiredString(issue.state, "github_issue_invalid").toUpperCase();
  if (state !== "OPEN" && state !== "CLOSED") throw new PermanentSyncError("github_issue_invalid");
  const stateReasonValue = issue.state_reason;
  const stateReason = stateReasonValue === null ? null : requiredString(stateReasonValue, "github_issue_invalid").toUpperCase();
  if (stateReason !== null && stateReason !== "COMPLETED" && stateReason !== "NOT_PLANNED" && stateReason !== "REOPENED") {
    throw new PermanentSyncError("github_issue_invalid");
  }
  if (!Array.isArray(issue.labels)) throw new PermanentSyncError("github_issue_invalid");

  return {
    number: requiredPositiveNumber(issue.number, "github_issue_invalid"),
    title: requiredString(issue.title, "github_issue_invalid"),
    state,
    stateReason,
    labels: issue.labels.map((label) => requiredString(requiredRecord(label, "github_issue_invalid").name, "github_issue_invalid")),
    url: requiredString(issue.html_url, "github_issue_invalid"),
    updatedAt: requiredString(issue.updated_at, "github_issue_invalid"),
  };
}

function nextLink(response: Response): string | null {
  const links = response.headers.get("link");
  if (!links) return null;
  for (const item of links.split(",")) {
    if (!/;\s*rel="?next"?\s*$/i.test(item)) continue;
    const match = /<([^>]+)>/.exec(item);
    if (match?.[1]) return match[1];
  }
  return null;
}

function canonicalIssuesPageUrl(
  value: string,
  owner: string,
  repo: string,
  cursor: string | null,
  currentPage: number,
  seenPageUrls: ReadonlySet<string>,
): { url: string; page: number } {
  try {
    const url = new URL(value);
    if (url.origin !== API_BASE_URL || url.pathname !== `/repos/${owner}/${repo}/issues`) {
      throw new Error("unexpected pagination endpoint");
    }
    const cursors = url.searchParams.getAll("since");
    if (cursor === null ? cursors.length !== 0 : cursors.length !== 1 || cursors[0] !== cursor) {
      throw new Error("pagination cursor changed");
    }
    const states = url.searchParams.getAll("state");
    if (states.length !== 1 || states[0] !== "all") throw new Error("pagination state changed");
    const pageSizes = url.searchParams.getAll("per_page");
    if (pageSizes.length !== 1 || pageSizes[0] !== "100") throw new Error("pagination page size changed");
    const normalizedUrl = url.toString();
    if (seenPageUrls.has(normalizedUrl)) throw new PermanentSyncError("github_pagination_loop");
    const pages = url.searchParams.getAll("page");
    if (pages.length !== 1 || !/^[1-9][0-9]*$/.test(pages[0]!)) throw new Error("pagination page invalid");
    const page = Number(pages[0]);
    if (!Number.isSafeInteger(page) || page <= currentPage) throw new Error("pagination page did not advance");
    return { url: normalizedUrl, page };
  } catch (error) {
    if (error instanceof PermanentSyncError) throw error;
    throw new PermanentSyncError("github_pagination_link_invalid");
  }
}

function responseError(response: Response): PermanentSyncError | RetryableSyncError {
  if (response.status === 408) return new RetryableSyncError("github_request_timeout");
  if (
    response.status === 403 &&
    (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after"))
  ) {
    return new RetryableSyncError("github_rate_limited");
  }
  if (response.status === 429) return new RetryableSyncError("github_rate_limited");
  if (response.status >= 500) return new RetryableSyncError("github_service_unavailable");
  return new PermanentSyncError("github_request_rejected");
}

function graphQlErrorDiscriminators(error: unknown): string[] | null {
  if (!isRecord(error)) return null;
  const discriminators: string[] = [];
  if (typeof error.type === "string") discriminators.push(error.type);
  if (isRecord(error.extensions) && typeof error.extensions.code === "string") {
    discriminators.push(error.extensions.code);
  }
  return discriminators.length > 0 ? discriminators : null;
}

function graphQlError(errors: unknown[]): PermanentSyncError | RetryableSyncError {
  const discriminators = errors.map(graphQlErrorDiscriminators);
  const allowlisted = discriminators.every(
    (values) =>
      values !== null &&
      values.every(
        (value) => GRAPHQL_RATE_LIMIT_DISCRIMINATORS.has(value) || GRAPHQL_TRANSIENT_DISCRIMINATORS.has(value),
      ),
  );
  if (allowlisted) {
    const rateLimited = discriminators.every((values) =>
      values?.every((value) => GRAPHQL_RATE_LIMIT_DISCRIMINATORS.has(value)),
    );
    return new RetryableSyncError(rateLimited ? "github_rate_limited" : "github_service_unavailable");
  }
  return new PermanentSyncError("github_graphql_error");
}

export class GitHubClient {
  private readonly appId: string;
  private readonly installationId: string;
  private readonly repository: GitHubRepository;
  private readonly privateKey: KeyObject;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private installationToken: CachedInstallationToken | null = null;

  constructor(options: GitHubClientOptions) {
    this.appId = requiredString(options.appId, "github_app_id_invalid");
    this.installationId = requiredString(options.installationId, "github_installation_id_invalid");
    this.repository = options.repository;
    this.privateKey = importPrivateKey(options.privateKeyBase64);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async getIssue(number: number): Promise<GitHubIssueState> {
    if (!Number.isSafeInteger(number) || number <= 0) throw new PermanentSyncError("github_issue_number_invalid");
    const [owner, repo] = this.repository.split("/");
    const payload = await this.graphQl("Issue", `
      query Issue($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $number) {
            number title state stateReason url updatedAt
            labels(first: 100) { nodes { name } }
          }
        }
      }
    `, { owner, repo, number });
    return issueFromGraphQl(payload);
  }

  async getIssueSubjectKind(number: number): Promise<"issue" | "pull_request"> {
    if (!Number.isSafeInteger(number) || number <= 0) throw new PermanentSyncError("github_issue_number_invalid");
    const [owner, repo] = this.repository.split("/");
    const { body } = await this.authorizedJsonRequest(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`,
      (token) => ({
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
        },
      }),
    );
    const subject = requiredRecord(body, "github_issue_response_invalid");
    if (requiredPositiveNumber(subject.number, "github_issue_response_invalid") !== number) {
      throw new PermanentSyncError("github_issue_response_invalid");
    }
    if (!Object.hasOwn(subject, "pull_request")) return "issue";
    if (!isRecord(subject.pull_request)) throw new PermanentSyncError("github_issue_response_invalid");
    return "pull_request";
  }

  async getIssueContext(number: number): Promise<GitHubIssueContext> {
    if (!Number.isSafeInteger(number) || number <= 0) throw new PermanentSyncError("github_issue_number_invalid");
    const [owner, repo] = this.repository.split("/");
    const query = `
      query IssueContext($owner: String!, $repo: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $repo) {
          issue(number: $number) {
            number title state stateReason url updatedAt
            labels(first: 100) { nodes { name } }
            closedByPullRequestsReferences(first: 20, after: $after, includeClosedPrs: true) {
              totalCount
              pageInfo { hasNextPage endCursor }
              nodes { state repository { nameWithOwner } }
            }
          }
        }
      }
    `;
    const seenCursors = new Set<string>();
    let after: string | null = null;
    let expectedTotalCount: number | null = null;
    let traversedReferences = 0;
    let sameRepositoryReferences = 0;
    let issue: GitHubIssueState | null = null;
    let hasOpenLinkedPullRequest = false;

    for (let pageNumber = 0; pageNumber < MAX_CLOSING_PULL_REQUEST_PAGES; pageNumber += 1) {
      const payload = await this.graphQl("IssueContext", query, { owner, repo, number, after });
      const page = closingPullRequestPageFromGraphQl(payload);
      issue ??= page.issue;
      if (expectedTotalCount === null) expectedTotalCount = page.totalCount;
      if (page.totalCount !== expectedTotalCount) throw new PermanentSyncError("github_issue_invalid");

      traversedReferences += page.references.length;
      if (traversedReferences > expectedTotalCount) throw new PermanentSyncError("github_issue_invalid");
      for (const reference of page.references) {
        if (reference.repository !== this.repository) continue;
        sameRepositoryReferences += 1;
        if (sameRepositoryReferences > MAX_SAME_REPOSITORY_CLOSING_PULL_REQUESTS) {
          throw new PermanentSyncError("github_closing_references_limit");
        }
        if (reference.state === "OPEN") hasOpenLinkedPullRequest = true;
      }

      if (!page.hasNextPage) {
        if (traversedReferences !== expectedTotalCount) throw new PermanentSyncError("github_issue_invalid");
        return { issue, hasOpenLinkedPullRequest };
      }
      if (page.endCursor === null) throw new PermanentSyncError("github_issue_invalid");
      if (seenCursors.has(page.endCursor)) {
        throw new PermanentSyncError("github_closing_references_pagination_loop");
      }
      seenCursors.add(page.endCursor);
      after = page.endCursor;
    }

    throw new PermanentSyncError("github_closing_references_pagination_limit");
  }

  async getPullRequestContext(number: number): Promise<GitHubPullRequestContext> {
    if (!Number.isSafeInteger(number) || number <= 0) throw new PermanentSyncError("github_pull_request_number_invalid");
    const [owner, repo] = this.repository.split("/");
    const payload = await this.graphQl("PullRequestContext", `
      query PullRequestContext($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            number state isDraft merged mergedAt closedAt url updatedAt
            closingIssuesReferences(first: 20) {
              totalCount
              nodes { number url repository { nameWithOwner } }
            }
          }
        }
      }
    `, { owner, repo, number });
    return pullRequestContextFromGraphQl(payload, this.repository);
  }

  async listIssuesUpdatedSince(cursor: string | null): Promise<GitHubIssueState[]> {
    const [owner, repo] = this.repository.split("/");
    const initialUrl = new URL(`${API_BASE_URL}/repos/${owner}/${repo}/issues`);
    initialUrl.searchParams.set("state", "all");
    initialUrl.searchParams.set("per_page", "100");
    if (cursor) initialUrl.searchParams.set("since", cursor);
    initialUrl.searchParams.set("page", "1");

    const issues: GitHubIssueState[] = [];
    const seenPageUrls = new Set<string>();
    let pageUrl: string | null = initialUrl.toString();
    let pageNumber = 1;
    while (pageUrl) {
      if (seenPageUrls.has(pageUrl)) throw new PermanentSyncError("github_pagination_loop");
      if (seenPageUrls.size >= MAX_ISSUE_PAGES) throw new PermanentSyncError("github_pagination_limit");
      seenPageUrls.add(pageUrl);
      const result = await this.authorizedJsonRequest(pageUrl, (token) => ({
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
        },
      }));
      const { body, response } = result;
      if (!Array.isArray(body)) throw new PermanentSyncError("github_issues_response_invalid");
      issues.push(...body.filter((item) => !isRecord(item) || !Object.hasOwn(item, "pull_request")).map(issueFromRest));
      const nextPage = nextLink(response);
      if (nextPage) {
        const next = canonicalIssuesPageUrl(nextPage, owner, repo, cursor, pageNumber, seenPageUrls);
        pageUrl = next.url;
        pageNumber = next.page;
      } else {
        pageUrl = null;
      }
    }
    return issues;
  }

  private appJwt(): string {
    const nowSeconds = Math.floor(this.now().valueOf() / 1_000);
    const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
    const payload = base64UrlJson({
      iat: nowSeconds - JWT_BACKDATE_SECONDS,
      exp: nowSeconds + JWT_LIFETIME_SECONDS - JWT_BACKDATE_SECONDS,
      iss: this.appId,
    });
    const signingInput = `${header}.${payload}`;
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    return `${signingInput}.${signer.sign(this.privateKey).toString("base64url")}`;
  }

  private async graphQl(operationName: string, query: string, variables: JsonRecord): Promise<unknown> {
    const request = (token: string): RequestInit => ({
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ operationName, query, variables }),
    });
    const { body: payload } = await this.authorizedJsonRequest("/graphql", request);
    if (isRecord(payload) && Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw graphQlError(payload.errors);
    }
    return payload;
  }

  private async getInstallationToken(): Promise<string> {
    const nowMs = this.now().valueOf();
    if (this.installationToken && this.installationToken.expiresAtMs - TOKEN_REFRESH_BUFFER_MS > nowMs) {
      return this.installationToken.token;
    }

    const { body: tokenBody } = await this.jsonRequest(`/app/installations/${encodeURIComponent(this.installationId)}/access_tokens`, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.appJwt()}`,
        "x-github-api-version": "2022-11-28",
      },
    });
    const body = requiredRecord(tokenBody, "github_token_response_invalid");
    const expiresAt = Date.parse(requiredString(body.expires_at, "github_token_response_invalid"));
    if (!Number.isFinite(expiresAt)) throw new PermanentSyncError("github_token_response_invalid");
    const token = requiredString(body.token, "github_token_response_invalid");
    this.installationToken = { token, expiresAtMs: expiresAt };
    return token;
  }

  private async jsonRequest(path: string, init: RequestInit): Promise<JsonHttpResponse> {
    const result = await this.rawJsonRequest(path, init);
    if (!result.response.ok) throw responseError(result.response);
    return result;
  }

  private async authorizedJsonRequest(
    path: string,
    buildRequest: (token: string) => RequestInit,
  ): Promise<JsonHttpResponse> {
    let token = await this.getInstallationToken();
    let result = await this.rawJsonRequest(path, buildRequest(token));
    if (result.response.status === 401) {
      this.installationToken = null;
      token = await this.getInstallationToken();
      result = await this.rawJsonRequest(path, buildRequest(token));
    }
    if (!result.response.ok) throw responseError(result.response);
    return result;
  }

  private async rawJsonRequest(path: string, init: RequestInit): Promise<JsonHttpResponse> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), REQUEST_TIMEOUT_MS);
    const signal = init.signal ? AbortSignal.any([init.signal, deadline.signal]) : deadline.signal;
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(path.startsWith("https://") ? path : `${API_BASE_URL}${path}`, { ...init, signal });
      } catch {
        if (deadline.signal.aborted) throw new RetryableSyncError("github_request_timeout");
        throw new RetryableSyncError("github_request_failed");
      }

      if (!response.ok) {
        deadline.abort();
        return { response, body: null };
      }

      try {
        return { response, body: await response.json() };
      } catch {
        if (deadline.signal.aborted) throw new RetryableSyncError("github_request_timeout");
        throw new RetryableSyncError("github_response_invalid");
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
