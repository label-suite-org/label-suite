import { generateKeyPairSync, verify as verifySignature } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { PermanentSyncError, RetryableSyncError } from "./errors.js";
import { GitHubClient } from "./github.js";

const repository = "label-suite-org/label-suite_neon_r2" as const;
const fixturePath = fileURLToPath(new URL("../test/fixtures/github-issue.graphql.json", import.meta.url));
const issueFixture: unknown = JSON.parse(readFileSync(fixturePath, "utf8"));
const pullRequestFixturePath = fileURLToPath(new URL("../test/fixtures/github-pr.graphql.json", import.meta.url));
const pullRequestFixture: unknown = JSON.parse(readFileSync(pullRequestFixturePath, "utf8"));
const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });

interface FetchCall {
  url: string;
  init: RequestInit;
}

function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function scriptedFetch(handler: (call: FetchCall) => Promise<Response> | Response): {
  fetchImpl: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return handler(call);
  };
  return { fetchImpl, calls };
}

function decodeJsonSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<string, unknown>;
}

function githubClient(fetchImpl: typeof fetch, now: () => Date = () => new Date("2026-08-01T12:00:00Z")): GitHubClient {
  return new GitHubClient({
    appId: "12345",
    installationId: "67890",
    privateKeyBase64: Buffer.from(keyPair.privateKey.export({ format: "pem", type: "pkcs8" }) as string).toString("base64"),
    repository,
    fetchImpl,
    now,
  });
}

interface ClosingPullRequestNode {
  state: "OPEN" | "CLOSED" | "MERGED";
  repository: { nameWithOwner: string };
}

function issueContextFixture(
  nodes: unknown[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null } = { hasNextPage: false, endCursor: null },
  totalCount = nodes.length,
): unknown {
  const fixture = structuredClone(issueFixture) as {
    data: { repository: { issue: Record<string, unknown> } };
  };
  fixture.data.repository.issue.closedByPullRequestsReferences = { totalCount, pageInfo, nodes };
  return fixture;
}

function issueContextBoundary(pageForCursor: (cursor: string | null) => unknown): ReturnType<typeof scriptedFetch> {
  return scriptedFetch((call) => {
    if (call.url.endsWith("/access_tokens")) {
      return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
    }
    if (call.url === "https://api.github.com/graphql") {
      const request = JSON.parse(String(call.init.body)) as {
        operationName?: string;
        query?: string;
        variables?: { after?: string | null };
      };
      if (
        request.operationName !== "IssueContext" ||
        !request.query?.includes("closedByPullRequestsReferences(first: 20, after: $after, includeClosedPrs: true)") ||
        !request.query.includes("pageInfo { hasNextPage endCursor }") ||
        !request.query.includes("repository { nameWithOwner }")
      ) {
        return jsonResponse({ errors: [{ type: "VALIDATION" }] });
      }
      return jsonResponse(pageForCursor(request.variables?.after ?? null));
    }
    return jsonResponse({}, 404);
  });
}

function pullRequestGraphQl(state: string, merged: boolean): unknown {
  return {
    data: {
      repository: {
        pullRequest: {
          number: 129,
          state,
          isDraft: false,
          merged,
          mergedAt: merged ? "2026-08-01T12:25:00Z" : null,
          closedAt: state === "CLOSED" ? "2026-08-01T12:25:00Z" : null,
          url: "https://github.com/label-suite-org/label-suite_neon_r2/pull/129",
          updatedAt: "2026-08-01T12:25:00Z",
          closingIssuesReferences: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
        },
      },
    },
  };
}

