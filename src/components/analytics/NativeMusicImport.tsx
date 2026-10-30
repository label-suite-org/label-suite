import { useState } from "react";
import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const previewSchema = z.object({
  kind: z.literal("preview"), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  provider: z.enum(["spotify_for_artists", "apple_music_for_artists"]), artistName: z.string().min(1),
  dateFrom: z.iso.date(), dateThrough: z.iso.date(), capturedAt: z.iso.datetime(),
  metric: z.enum(["audio_streams", "plays"]), artistTotal: count,
  rowCount: z.number().int().positive(), total: count,
});
type Preview = z.infer<typeof previewSchema>;

export default function NativeMusicImport({ artists, selectedArtistId }: { artists: { id: string; name: string }[]; selectedArtistId?: string }) {
  const [artistId, setArtistId] = useState(artists.some((artist) => artist.id === selectedArtistId) ? selectedArtistId! : "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const overviewHref = `/analytics?section=overview${artistId ? `&artist=${encodeURIComponent(artistId)}` : ""}`;

  async function submit(action: "preview" | "apply") {
    if (!file || !artistId || (action === "apply" && !preview)) return;
    setBusy(true); setMessage(""); setError("");
    if (action === "preview") setPreview(null);
    try {
      const form = new FormData();
      form.set("file", file); form.set("artist_id", artistId); form.set("action", action);
      if (preview) form.set("expected_sha256", preview.sha256);
      const response = await fetch("/api/analytics/native-music-import", { method: "POST", body: form });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "The server could not complete the request.");
      if (action === "preview") {
        const parsed = previewSchema.safeParse(result);
        if (!parsed.success) throw new Error("The server did not return a valid snapshot preview.");
        setPreview(parsed.data);
      } else {
        if ((result?.kind !== "imported" && result?.kind !== "duplicate") || typeof result?.runId !== "string" || !result.runId) {
          throw new Error("The server did not confirm the import result.");
        }
        setMessage(result.kind === "duplicate"
          ? "This exact file was already imported. No new capture was saved."
          : "Snapshot saved. Overview shows the newest capture for this artist and provider; importing an older capture does not replace it.");
        setPreview(null);
      }
    } catch (error) {
      setPreview(null);
      setError(`${action === "apply" ? "Import could not be confirmed. Review saved captures before trying again. " : ""}${error instanceof Error ? error.message : "Native music import failed."}`);
    }
    finally { setBusy(false); }
  }

  return <section className="space-y-3 border-t pt-6" aria-labelledby="native-music-import-heading" aria-busy={busy}>
    <h2 id="native-music-import-heading" className="text-xl font-semibold">Native music snapshot import</h2>
    <p className="text-sm text-muted-foreground">These song totals refresh only when you import a new capture. Reloading Analytics reads saved data; it does not fetch new numbers from Spotify for Artists or Apple Music for Artists.</p>
    <p className="text-sm text-muted-foreground">Use a prepared snapshot JSON from a signed-in artist dashboard, with exact reporting dates, capture time, worldwide scope and provider song IDs. Provider CSV files are not supported here. Review the artist, dates and song sum before saving in the current workspace.</p>
    <label className="block">Label Suite artist
      <select className="ml-3 border bg-transparent p-2" value={artistId} disabled={busy} onChange={(event) => { setArtistId(event.target.value); setPreview(null); setMessage(""); setError(""); }}>
        <option value="">Choose artist</option>{artists.map((artist) => <option key={artist.id} value={artist.id}>{artist.name}</option>)}
      </select>
    </label>
    <label className="block">Native snapshot file
      <input type="file" accept=".json,application/json" disabled={busy} className="ml-3" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); setMessage(""); setError(""); }} />
    </label>
    <button type="button" className="rounded border px-3 py-2 disabled:opacity-50" disabled={busy || !file || !artistId} onClick={() => void submit("preview")}>Preview native snapshot</button>
    {preview && <div className="space-y-2 rounded border p-3">
      <p>{preview.artistName} · {preview.provider.replaceAll("_", " ")}</p>
      <p>Reporting window: {preview.dateFrom}–{preview.dateThrough} · Worldwide</p>
      <p>Captured: {new Date(preview.capturedAt).toLocaleString()} · {preview.rowCount} song entries</p>
      <p>Song sum: {preview.total === null ? "Unknown" : preview.total.toLocaleString("en-US")} {preview.metric === "audio_streams" ? "audio streams" : "plays"}</p>
      {preview.artistTotal !== null && <p>Separate artist rollup: {preview.artistTotal.toLocaleString("en-US")} plays. It may differ from the song sum; neither figure is adjusted.</p>}
      <p>Import into {artists.find((artist) => artist.id === artistId)?.name}.</p>
      <button type="button" className="rounded border px-3 py-2" disabled={busy} onClick={() => void submit("apply")}>Import this native snapshot</button>
    </div>}
    {error && <p role="alert">{error}</p>}
    <p role="status">{message}</p>
    <a href={overviewHref} className="inline-block text-sm underline">Review saved captures in Overview</a>
  </section>;
}
