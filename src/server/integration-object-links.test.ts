import { describe, expect, it } from "vitest";
import { chooseExternalObjectMatchCandidate, scoreExternalObjectMatchCandidate } from "./integration-object-links";

describe("external object link matching", () => {
  it("prefers an existing manual link over lower-authority automated matches", () => {
    const decision = chooseExternalObjectMatchCandidate([
      {
        orgId: "true-nature",
        objectType: "release",
        objectId: "release-manual",
        matchMethod: "manual",
        existingLink: true,
        matchConfidence: 60,
      },
      {
        orgId: "true-nature",
        objectType: "release",
        objectId: "release-isrc",
        matchMethod: "isrc",
        identifierExact: true,
        matchConfidence: 100,
      },
    ], { orgId: "true-nature" });

    expect(decision.status).toBe("matched");
    if (decision.status !== "matched") return;
    expect(decision.candidate.objectId).toBe("release-manual");
  });

  it("ranks exact identifier matches above title and artist similarity", () => {
    const identifierScore = scoreExternalObjectMatchCandidate({
      objectType: "track",
      objectId: "track-isrc",
      matchMethod: "isrc",
      identifierExact: true,
      matchConfidence: 95,
    });
    const fuzzyScore = scoreExternalObjectMatchCandidate({
      objectType: "track",
      objectId: "track-fuzzy",
      matchMethod: "title_artist",
      titleSimilarity: 1,
      artistSimilarity: 1,
      matchedFields: 2,
      matchConfidence: 95,
    });

    expect(identifierScore).toBeGreaterThan(fuzzyScore);
  });

  it("returns ambiguous when two same-org candidates are effectively tied", () => {
    const decision = chooseExternalObjectMatchCandidate([
      {
        orgId: "true-nature",
        objectType: "track",
        objectId: "track-a",
        matchMethod: "title_artist",
        titleSimilarity: 1,
        artistSimilarity: 1,
        matchedFields: 2,
        matchConfidence: 85,
      },
      {
        orgId: "true-nature",
        objectType: "track",
        objectId: "track-b",
        matchMethod: "title_artist",
        titleSimilarity: 1,
        artistSimilarity: 1,
        matchedFields: 2,
        matchConfidence: 85,
      },
    ], { orgId: "true-nature" });

    expect(decision.status).toBe("ambiguous");
    if (decision.status !== "ambiguous") return;
    expect(decision.candidates.map((candidate) => candidate.objectId)).toEqual(["track-a", "track-b"]);
  });

  it("returns unmatched when no candidate clears the minimum threshold", () => {
    const decision = chooseExternalObjectMatchCandidate([
      {
        orgId: "true-nature",
        objectType: "station",
        objectId: "station-1",
        matchMethod: "import_rule",
        matchConfidence: 5,
      },
    ], { orgId: "true-nature" });

    expect(decision).toEqual({ status: "unmatched", reason: "below_threshold" });
  });

  it("filters candidates to the active org before scoring", () => {
    const decision = chooseExternalObjectMatchCandidate([
      {
        orgId: "other-label",
        objectType: "track",
        objectId: "foreign-perfect-match",
        matchMethod: "manual",
        existingLink: true,
        matchConfidence: 100,
      },
      {
        orgId: "true-nature",
        objectType: "track",
        objectId: "local-isrc",
        matchMethod: "isrc",
        identifierExact: true,
        matchConfidence: 80,
      },
    ], { orgId: "true-nature" });

    expect(decision.status).toBe("matched");
    if (decision.status !== "matched") return;
    expect(decision.candidate.objectId).toBe("local-isrc");
  });
});
