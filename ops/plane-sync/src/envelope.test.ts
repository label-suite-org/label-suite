import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PermanentSyncError } from "./errors.js";
import { compactDelivery } from "./envelope.js";

const repository = "label-suite-org/label-suite_neon_r2";
const issueFixture: Record<string, unknown> = JSON.parse(
  readFileSync(new URL("../test/fixtures/issues-opened.json", import.meta.url), "utf8"),
);
const pullRequestReviewFixture: Record<string, unknown> = JSON.parse(
  readFileSync(new URL("../test/fixtures/pull-request-review.json", import.meta.url), "utf8"),
);

const validHeaders = (event: string): Record<string, string> => ({
  "x-github-delivery": "b00c6c06-8888-4b6a-b3f9-911605477e51",
  "x-github-event": event,
});

const body = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));

describe("compactDelivery", () => {
  it("returns only the routing fields for an opened issue", () => {
    expect(compactDelivery(validHeaders("issues"), body(issueFixture), 1_048_576)).toEqual({
      deliveryId: "b00c6c06-8888-4b6a-b3f9-911605477e51",
      event: "issues",
      action: "opened",
      repository,
      subjectKind: "issue",
      subjectNumber: 128,
      actorLogin: "nature-boy",
      occurredAt: "2026-08-01T19:20:30Z",
    });
  });

  it("discards comment and issue bodies before returning the envelope", () => {
    const commentFixture = {
      ...issueFixture,
      action: "created",
      comment: {
        body: "A private comment must not leave the request boundary.",
        updated_at: "2026-08-01T19:20:31Z",
      },
    };
    const delivery = compactDelivery(validHeaders("issue_comment"), body(commentFixture), 1_048_576);

    expect(JSON.stringify(delivery)).not.toContain(commentFixture.comment.body);
    expect(JSON.stringify(delivery)).not.toContain((issueFixture.issue as { body: string }).body);
  });

  it("ignores pull request conversation comments before they enter issue projection", () => {
    const pullRequestComment = {
      ...issueFixture,
      action: "created",
      issue: {
        ...(issueFixture.issue as Record<string, unknown>),
        number: 195,
        pull_request: {
          url: "https://api.github.com/repos/label-suite-org/label-suite_neon_r2/pulls/195",
        },
      },
      comment: {
        body: "A pull request conversation comment must not enter issue projection.",
        updated_at: "2026-08-12T14:59:50Z",
      },
    };

    expect(compactDelivery(validHeaders("issue_comment"), body(pullRequestComment), 1_048_576)).toBeNull();
  });

  it("discards review bodies, installation tokens, and sender profiles", () => {
    const delivery = compactDelivery(
      validHeaders("pull_request_review"),
      body(pullRequestReviewFixture),
      1_048_576,
    );
    const serialized = JSON.stringify(delivery);
    const review = pullRequestReviewFixture.review as { body: string };
    const installation = pullRequestReviewFixture.installation as { token: string };
    const sender = pullRequestReviewFixture.sender as { name: string; avatar_url: string };

    expect(delivery).toMatchObject({
      event: "pull_request_review",
      action: "submitted",
      subjectKind: "pull_request",
      subjectNumber: 127,
      actorLogin: "reviewer",
      occurredAt: "2026-08-01T20:21:22Z",
    });
    expect(serialized).not.toContain(review.body);
    expect(serialized).not.toContain(installation.token);
    expect(serialized).not.toContain(sender.name);
    expect(serialized).not.toContain(sender.avatar_url);
  });

  it.each([
    ["missing delivery and event headers", {}],
    ["a malformed delivery header", { "x-github-delivery": "not-a-uuid", "x-github-event": "issues" }],
    ["a missing event header", { "x-github-delivery": "b00c6c06-8888-4b6a-b3f9-911605477e51" }],
  ])("rejects %s", (_scenario, headers) => {
    expect(() => compactDelivery(headers, body(issueFixture), 1_048_576)).toThrow(PermanentSyncError);
  });

  it("rejects an event outside the ingress allowlist", () => {
    expect(() => compactDelivery(validHeaders("push"), body(issueFixture), 1_048_576)).toThrow(
      "WEBHOOK_EVENT_UNSUPPORTED",
    );
  });

  it("rejects a header event that names an object prototype property", () => {
    expect(() => compactDelivery(validHeaders("toString"), body(issueFixture), 1_048_576)).toThrow(
      "WEBHOOK_EVENT_UNSUPPORTED",
    );
  });

  it("rejects an action outside the event-specific allowlist", () => {
    expect(() =>
      compactDelivery(validHeaders("issues"), body({ ...issueFixture, action: "milestoned" }), 1_048_576),
    ).toThrow("WEBHOOK_ACTION_UNSUPPORTED");
  });

  it("rejects a payload for a different repository", () => {
    const otherRepository = {
      ...issueFixture,
      repository: {
        ...(issueFixture.repository as Record<string, unknown>),
        name: "other-repository",
        full_name: "label-suite-org/other-repository",
      },
    };

    expect(() => compactDelivery(validHeaders("issues"), body(otherRepository), 1_048_576)).toThrow(
      "WEBHOOK_REPOSITORY_UNSUPPORTED",
    );
  });

  it("rejects a missing or non-positive subject number", () => {
    expect(() =>
      compactDelivery(
        validHeaders("issues"),
        body({ ...issueFixture, issue: { ...(issueFixture.issue as object), number: 0 } }),
        1_048_576,
      ),
    ).toThrow("WEBHOOK_SUBJECT_INVALID");
  });

  it("rejects invalid JSON after accepting a bounded byte sequence", () => {
    expect(() => compactDelivery(validHeaders("issues"), Buffer.from("not json"), 1_048_576)).toThrow(
      "WEBHOOK_JSON_INVALID",
    );
  });

  it("rejects an oversized body before parsing it", () => {
    expect(() => compactDelivery(validHeaders("issues"), Buffer.from("not json"), 1)).toThrow(
      "WEBHOOK_BODY_TOO_LARGE",
    );
  });

  it("rejects a body above the absolute 1 MiB ingress ceiling even when the caller provides a larger limit", () => {
    expect(() =>
      compactDelivery(validHeaders("issues"), Buffer.alloc(1_048_577), 1_048_577),
    ).toThrow("WEBHOOK_BODY_TOO_LARGE");
  });

  it("rejects a pull request delivery when the top-level and nested identifiers disagree", () => {
    const mismatchedPullRequest = {
      ...pullRequestReviewFixture,
      action: "opened",
      number: 126,
      pull_request: {
        ...(pullRequestReviewFixture.pull_request as Record<string, unknown>),
        number: 127,
      },
    };

    expect(() => compactDelivery(validHeaders("pull_request"), body(mismatchedPullRequest), 1_048_576)).toThrow(
      "WEBHOOK_SUBJECT_INVALID",
    );
  });

  it("compacts ping as a repository health event", () => {
    const ping = {
      repository: issueFixture.repository,
      sender: issueFixture.sender,
    };

    expect(compactDelivery(validHeaders("ping"), body(ping), 1_048_576)).toEqual({
      deliveryId: "b00c6c06-8888-4b6a-b3f9-911605477e51",
      event: "ping",
      action: "ping",
      repository,
      subjectKind: "repository",
      subjectNumber: null,
      actorLogin: "nature-boy",
      occurredAt: "2026-08-01T19:20:30Z",
    });
  });

  it("compacts an installation event only when it explicitly includes the canonical repository", () => {
    const installation = {
      action: "created",
      installation: {
        id: 123456,
        created_at: "2026-08-01T21:22:23Z",
        token: "installation-token-must-not-be-retained",
      },
      repositories: [
        {
          name: "label-suite_neon_r2",
          full_name: repository,
          owner: { login: "label-suite-org" },
        },
      ],
      sender: issueFixture.sender,
    };

    expect(compactDelivery(validHeaders("installation"), body(installation), 1_048_576)).toEqual({
      deliveryId: "b00c6c06-8888-4b6a-b3f9-911605477e51",
      event: "installation",
      action: "created",
      repository,
      subjectKind: "repository",
      subjectNumber: null,
      actorLogin: "nature-boy",
      occurredAt: "2026-08-01T21:22:23Z",
    });
  });
});
