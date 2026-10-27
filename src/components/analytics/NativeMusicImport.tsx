import { useState } from "react";

type Preview = { sha256: string; provider: string; artistName: string; dateFrom: string; dateThrough: string; rowCount: number; total: number | null };

export default function NativeMusicImport({ artists }: { artists: { id: string; name: string }[] }) {
  const [artistId, setArtistId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(action: "preview" | "apply") {
    if (!file || !artistId || (action === "apply" && !preview)) return;
    setBusy(true); setMessage("");
    try {
      const form = new FormData();
      form.set("file", file); form.set("artist_id", artistId); form.set("action", action);
      if (preview) form.set("expected_sha256", preview.sha256);
      const response = await fetch("/api/analytics/native-music-import", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Native music import failed");
      if (action === "preview") setPreview(result);
      else { setMessage("Native snapshot saved. Open Overview to see the imported song totals."); setPreview(null); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Native music import failed"); }
    finally { setBusy(false); }
  }

  return <section className="space-y-3 border-t pt-6" aria-labelledby="native-music-import-heading" aria-busy={busy}>
    <h2 id="native-music-import-heading" className="text-xl font-semibold">Native music snapshot import</h2>
    <p className="text-sm text-muted-foreground">Import a prepared capture from Spotify for Artists or Apple Music for Artists. Review the native artist and dates before saving. This does not enable automatic refresh.</p>
    <label className="block">Label Suite artist
      <select className="ml-3 border bg-transparent p-2" value={artistId} disabled={busy} onChange={(event) => { setArtistId(event.target.value); setPreview(null); setMessage(""); }}>
        <option value="">Choose artist</option>{artists.map((artist) => <option key={artist.id} value={artist.id}>{artist.name}</option>)}
      </select>
    </label>
    <label className="block">Native snapshot file
      <input type="file" accept=".json,application/json" disabled={busy} className="ml-3" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); setMessage(""); }} />
    </label>
    <button type="button" className="rounded border px-3 py-2 disabled:opacity-50" disabled={busy || !file || !artistId} onClick={() => void submit("preview")}>Preview native snapshot</button>
    {preview && <div className="space-y-2 rounded border p-3">
      <p>{preview.artistName} · {preview.provider.replaceAll("_", " ")}</p>
      <p>{preview.dateFrom}–{preview.dateThrough} · Worldwide · {preview.rowCount} song entries · {preview.total === null ? "Unknown total" : preview.total.toLocaleString("en-US")}</p>
      <p>Import into {artists.find((artist) => artist.id === artistId)?.name}.</p>
      <button type="button" className="rounded border px-3 py-2" disabled={busy} onClick={() => void submit("apply")}>Import this native snapshot</button>
    </div>}
    <p role="status">{message}</p>
  </section>;
}
