export type SpotifyCatalogObjectType = "artist" | "album" | "track";

export type SpotifyIdentityInput = {
  object_type: SpotifyCatalogObjectType;
  external_id: string;
  external_url?: string | null;
  name: string;
  artist_name?: string | null;
  isrc?: string | null;
  upc_ean?: string | null;
};

export type SpotifyCatalogCandidate = {
  object_type: SpotifyCatalogObjectType;
  object_id: string;
  title: string;
  artist_name?: string | null;
  isrc?: string | null;
  upc_ean?: string | null;
};

export type SpotifyIdentityProposal = {
  status: "needs_confirmation" | "ambiguous" | "unmatched";
  match_method: "isrc" | "upc" | "title_artist" | null;
  confidence: number | null;
  candidates: Array<SpotifyCatalogCandidate & { score: number }>;
};

export function normalizeSpotifyText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function exact(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(left && right && left.trim().toLowerCase() === right.trim().toLowerCase());
}

export function proposeSpotifyIdentity(
  input: SpotifyIdentityInput,
  candidates: SpotifyCatalogCandidate[],
): SpotifyIdentityProposal {
  const ranked = candidates
    .filter((candidate) => candidate.object_type === input.object_type)
    .map((candidate) => {
      const identifierMatch = input.object_type === "track"
        ? exact(input.isrc, candidate.isrc)
        : input.object_type === "album"
          ? exact(input.upc_ean, candidate.upc_ean)
          : false;
      const titleMatch = normalizeSpotifyText(input.name) === normalizeSpotifyText(candidate.title);
      const artistMatch = input.artist_name && candidate.artist_name
        ? normalizeSpotifyText(input.artist_name) === normalizeSpotifyText(candidate.artist_name)
        : false;
      const score = identifierMatch ? 100 : titleMatch && artistMatch ? 82 : titleMatch ? 55 : 0;
      return { candidate, score, identifierMatch };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.candidate.object_id.localeCompare(right.candidate.object_id));

  if (!ranked.length) return { status: "unmatched", match_method: null, confidence: null, candidates: [] };
  const best = ranked[0];
  const tied = ranked.filter((entry) => entry.score === best.score);
  if (tied.length > 1) {
    return {
      status: "ambiguous",
      match_method: best.identifierMatch ? input.object_type === "track" ? "isrc" : "upc" : "title_artist",
      confidence: best.score,
      candidates: tied.map((entry) => ({ ...entry.candidate, score: entry.score })),
    };
  }
  return {
    status: "needs_confirmation",
    match_method: best.identifierMatch ? input.object_type === "track" ? "isrc" : "upc" : "title_artist",
    confidence: best.score,
    candidates: [{ ...best.candidate, score: best.score }],
  };
}
