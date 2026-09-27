export const externalObjectMatchMethods = [
  "manual",
  "isrc",
  "upc",
  "title_artist",
  "provider_callback",
  "import_rule",
] as const;

export type ExternalObjectMatchMethod = typeof externalObjectMatchMethods[number];

export interface ExternalObjectMatchCandidate {
  orgId?: string;
  objectType: string;
  objectId: string;
  matchMethod: ExternalObjectMatchMethod;
  matchConfidence?: number | null;
  existingLink?: boolean;
  identifierExact?: boolean;
  titleExact?: boolean;
  artistExact?: boolean;
  titleSimilarity?: number | null;
  artistSimilarity?: number | null;
  matchedFields?: number | null;
}

export interface ExternalObjectMatchOptions {
  orgId?: string;
  minimumScore?: number;
  ambiguityWindow?: number;
}

export type ExternalObjectMatchDecision =
  | { status: "matched"; candidate: ExternalObjectMatchCandidate; score: number }
  | { status: "ambiguous"; score: number; candidates: ExternalObjectMatchCandidate[] }
  | { status: "unmatched"; reason: "no_candidates" | "below_threshold" };

const matchMethodWeights: Record<ExternalObjectMatchMethod, number> = {
  manual: 1000,
  provider_callback: 900,
  isrc: 700,
  upc: 650,
  title_artist: 500,
  import_rule: 400,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeSimilarity(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return 0;
  return clamp(value, 0, 1);
}

export function scoreExternalObjectMatchCandidate(candidate: ExternalObjectMatchCandidate) {
  let score = matchMethodWeights[candidate.matchMethod];

  if (candidate.existingLink) score += 120;
  if (candidate.identifierExact) score += 80;
  if (candidate.titleExact) score += 40;
  if (candidate.artistExact) score += 30;

  const matchConfidence = candidate.matchConfidence == null ? 0 : clamp(candidate.matchConfidence, 0, 100);
  score += matchConfidence * 2;
  score += Math.round(normalizeSimilarity(candidate.titleSimilarity) * 30);
  score += Math.round(normalizeSimilarity(candidate.artistSimilarity) * 20);
  score += clamp(candidate.matchedFields ?? 0, 0, 5) * 10;

  return score;
}

export function chooseExternalObjectMatchCandidate(
  candidates: ExternalObjectMatchCandidate[],
  options: ExternalObjectMatchOptions = {},
): ExternalObjectMatchDecision {
  const eligibleCandidates = options.orgId
    ? candidates.filter((candidate) => !candidate.orgId || candidate.orgId === options.orgId)
    : candidates;

  if (!eligibleCandidates.length) return { status: "unmatched", reason: "no_candidates" };

  const minimumScore = options.minimumScore ?? 550;
  const ambiguityWindow = options.ambiguityWindow ?? 15;
  const scored = eligibleCandidates
    .map((candidate) => ({ candidate, score: scoreExternalObjectMatchCandidate(candidate) }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.candidate.objectType !== right.candidate.objectType) {
        return left.candidate.objectType.localeCompare(right.candidate.objectType);
      }
      return left.candidate.objectId.localeCompare(right.candidate.objectId);
    });

  const best = scored[0];
  if (!best || best.score < minimumScore) {
    return { status: "unmatched", reason: "below_threshold" };
  }

  const ambiguous = scored.filter(({ candidate, score }) =>
    score >= best.score - ambiguityWindow
    && (candidate.objectType !== best.candidate.objectType || candidate.objectId !== best.candidate.objectId),
  );

  if (ambiguous.length) {
    return {
      status: "ambiguous",
      score: best.score,
      candidates: [best.candidate, ...ambiguous.map((entry) => entry.candidate)],
    };
  }

  return { status: "matched", candidate: best.candidate, score: best.score };
}
