import { useState } from "react";
import type { LatestSpotifyAudienceImport } from "../../server/spotify-analytics-import";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
type Artist = { id: string; name: string };

type PreviewResponse = {
  kind: "preview";
  artistId: string;
  fileName: string;
  sha256: string;
  byteSize: number;
  rowCount: number;
  dateFrom: string;
  dateThrough: string;
  canonicalRange: string;
};

type ImportState =
  | { kind: "idle" }
  | { kind: "previewing" }
  | { kind: "ready"; preview: PreviewResponse }
  | { kind: "applying"; preview: PreviewResponse }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

type ApplyResponse =
  | { kind: "duplicate"; runId: string; reportingThrough: string; latest: LatestSpotifyAudienceImport }
  | { kind: "imported"; runId: string; inserted: number; updated: number; unchanged: number; reportingThrough: string; latest: LatestSpotifyAudienceImport };

interface Props {
  artists: Artist[];
  latestImports: LatestSpotifyAudienceImport[];
}

const metricLabels = [
  "Listeners",
  "Monthly listeners",
  "Monthly active listeners",
  "Super listeners",
  "Streams",
  "Playlist adds",
  "Saves",
  "Followers",
];

export default function SpotifyCsvImport({ artists, latestImports }: Props) {
  const [artistId, setArtistId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<ImportState>({ kind: "idle" });
  const [evidence, setEvidence] = useState(latestImports);
  const busy = state.kind === "previewing" || state.kind === "applying";
  const canPreview = Boolean(artistId && file) && !busy;

  function invalidatePreview(nextArtistId = artistId, nextFile = file) {
    setArtistId(nextArtistId);
    setFile(nextFile);
    setState({ kind: "idle" });
  }

  async function request(form: FormData) {
    const response = await fetch("/api/analytics/spotify-import", {
      method: "POST",
      credentials: "same-origin",
      body: form,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Spotify audience import could not be completed");
    return body;
  }

  async function previewFile() {
    if (!artistId || !file) return;
    setState({ kind: "previewing" });
    try {
      const form = new FormData();
      form.set("action", "preview");
      form.set("artist_id", artistId);
      form.set("file", file);
      const preview = await request(form) as PreviewResponse;
      if (preview.kind !== "preview") throw new Error("The server did not return a Spotify audience preview");
      setState({ kind: "ready", preview });
    } catch (cause) {
      setState({ kind: "error", message: errorMessage(cause) });
    }
  }

  async function applyFile() {
    if (state.kind !== "ready" || !artistId || !file) return;
    const preview = state.preview;
    setState({ kind: "applying", preview });
    try {
      const form = new FormData();
      form.set("action", "apply");
      form.set("artist_id", artistId);
      form.set("file", file);
      form.set("expected_sha256", preview.sha256);
      const result = await request(form) as ApplyResponse;
      setEvidence((current) => [result.latest, ...current.filter((item) => item.artistId !== result.latest.artistId)]);
      setState({ kind: "done", message: importMessage(result) });
    } catch (cause) {
      setState({ kind: "error", message: errorMessage(cause) });
    }
  }

  return <section className="space-y-5 border-t border-[var(--border)] pt-6" aria-labelledby="spotify-csv-import-heading" aria-busy={busy}>
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Manual source evidence</p>
      <h2 id="spotify-csv-import-heading" className="mt-1 text-xl font-semibold">Spotify audience timeline import</h2>
      <p className="mt-1 text-sm text-muted-foreground">Import a Spotify for Artists — Audience timeline CSV for one artist. This stays separate from automated Analytics Data Health evidence.</p>
    </div>

    <div className="border border-[var(--border)] p-4">
      <p className="text-sm font-medium">Recognized export</p>
      <p className="mt-1 text-sm text-muted-foreground">Spotify for Artists — Audience timeline, with daily rows for:</p>
      <ul className="mt-3 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
        {metricLabels.map((label) => <li key={label}>{label}</li>)}
      </ul>
    </div>

    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <label htmlFor="spotify-import-artist" className="text-sm font-medium">Artist</label>
        <NativeSelect id="spotify-import-artist" value={artistId} disabled={busy} onChange={(event) => invalidatePreview(event.target.value)} className="w-full border border-[var(--border)] bg-transparent px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">
          <option value="">Select artist</option>
          {artists.map((artist) => <option key={artist.id} value={artist.id}>{artist.name}</option>)}
        </NativeSelect>
      </div>
      <div className="space-y-2">
        <label htmlFor="spotify-import-file" className="text-sm font-medium">Audience timeline CSV</label>
        <Input id="spotify-import-file" type="file" accept=".csv,text/csv,application/csv" disabled={busy} onChange={(event) => invalidatePreview(artistId, event.target.files?.[0] ?? null)} className="block w-full border border-[var(--border)] px-3 py-2 text-sm file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:cursor-not-allowed disabled:opacity-50" />
      </div>
    </div>

    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" type="button" onClick={previewFile} disabled={!canPreview} className="rounded border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">
        {state.kind === "previewing" ? "Previewing file…" : "Preview file"}
      </Button>
      <p className="text-sm text-muted-foreground" role="status">{busy ? "Request in progress. File and artist selection are locked." : "Preview before importing so the selected file and SHA-256 can be verified."}</p>
    </div>

    {state.kind === "ready" && <div className="border border-[var(--border)] p-4" role="status">
      <h3 className="font-medium">Preview ready</h3>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <Fact label="File" value={state.preview.fileName} />
        <Fact label="Rows" value={`${state.preview.rowCount.toLocaleString()} daily rows`} />
        <Fact label="Coverage" value={`${state.preview.dateFrom} to ${state.preview.dateThrough}`} />
        <Fact label="SHA-256" value={state.preview.sha256} />
      </dl>
      <Button variant="outline" data-action="apply" type="button" onClick={applyFile} disabled={busy} className="mt-4 rounded border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">Import this file</Button>
    </div>}

    {state.kind === "applying" && <div className="border border-[var(--border)] p-4" role="status">Importing the previewed file…</div>}
    {state.kind === "done" && <p className="border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm" role="status">{state.message}</p>}
    {state.kind === "error" && <p className="border border-red-500/40 bg-red-500/10 p-3 text-sm" role="alert">{state.message}</p>}

    <div className="space-y-3">
      <h3 className="font-medium">Latest manual Spotify source evidence</h3>
      {evidence.length === 0 ? <p className="border border-[var(--border)] p-4 text-sm text-muted-foreground" role="status">No manual Spotify audience imports recorded yet.</p> : <div className="overflow-x-auto border border-[var(--border)]" role="region" tabIndex={0} aria-label="Latest manual Spotify audience imports">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-[var(--border)] text-muted-foreground"><th className="p-3">Artist</th><th>Reporting through</th><th>File</th><th>Rows</th><th>Imported</th><th>SHA-256</th></tr></thead>
          <tbody>{evidence.map((item) => <tr key={item.artistId} className="border-b border-[var(--border)] align-top"><td className="p-3 font-medium">{item.artistName}</td><td>Reporting through: {item.reportingThrough}</td><td>{item.fileName}</td><td>{item.rowCount.toLocaleString()} rows</td><td>{formatImportedAt(item.importedAt)}</td><td className="font-mono text-xs">{item.sha256.slice(0, 12)}</td></tr>)}</tbody>
        </table>
      </div>}
    </div>
  </section>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-all">{value}</dd></div>;
}

function importMessage(result: ApplyResponse): string {
  if (result.kind === "duplicate") return `This file was already imported for this artist. Reporting through ${result.reportingThrough}.`;
  return `Import completed: ${result.inserted.toLocaleString()} inserted, ${result.updated.toLocaleString()} updated, and ${result.unchanged.toLocaleString()} unchanged rows. Reporting through ${result.reportingThrough}.`;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Spotify audience import could not be completed";
}

function formatImportedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
