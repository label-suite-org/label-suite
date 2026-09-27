import { describe, expect, it, vi } from "vitest";
import { artistSubmissionSchema } from "../lib/artist-portal";
vi.mock("../lib/db", () => ({ db: {}, runWithDatabaseContext: vi.fn() }));
import { portalTokenHash, readPortalJson, validateAgreementLink } from "./artist-portal";

const details = { id: crypto.randomUUID(), submitted_by: "Artist Manager", email: "manager@example.test", track_title: "Song", version: "", release_title: "", contributors: [{ name: "Writer", role: "Music", details: "" }], writing_shares: "Not agreed yet", notes: "" };

describe("artist portal trust boundary", () => {
  it("accepts incomplete agreements but rejects empty credits and injected privileged fields", () => {
    expect(artistSubmissionSchema.parse(details).writing_shares).toBe("Not agreed yet");
    expect(artistSubmissionSchema.safeParse({ ...details, contributors: [] }).success).toBe(false);
    expect(artistSubmissionSchema.safeParse({ ...details, org_id: "other" }).success).toBe(false);
    expect(artistSubmissionSchema.safeParse({ ...details, reviewed_at: new Date() }).success).toBe(false);
    expect(artistSubmissionSchema.safeParse({ ...details, contributors: [{ name: "", role: "Music", details: "" }] }).success).toBe(false);
  });
  it("hashes valid high entropy links and rejects malformed access and unsafe file schemes", () => {
    expect(portalTokenHash("a".repeat(43))).toMatch(/^[a-f0-9]{64}$/);
    expect(() => portalTokenHash("bad")).toThrow("link is unavailable");
    expect(validateAgreementLink("https://example.test/agreement.pdf", "org")).toBe("url");
    expect(validateAgreementLink("documents/agreement.pdf", "org")).toBe("storage");
    for (const link of ["javascript:alert(1)", "//evil.test", "https://user:pass@example.test", "../secret", "\\evil.test"]) {
      expect(() => validateAgreementLink(link, "org")).toThrow();
    }
  });
  it("bounds the actual body even when Content-Length is absent and handles invalid JSON", async () => {
    const request = (body: string) => new Request("https://example.test/api/artist-portal", { method: "POST", headers: { "content-type": "application/json" }, body });
    await expect(readPortalJson(request(JSON.stringify(details)))).resolves.toEqual(details);
    await expect(readPortalJson(request("x".repeat(65537)))).rejects.toMatchObject({ status: 413 });
    await expect(readPortalJson(request("{"))).rejects.toMatchObject({ status: 400 });
  });
});
