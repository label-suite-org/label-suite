import { listDspPitchesForRelease } from "./dsp-pitches";
import { projectNativeReleaseProviderContext } from "./native-releases";
import { getReleaseSamplyProviderContext } from "./samply-release";

export const NATIVE_DSP_PITCH_LIMIT = 20;

/**
 * Reads persisted provider projections only. It never contacts Samply or
 * generates media URLs, so native detail remains safe to cache.
 */
export async function getNativeReleaseProviderContext(orgId: string, releaseId: string) {
  const [samply, pitches] = await Promise.all([
    getReleaseSamplyProviderContext(orgId, releaseId),
    listDspPitchesForRelease(orgId, releaseId, { limit: NATIVE_DSP_PITCH_LIMIT + 1 }),
  ]);

  const hasMore = pitches.length > NATIVE_DSP_PITCH_LIMIT;

  return projectNativeReleaseProviderContext({
    samply,
    dsp: {
      pitches: pitches.slice(0, NATIVE_DSP_PITCH_LIMIT).map((pitch) => ({
        id: pitch.id,
        platform: pitch.platform ?? null,
        status: pitch.status ?? null,
        sentDate: pitch.sent_date?.toISOString() ?? null,
        response: pitch.response ?? null,
      })),
      // Canonical DSP records are user-maintained, not a live DSP delivery API.
      manuallyMaintained: pitches.length > 0,
      hasMore,
    },
  });
}