describe("GitHubClient", () => {
  it("rejects malformed app-key configuration with a sanitized error", () => {
    const encodedPrivateKey = Buffer.from("private-key-material-must-never-appear-in-errors").toString("base64");
    let thrown: unknown;
    try {
      new GitHubClient({
        appId: "12345",
        installationId: "67890",
        privateKeyBase64: undefined as unknown as string,
        repository,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: "github_private_key_invalid" });
    expect(String(thrown)).not.toContain(encodedPrivateKey);
    expect(JSON.stringify(thrown)).not.toContain(encodedPrivateKey);
  });

  it("returns authoritative issue state after authenticating with a signed app JWT", async () => {
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url === "https://api.github.com/graphql") return jsonResponse(issueFixture);
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    const issue = await githubClient(boundary.fetchImpl).getIssue(128);

    expect(issue).toEqual({
      number: 128,
      title: "Synchronize authoritative GitHub delivery state",
      state: "OPEN",
      stateReason: null,
      labels: ["status:review", "priority:high"],
      url: "https://github.com/label-suite-org/label-suite_neon_r2/issues/128",
      updatedAt: "2026-08-01T12:15:00Z",
    });

    const installationRequest = boundary.calls.find((call) => call.url.endsWith("/access_tokens"));
    const graphQlRequest = boundary.calls.find((call) => call.url === "https://api.github.com/graphql");
    expect(installationRequest).toBeDefined();
    expect(graphQlRequest).toBeDefined();

    const jwt = new Headers(installationRequest?.init.headers).get("authorization")?.replace("Bearer ", "");
    expect(jwt).toBeDefined();
    const [header, payload, signature] = jwt!.split(".");
    expect(decodeJsonSegment(header)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decodeJsonSegment(payload)).toEqual({ iat: 1_785_585_540, exp: 1_785_586_140, iss: "12345" });
    expect(
      verifySignature("RSA-SHA256", Buffer.from(`${header}.${payload}`), keyPair.publicKey, Buffer.from(signature, "base64url")),
    ).toBe(true);

    expect(new Headers(graphQlRequest?.init.headers).get("authorization")).toBe("Bearer installation-token");
    expect(JSON.parse(String(graphQlRequest?.init.body))).toMatchObject({
      operationName: "Issue",
      variables: { owner: "label-suite-org", repo: "label-suite_neon_r2", number: 128 },
    });
  });

  it("distinguishes a pull request returned by GitHub's issues endpoint", async () => {
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url === "https://api.github.com/repos/label-suite-org/label-suite_neon_r2/issues/195") {
        return jsonResponse({
          number: 195,
          pull_request: {
            url: "https://api.github.com/repos/label-suite-org/label-suite_neon_r2/pulls/195",
          },
        });
      }
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    await expect(githubClient(boundary.fetchImpl).getIssueSubjectKind(195)).resolves.toBe("pull_request");
    expect(boundary.calls.some((call) => call.url === "https://api.github.com/graphql")).toBe(false);
  });

  it("ignores open foreign and differently cased pull requests while accepting a closed same-repository reference", async () => {
    const nodes: ClosingPullRequestNode[] = [
      { state: "OPEN", repository: { nameWithOwner: "another-org/another-repo" } },
      { state: "OPEN", repository: { nameWithOwner: "Label-Suite-Org/label-suite_neon_r2" } },
      { state: "CLOSED", repository: { nameWithOwner: repository } },
    ];
    const boundary = issueContextBoundary(() => issueContextFixture(nodes));

    await expect(githubClient(boundary.fetchImpl).getIssueContext(128)).resolves.toEqual({
      issue: {
        number: 128,
        title: "Synchronize authoritative GitHub delivery state",
        state: "OPEN",
        stateReason: null,
        labels: ["status:review", "priority:high"],
        url: "https://github.com/label-suite-org/label-suite_neon_r2/issues/128",
        updatedAt: "2026-08-01T12:15:00Z",
      },
      hasOpenLinkedPullRequest: false,
    });
  });

  it("returns true when foreign references are followed by an open pull request from the exact repository", async () => {
    const nodes: ClosingPullRequestNode[] = [
      { state: "OPEN", repository: { nameWithOwner: "another-org/another-repo" } },
      { state: "OPEN", repository: { nameWithOwner: repository } },
    ];
    const boundary = issueContextBoundary(() => issueContextFixture(nodes));

    await expect(githubClient(boundary.fetchImpl).getIssueContext(128)).resolves.toMatchObject({
      hasOpenLinkedPullRequest: true,
    });
  });

  it("finds an exact-repository open pull request after a page containing only foreign references", async () => {
    const foreignNodes: ClosingPullRequestNode[] = Array.from({ length: 20 }, (_, index) => ({
      state: "OPEN",
      repository: { nameWithOwner: `foreign-org/repo-${index}` },
    }));
    const boundary = issueContextBoundary((cursor) =>
      cursor === null
        ? issueContextFixture(foreignNodes, { hasNextPage: true, endCursor: "linked-pr-page-2" }, 21)
        : issueContextFixture(
            [{ state: "OPEN", repository: { nameWithOwner: repository } }],
            { hasNextPage: false, endCursor: "linked-pr-page-2" },
            21,
          ),
    );

    await expect(githubClient(boundary.fetchImpl).getIssueContext(128)).resolves.toMatchObject({
      hasOpenLinkedPullRequest: true,
    });
    expect(
      boundary.calls
        .filter((call) => call.url === "https://api.github.com/graphql")
        .map((call) => (JSON.parse(String(call.init.body)) as { variables: { after: string | null } }).variables.after),
    ).toEqual([null, "linked-pr-page-2"]);
  });

  it("fails closed when linked pull-request pagination repeats a cursor", async () => {
    const boundary = issueContextBoundary(() =>
      issueContextFixture([], { hasNextPage: true, endCursor: "repeated-cursor" }, 1),
    );

    await expect(githubClient(boundary.fetchImpl).getIssueContext(128)).rejects.toMatchObject({
      code: "github_closing_references_pagination_loop",
    });
  });

  it("fails closed when a linked pull-request page has malformed repository data", async () => {
    const boundary = issueContextBoundary(() =>
      issueContextFixture([{ state: "OPEN", repository: {} }]),
    );

    await expect(githubClient(boundary.fetchImpl).getIssueContext(128)).rejects.toMatchObject({
      code: "github_issue_invalid",
    });
  });

  it("fails closed when more than twenty exact-repository closing references are encountered", async () => {
    const exactNodes: ClosingPullRequestNode[] = Array.from({ length: 20 }, () => ({
      state: "CLOSED",
      repository: { nameWithOwner: repository },
    }));
    const boundary = issueContextBoundary((cursor) =>
      cursor === null
        ? issueContextFixture(exactNodes, { hasNextPage: true, endCursor: "linked-pr-page-2" }, 21)
        : issueContextFixture(
            [{ state: "CLOSED", repository: { nameWithOwner: repository } }],
            { hasNextPage: false, endCursor: "linked-pr-page-2" },
            21,
          ),
    );

    await expect(githubClient(boundary.fetchImpl).getIssueContext(128)).rejects.toMatchObject({
      code: "github_closing_references_limit",
    });
  });

  it("fails closed before linked pull-request pagination can exceed its hard page cap", async () => {
    const boundary = issueContextBoundary((cursor) => {
      const page = cursor === null ? 1 : Number(cursor.replace("page-", ""));
      return issueContextFixture([], { hasNextPage: true, endCursor: `page-${page + 1}` }, 1);
    });

    await expect(githubClient(boundary.fetchImpl).getIssueContext(128)).rejects.toMatchObject({
      code: "github_closing_references_pagination_limit",
    });
    expect(boundary.calls.filter((call) => call.url === "https://api.github.com/graphql")).toHaveLength(100);
  });

  it("reuses a still-valid installation credential for authoritative issue reads", async () => {
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "reusable-installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url === "https://api.github.com/graphql") return jsonResponse(issueFixture);
      return jsonResponse({ message: "unexpected request" }, 404);
    });
    const client = githubClient(boundary.fetchImpl);

    const firstIssue = await client.getIssue(128);
    const secondIssue = await client.getIssue(128);

    expect([firstIssue.number, secondIssue.number]).toEqual([128, 128]);
    expect(
      boundary.calls
        .filter((call) => call.url === "https://api.github.com/graphql")
        .map((call) => new Headers(call.init.headers).get("authorization")),
    ).toEqual(["Bearer reusable-installation-token", "Bearer reusable-installation-token"]);
    expect(boundary.calls.filter((call) => call.url.endsWith("/access_tokens"))).toHaveLength(1);
  });

  it("refreshes the installation credential five minutes before it expires", async () => {
    let tokenRequest = 0;
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        tokenRequest += 1;
        return jsonResponse(
          tokenRequest === 1
            ? { token: "expiring-installation-token", expires_at: "2026-08-01T12:06:00Z" }
            : { token: "refreshed-installation-token", expires_at: "2026-08-01T12:31:00Z" },
        );
      }
      if (call.url === "https://api.github.com/graphql") return jsonResponse(issueFixture);
      return jsonResponse({ message: "unexpected request" }, 404);
    });
    let currentTime = new Date("2026-08-01T12:00:00Z");
    const client = githubClient(boundary.fetchImpl, () => currentTime);

    const firstIssue = await client.getIssue(128);
    currentTime = new Date("2026-08-01T12:01:00Z");
    const secondIssue = await client.getIssue(128);

    expect([firstIssue.updatedAt, secondIssue.updatedAt]).toEqual(["2026-08-01T12:15:00Z", "2026-08-01T12:15:00Z"]);
    expect(
      boundary.calls
        .filter((call) => call.url === "https://api.github.com/graphql")
        .map((call) => new Headers(call.init.headers).get("authorization")),
    ).toEqual(["Bearer expiring-installation-token", "Bearer refreshed-installation-token"]);
    expect(tokenRequest).toBe(2);
  });

  it("returns only same-repository closing issues for an authoritative pull request", async () => {
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url === "https://api.github.com/graphql") return jsonResponse(pullRequestFixture);
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    const context = await githubClient(boundary.fetchImpl).getPullRequestContext(129);

    expect(context).toEqual({
      pullRequest: {
        number: 129,
        state: "MERGED",
        isDraft: false,
        url: "https://github.com/label-suite-org/label-suite_neon_r2/pull/129",
        updatedAt: "2026-08-01T12:25:00Z",
      },
      closingIssueNumbers: [128],
    });
    const request = boundary.calls.find((call) => call.url === "https://api.github.com/graphql");
    const body = JSON.parse(String(request?.init.body)) as { operationName: string; query: string; variables: unknown };
    expect(body.operationName).toBe("PullRequestContext");
    expect(body.variables).toEqual({ owner: "label-suite-org", repo: "label-suite_neon_r2", number: 129 });
    expect(body.query).toContain("closingIssuesReferences(first: 20)");
  });

  it("fails closed when GitHub reports more than twenty closing issue references", async () => {
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url === "https://api.github.com/graphql") {
        return jsonResponse({
          data: {
            repository: {
              pullRequest: {
                number: 129,
                state: "OPEN",
                isDraft: false,
                merged: false,
                mergedAt: null,
                closedAt: null,
                url: "https://github.com/label-suite-org/label-suite_neon_r2/pull/129",
                updatedAt: "2026-08-01T12:20:00Z",
                closingIssuesReferences: {
                  totalCount: 21,
                  pageInfo: { hasNextPage: true },
                  nodes: [],
                },
              },
            },
          },
        });
      }
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    await expect(githubClient(boundary.fetchImpl).getPullRequestContext(129)).rejects.toMatchObject({
      code: "github_closing_references_limit",
    });
  });

  it.each([
    ["OPEN", false],
    ["CLOSED", false],
  ] as const)("preserves the authoritative %s pull-request state", async (state, merged) => {
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url === "https://api.github.com/graphql") return jsonResponse(pullRequestGraphQl(state, merged));
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    const context = await githubClient(boundary.fetchImpl).getPullRequestContext(129);

    expect(context.pullRequest.state).toBe(state);
    expect(context.closingIssueNumbers).toEqual([]);
  });

  it("rejects an unknown pull-request state instead of projecting it", async () => {
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url === "https://api.github.com/graphql") return jsonResponse(pullRequestGraphQl("UNKNOWN", false));
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    await expect(githubClient(boundary.fetchImpl).getPullRequestContext(129)).rejects.toMatchObject({
      code: "github_pull_request_invalid",
    });
  });

  it("lists all issues updated after the cursor while excluding pull requests", async () => {
    const secondPage = "https://api.github.com/repos/label-suite-org/label-suite_neon_r2/issues?state=all&per_page=100&since=2026-08-01T12%3A00%3A00.000Z&page=2";
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url.includes("/repos/label-suite-org/label-suite_neon_r2/issues")) {
        const page = new URL(call.url).searchParams.get("page");
        if (page === "2") {
          return jsonResponse([
            {
              number: 130,
              title: "Second updated issue",
              state: "closed",
              state_reason: "completed",
              labels: [{ name: "priority:medium" }],
              html_url: "https://github.com/label-suite-org/label-suite_neon_r2/issues/130",
              updated_at: "2026-08-01T12:20:00Z",
            },
          ]);
        }
        return jsonResponse(
          [
            {
              number: 128,
              title: "First updated issue",
              state: "open",
              state_reason: null,
              labels: [{ name: "status:todo" }],
              html_url: "https://github.com/label-suite-org/label-suite_neon_r2/issues/128",
              updated_at: "2026-08-01T12:10:00Z",
            },
            {
              number: 129,
              title: "A pull request returned by GitHub's issues endpoint",
              state: "open",
              state_reason: null,
              labels: [],
              html_url: "https://github.com/label-suite-org/label-suite_neon_r2/pull/129",
              updated_at: "2026-08-01T12:15:00Z",
              pull_request: { url: "https://api.github.com/repos/label-suite-org/label-suite_neon_r2/pulls/129" },
            },
          ],
          200,
          { link: `<${secondPage}>; rel="next"` },
        );
      }
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    const issues = await githubClient(boundary.fetchImpl).listIssuesUpdatedSince("2026-08-01T12:00:00.000Z");

    expect(issues).toEqual([
      {
        number: 128,
        title: "First updated issue",
        state: "OPEN",
        stateReason: null,
        labels: ["status:todo"],
        url: "https://github.com/label-suite-org/label-suite_neon_r2/issues/128",
        updatedAt: "2026-08-01T12:10:00Z",
      },
      {
        number: 130,
        title: "Second updated issue",
        state: "CLOSED",
        stateReason: "COMPLETED",
        labels: ["priority:medium"],
        url: "https://github.com/label-suite-org/label-suite_neon_r2/issues/130",
        updatedAt: "2026-08-01T12:20:00Z",
      },
    ]);
    const listRequests = boundary.calls.filter((call) => call.url.includes("/repos/label-suite-org/label-suite_neon_r2/issues"));
    expect(listRequests).toHaveLength(2);
    expect(new URL(listRequests[0]!.url).searchParams.get("since")).toBe("2026-08-01T12:00:00.000Z");
    expect(listRequests[1]!.url).toBe(secondPage);
  });

  it("refuses a pagination link outside the canonical GitHub issues endpoint", async () => {
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url.includes("/repos/label-suite-org/label-suite_neon_r2/issues")) {
        return jsonResponse([], 200, { link: '<https://unexpected.example.test/issues?page=2>; rel="next"' });
      }
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    await expect(githubClient(boundary.fetchImpl).listIssuesUpdatedSince(null)).rejects.toMatchObject({
      code: "github_pagination_link_invalid",
    });
    expect(boundary.calls.some((call) => call.url.includes("unexpected.example.test"))).toBe(false);
  });

  it.each([
    [
      "drops",
      "https://api.github.com/repos/label-suite-org/label-suite_neon_r2/issues?state=all&per_page=100&page=2",
    ],
    [
      "changes",
      "https://api.github.com/repos/label-suite-org/label-suite_neon_r2/issues?state=all&per_page=100&since=2026-08-01T12%3A01%3A00.000Z&page=2",
    ],
  ])("refuses a pagination link that %s the reconciliation cursor", async (_variant, invalidCursorLink) => {
    let listRequest = 0;
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url.includes("/repos/label-suite-org/label-suite_neon_r2/issues")) {
        listRequest += 1;
        return jsonResponse([], 200, listRequest === 1 ? { link: `<${invalidCursorLink}>; rel="next"` } : undefined);
      }
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    await expect(
      githubClient(boundary.fetchImpl).listIssuesUpdatedSince("2026-08-01T12:00:00.000Z"),
    ).rejects.toMatchObject({ code: "github_pagination_link_invalid" });
    expect(listRequest).toBe(1);
  });

  it("refuses a pagination link that changes the immutable state filter", async () => {
    let listRequest = 0;
    const changedState =
      "https://api.github.com/repos/label-suite-org/label-suite_neon_r2/issues?state=open&per_page=100&since=2026-08-01T12%3A00%3A00.000Z&page=2";
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url.includes("/repos/label-suite-org/label-suite_neon_r2/issues")) {
        listRequest += 1;
        return jsonResponse([], 200, listRequest === 1 ? { link: `<${changedState}>; rel="next"` } : undefined);
      }
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    await expect(
      githubClient(boundary.fetchImpl).listIssuesUpdatedSince("2026-08-01T12:00:00.000Z"),
    ).rejects.toMatchObject({ code: "github_pagination_link_invalid" });
    expect(listRequest).toBe(1);
  });

  it("refuses a pagination link that changes the immutable page size", async () => {
    let listRequest = 0;
    const changedPageSize =
      "https://api.github.com/repos/label-suite-org/label-suite_neon_r2/issues?state=all&per_page=50&since=2026-08-01T12%3A00%3A00.000Z&page=2";
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url.includes("/repos/label-suite-org/label-suite_neon_r2/issues")) {
        listRequest += 1;
        return jsonResponse([], 200, listRequest === 1 ? { link: `<${changedPageSize}>; rel="next"` } : undefined);
      }
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    await expect(
      githubClient(boundary.fetchImpl).listIssuesUpdatedSince("2026-08-01T12:00:00.000Z"),
    ).rejects.toMatchObject({ code: "github_pagination_link_invalid" });
    expect(listRequest).toBe(1);
  });

  it.each([
    ["does not move forward", "0"],
    ["is not numeric", "two"],
  ])("refuses a pagination link whose page number %s", async (_variant, page) => {
    let listRequest = 0;
    const invalidPage = `https://api.github.com/repos/label-suite-org/label-suite_neon_r2/issues?state=all&per_page=100&since=2026-08-01T12%3A00%3A00.000Z&page=${page}`;
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url.includes("/repos/label-suite-org/label-suite_neon_r2/issues")) {
        listRequest += 1;
        return jsonResponse([], 200, listRequest === 1 ? { link: `<${invalidPage}>; rel="next"` } : undefined);
      }
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    await expect(
      githubClient(boundary.fetchImpl).listIssuesUpdatedSince("2026-08-01T12:00:00.000Z"),
    ).rejects.toMatchObject({ code: "github_pagination_link_invalid" });
    expect(listRequest).toBe(1);
  });

  it("fails closed instead of re-reading a repeated reconciliation page", async () => {
    let listRequest = 0;
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url.includes("/repos/label-suite-org/label-suite_neon_r2/issues")) {
        listRequest += 1;
        return jsonResponse([], 200, listRequest === 1 ? { link: `<${call.url}>; rel="next"` } : undefined);
      }
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    await expect(githubClient(boundary.fetchImpl).listIssuesUpdatedSince(null)).rejects.toMatchObject({
      code: "github_pagination_loop",
    });
    expect(listRequest).toBe(1);
  });

  it("stops a unique-link reconciliation chain at one hundred pages", async () => {
    let listRequest = 0;
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url.includes("/repos/label-suite-org/label-suite_neon_r2/issues")) {
        listRequest += 1;
        const current = new URL(call.url);
        const page = Number(current.searchParams.get("page"));
        if (page >= 101) return jsonResponse([]);
        current.searchParams.set("page", String(page + 1));
        return jsonResponse([], 200, { link: `<${current.toString()}>; rel="next"` });
      }
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    await expect(
      githubClient(boundary.fetchImpl).listIssuesUpdatedSince("2026-08-01T12:00:00.000Z"),
    ).rejects.toMatchObject({ code: "github_pagination_limit" });
    expect(listRequest).toBe(100);
  });

  it("refreshes once on an unauthorized REST reconciliation read", async () => {
    let tokenRequest = 0;
    let listRequest = 0;
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        tokenRequest += 1;
        return jsonResponse({
          token: tokenRequest === 1 ? "expired-installation-token" : "replacement-installation-token",
          expires_at: "2026-08-01T12:30:00Z",
        });
      }
      if (call.url.includes("/repos/label-suite-org/label-suite_neon_r2/issues")) {
        listRequest += 1;
        return listRequest === 1
          ? jsonResponse({ message: "installation token expired" }, 401)
          : jsonResponse([
              {
                number: 128,
                title: "Recovered authoritative issue",
                state: "open",
                state_reason: null,
                labels: [],
                html_url: "https://github.com/label-suite-org/label-suite_neon_r2/issues/128",
                updated_at: "2026-08-01T12:10:00Z",
              },
            ]);
      }
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    const issues = await githubClient(boundary.fetchImpl).listIssuesUpdatedSince(null);

    expect(issues.map((issue) => issue.number)).toEqual([128]);
    expect(
      boundary.calls
        .filter((call) => call.url.includes("/repos/label-suite-org/label-suite_neon_r2/issues"))
        .map((call) => new Headers(call.init.headers).get("authorization")),
    ).toEqual(["Bearer expired-installation-token", "Bearer replacement-installation-token"]);
    expect(tokenRequest).toBe(2);
  });

  it("refreshes the installation credential once after an unauthorized authoritative read", async () => {
    let tokenRequest = 0;
    let graphQlRequest = 0;
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        tokenRequest += 1;
        return jsonResponse({
          token: tokenRequest === 1 ? "expired-installation-token" : "replacement-installation-token",
          expires_at: "2026-08-01T12:30:00Z",
        });
      }
      if (call.url === "https://api.github.com/graphql") {
        graphQlRequest += 1;
        return graphQlRequest === 1
          ? jsonResponse({ message: "installation token expired" }, 401)
          : jsonResponse(issueFixture);
      }
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    const issue = await githubClient(boundary.fetchImpl).getIssue(128);

    expect(issue.number).toBe(128);
    expect(
      boundary.calls
        .filter((call) => call.url === "https://api.github.com/graphql")
        .map((call) => new Headers(call.init.headers).get("authorization")),
    ).toEqual(["Bearer expired-installation-token", "Bearer replacement-installation-token"]);
    expect(tokenRequest).toBe(2);
    expect(graphQlRequest).toBe(2);
  });

  it("aborts a stalled GitHub request and returns a retryable timeout error", async () => {
    vi.useFakeTimers();
    try {
      const boundary = scriptedFetch((call) => {
        if (call.url.endsWith("/access_tokens")) {
          return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
        }
        if (call.url === "https://api.github.com/graphql") {
          return new Promise<Response>((_resolve, reject) => {
            call.init.signal?.addEventListener("abort", () => reject(new DOMException("request aborted", "AbortError")), {
              once: true,
            });
          });
        }
        return jsonResponse({ message: "unexpected request" }, 404);
      });

      const result = githubClient(boundary.fetchImpl).getIssue(128);
      const timeoutAssertion = expect(result).rejects.toMatchObject({ code: "github_request_timeout" });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(10_000);

      await timeoutAssertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the request deadline active until the JSON response body is consumed", async () => {
    vi.useFakeTimers();
    const responseBody = { controller: null as ReadableStreamDefaultController<Uint8Array> | null };
    let bodyAborted = false;
    let completion: Promise<void> | null = null;
    try {
      const boundary = scriptedFetch((call) => {
        if (call.url.endsWith("/access_tokens")) {
          return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
        }
        if (call.url === "https://api.github.com/graphql") {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              responseBody.controller = controller;
              call.init.signal?.addEventListener(
                "abort",
                () => {
                  bodyAborted = true;
                  controller.error(new DOMException("response body aborted", "AbortError"));
                },
                { once: true },
              );
            },
          });
          return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
        }
        return jsonResponse({ message: "unexpected request" }, 404);
      });
      let outcome: unknown;
      completion = githubClient(boundary.fetchImpl).getIssue(128).then(
        (value) => {
          outcome = value;
        },
        (error: unknown) => {
          outcome = error;
        },
      );

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(9_999);
      expect(outcome).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);

      expect(outcome).toMatchObject({ code: "github_request_timeout" });
      expect(bodyAborted).toBe(true);
      await completion;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      if (!bodyAborted && responseBody.controller !== null) responseBody.controller.error(new Error("test response cleanup"));
      await completion;
      vi.useRealTimers();
    }
  });

  it("classifies an exhausted GitHub rate limit as retryable without exposing the response body", async () => {
    const responseOnlySecret = "do-not-copy-this-response-body";
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url === "https://api.github.com/graphql") {
        return jsonResponse(
          { message: responseOnlySecret, documentation_url: "https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api" },
          403,
          { "x-ratelimit-remaining": "0" },
        );
      }
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    const error = await githubClient(boundary.fetchImpl).getIssue(128).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: "github_rate_limited" });
    expect(String(error)).not.toContain(responseOnlySecret);
    expect(JSON.stringify(error)).not.toContain(responseOnlySecret);
  });

  it("classifies an HTTP 408 response as a sanitized retryable timeout", async () => {
    const responseOnlySecret = "do-not-copy-this-408-response";
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url === "https://api.github.com/graphql") {
        return jsonResponse({ message: responseOnlySecret }, 408);
      }
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    const error = await githubClient(boundary.fetchImpl).getIssue(128).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RetryableSyncError);
    expect(error).toMatchObject({ code: "github_request_timeout" });
    expect(String(error)).not.toContain(responseOnlySecret);
    expect(JSON.stringify(error)).not.toContain(responseOnlySecret);
  });

  it("classifies a GitHub service failure as retryable without exposing the response body", async () => {
    const responseOnlySecret = "do-not-copy-this-service-error";
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url === "https://api.github.com/graphql") return jsonResponse({ message: responseOnlySecret }, 503);
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    const error = await githubClient(boundary.fetchImpl).getIssue(128).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: "github_service_unavailable" });
    expect(String(error)).not.toContain(responseOnlySecret);
    expect(JSON.stringify(error)).not.toContain(responseOnlySecret);
  });

  it("classifies an allowlisted HTTP-200 GraphQL rate-limit error as retryable", async () => {
    const responseOnlySecret = "do-not-expose-graphql-rate-limit-text";
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url === "https://api.github.com/graphql") {
        return jsonResponse({
          data: null,
          errors: [{ type: "RATE_LIMITED", message: responseOnlySecret, extensions: { code: "RATE_LIMITED" } }],
        });
      }
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    const error = await githubClient(boundary.fetchImpl).getIssue(128).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RetryableSyncError);
    expect(error).toMatchObject({ code: "github_rate_limited" });
    expect(String(error)).not.toContain(responseOnlySecret);
    expect(JSON.stringify(error)).not.toContain(responseOnlySecret);
  });

  it("classifies an allowlisted HTTP-200 GraphQL internal error type as retryable", async () => {
    const responseOnlySecret = "do-not-expose-graphql-internal-text";
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url === "https://api.github.com/graphql") {
        return jsonResponse({ data: null, errors: [{ type: "INTERNAL", message: responseOnlySecret }] });
      }
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    const error = await githubClient(boundary.fetchImpl).getIssue(128).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RetryableSyncError);
    expect(error).toMatchObject({ code: "github_service_unavailable" });
    expect(String(error)).not.toContain(responseOnlySecret);
    expect(JSON.stringify(error)).not.toContain(responseOnlySecret);
  });

  it("classifies an allowlisted HTTP-200 GraphQL service error code as retryable", async () => {
    const responseOnlySecret = "do-not-expose-graphql-service-text";
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url === "https://api.github.com/graphql") {
        return jsonResponse({
          data: null,
          errors: [{ message: responseOnlySecret, extensions: { code: "SERVICE_UNAVAILABLE" } }],
        });
      }
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    const error = await githubClient(boundary.fetchImpl).getIssue(128).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RetryableSyncError);
    expect(error).toMatchObject({ code: "github_service_unavailable" });
    expect(String(error)).not.toContain(responseOnlySecret);
    expect(JSON.stringify(error)).not.toContain(responseOnlySecret);
  });

  it("classifies an allowlisted HTTP-200 GraphQL transient error type as retryable", async () => {
    const responseOnlySecret = "do-not-expose-graphql-transient-text";
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url === "https://api.github.com/graphql") {
        return jsonResponse({ data: null, errors: [{ type: "TRANSIENT", message: responseOnlySecret }] });
      }
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    const error = await githubClient(boundary.fetchImpl).getIssue(128).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RetryableSyncError);
    expect(error).toMatchObject({ code: "github_service_unavailable" });
    expect(String(error)).not.toContain(responseOnlySecret);
    expect(JSON.stringify(error)).not.toContain(responseOnlySecret);
  });

  it("surfaces GraphQL failures as a sanitized error code instead of parsing partial state", async () => {
    const responseOnlySecret = "do-not-expose-graphql-error-text";
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url === "https://api.github.com/graphql") {
        return jsonResponse({
          data: { repository: null },
          errors: [{ message: responseOnlySecret, path: ["repository", "issue"] }],
        });
      }
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    const error = await githubClient(boundary.fetchImpl).getIssue(128).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(PermanentSyncError);
    expect(error).toMatchObject({ code: "github_graphql_error" });
    expect(String(error)).not.toContain(responseOnlySecret);
    expect(JSON.stringify(error)).not.toContain(responseOnlySecret);
  });

  it("keeps a non-allowlisted GraphQL error permanent regardless of its message", async () => {
    const responseOnlySecret = "RATE_LIMITED INTERNAL SERVICE_UNAVAILABLE must not influence classification";
    const boundary = scriptedFetch((call) => {
      if (call.url.endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token", expires_at: "2026-08-01T12:30:00Z" });
      }
      if (call.url === "https://api.github.com/graphql") {
        return jsonResponse({
          data: null,
          errors: [{ type: "FORBIDDEN", message: responseOnlySecret, extensions: { code: "FORBIDDEN" } }],
        });
      }
      return jsonResponse({ message: "unexpected request" }, 404);
    });

    const error = await githubClient(boundary.fetchImpl).getIssue(128).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(PermanentSyncError);
    expect(error).toMatchObject({ code: "github_graphql_error" });
    expect(String(error)).not.toContain(responseOnlySecret);
    expect(JSON.stringify(error)).not.toContain(responseOnlySecret);
  });
});
