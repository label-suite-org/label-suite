import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { useEffect, useRef, useState } from "react";
import type {
  BoundSisenseTrackSnapshotPreview,
  LatestSisenseTrackSnapshotImport,
  SisenseTrackSnapshotApplyResult,
} from "../../server/sisense-track-snapshot-import";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
type ArtistOption = { id: string; name: string };

type Props = {
  artists: ArtistOption[];
  latestImports: LatestSisenseTrackSnapshotImport[];
};

type Ambiguity = {
  identity: string;
  sourceRows: number[];
  reason: string;
};

type SubmittedPreview = {
  artistId: string;
  reportingFrom: string;
  reportingThrough: string;
  aggregation: string;
  file: File;
  sanitizedFileName: string;
  sha256: string;
};

type ImportState =
  | { kind: "idle" }
  | { kind: "previewing" }
  | { kind: "ready"; preview: BoundSisenseTrackSnapshotPreview }
  | { kind: "applying"; preview: BoundSisenseTrackSnapshotPreview }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string; ambiguities: Ambiguity[]; totalAmbiguityCount: number };

const GENERIC_ERROR = "Sisense snapshot import could not be completed";
const INVALID_PREVIEW_ERROR = "The server did not return a valid Sisense snapshot preview";
const INVALID_APPLY_ERROR = "The server did not return a valid Sisense snapshot import result";
const MAX_UI_AMBIGUITY_SAMPLES = 5;

class SisenseRequestError extends Error {
  constructor(
    message: string,
    readonly ambiguities: Ambiguity[] = [],
    readonly totalAmbiguityCount = 0,
  ) {
    super(message);
    this.name = "SisenseRequestError";
  }
}

export default function SisenseTrackSnapshotImport({ artists, latestImports }: Props) {
  const [artistId, setArtistId] = useState("");
  const [reportingFrom, setReportingFrom] = useState("");
  const [reportingThrough, setReportingThrough] = useState("");
  const [aggregation, setAggregation] = useState("Daily");
  const [file, setFile] = useState<File | null>(null);
  const [includeUnmatched, setIncludeUnmatched] = useState(false);
  const [state, setState] = useState<ImportState>({ kind: "idle" });
  const [evidence, setEvidence] = useState(latestImports);
  const mountedRef = useRef(true);
  const previewAbortRef = useRef<AbortController | null>(null);
  const primaryActionRef = useRef<HTMLButtonElement | null>(null);

  const busy = state.kind === "previewing" || state.kind === "applying";
  const formComplete = Boolean(artistId && reportingFrom && reportingThrough && aggregation.trim() && file);
  const readyPreview = state.kind === "ready" ? state.preview : null;
  const canApply = Boolean(readyPreview && (readyPreview.counts.unmatched === 0 || includeUnmatched));

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      previewAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (state.kind === "ready" || state.kind === "error" || state.kind === "success") {
      primaryActionRef.current?.focus();
    }
  }, [state.kind]);

  function invalidatePreview() {
    setIncludeUnmatched(false);
    setState({ kind: "idle" });
  }

  async function request(form: FormData, signal?: AbortSignal): Promise<unknown> {
    const response = await fetch("/api/analytics/sisense-track-import", {
      method: "POST",
      credentials: "same-origin",
      body: form,
      ...(signal ? { signal } : {}),
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      const payload = isRecord(body) ? body : null;
      const message = typeof payload?.error === "string" && payload.error.trim()
        ? payload.error
        : GENERIC_ERROR;
      const ambiguities = ambiguitySamples(payload?.ambiguities);
      const total = nonNegativeInteger(payload?.totalAmbiguityCount) ?? ambiguities.length;
      throw new SisenseRequestError(message, ambiguities, total);
    }
    return body;
  }

  function baseForm(action: "preview" | "apply"): FormData | null {
    if (!artistId || !reportingFrom || !reportingThrough || !aggregation.trim() || !file) return null;
    const form = new FormData();
    form.set("action", action);
    form.set("artist_id", artistId);
    form.set("reporting_from", reportingFrom);
    form.set("reporting_through", reportingThrough);
    form.set("aggregation", aggregation);
    form.set("file", file);
    return form;
  }

  async function previewFile() {
    const form = baseForm("preview");
    if (!form || !file) return;
    const controller = new AbortController();
    previewAbortRef.current?.abort();
    previewAbortRef.current = controller;
    const submittedBase = {
      artistId,
      reportingFrom,
      reportingThrough,
      aggregation: aggregation.trim(),
      file,
      sanitizedFileName: sanitizeFileName(file.name),
    };
    setIncludeUnmatched(false);
    setState({ kind: "previewing" });
    try {
      const submitted: SubmittedPreview = {
        ...submittedBase,
        sha256: await sha256File(file),
      };
      if (!mountedRef.current) return;
      const result = await request(form, controller.signal);
      if (!mountedRef.current) return;
      if (!isBoundPreviewForSubmission(result, submitted)) throw new Error(INVALID_PREVIEW_ERROR);
      setState({ kind: "ready", preview: result });
    } catch (cause) {
      if (!mountedRef.current) return;
      setErrorState(cause, setState);
    } finally {
      if (previewAbortRef.current === controller) previewAbortRef.current = null;
    }
  }

  async function applyFile() {
    if (state.kind !== "ready" || !canApply) return;
    const preview = state.preview;
    const form = baseForm("apply");
    if (!form) return;
    form.set("expected_sha256", preview.sha256);
    form.set("expected_preview_fingerprint", preview.previewFingerprint);
    if (includeUnmatched) form.set("include_unmatched", "true");
    setState({ kind: "applying", preview });
    try {
      const result = await request(form);
      if (!mountedRef.current) return;
      if (!isApplyResultForPreview(result, preview)) throw new Error(INVALID_APPLY_ERROR);
      setEvidence((current) => updateEvidence(current, result));
      setState({ kind: "success", message: applyMessage(result) });
      window.dispatchEvent(new CustomEvent("sisense-track-snapshot-imported", { detail: result }));
    } catch (cause) {
      if (!mountedRef.current) return;
      setErrorState(cause, setState);
    }
  }

  return (
    <section
      className="space-y-5 border-t border-[var(--border)] pt-6"
      aria-labelledby="sisense-track-snapshot-import-heading"
      aria-busy={busy}
    >
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Internal team source evidence
        </p>
        <h2 id="sisense-track-snapshot-import-heading" className="mt-1 text-xl font-semibold">
          Dated Sisense track snapshot import
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Import one cumulative Tracks by Growth Rate snapshot. The dates describe the reporting context used by Sisense; they are not a stream-period total.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <FormControl label="Artist" id="sisense-track-import-artist">
          <NativeSelect
            id="sisense-track-import-artist"
            value={artistId}
            disabled={busy}
            onChange={(event) => {
              setArtistId(event.target.value);
              invalidatePreview();
            }}
            className={controlClassName}
          >
            <option value="">Select artist</option>
            {artists.map((artist) => <option key={artist.id} value={artist.id}>{artist.name}</option>)}
          </NativeSelect>
        </FormControl>

        <FormControl label="Aggregation" id="sisense-track-import-aggregation">
          <NativeSelect
            id="sisense-track-import-aggregation"
            value={aggregation}
            disabled={busy}
            onChange={(event) => {
              setAggregation(event.target.value);
              invalidatePreview();
            }}
            className={controlClassName}
          >
            <option value="Daily">Daily</option>
            <option value="Weekly">Weekly</option>
            <option value="Monthly">Monthly</option>
          </NativeSelect>
        </FormControl>

        <FormControl label="Reporting from" id="sisense-track-import-from">
          <Input
            id="sisense-track-import-from"
            type="date"
            value={reportingFrom}
            disabled={busy}
            onChange={(event) => {
              setReportingFrom(event.target.value);
              invalidatePreview();
            }}
            className={controlClassName}
          />
        </FormControl>

        <FormControl label="Reporting through" id="sisense-track-import-through">
          <Input
            id="sisense-track-import-through"
            type="date"
            value={reportingThrough}
            disabled={busy}
            onChange={(event) => {
              setReportingThrough(event.target.value);
              invalidatePreview();
            }}
            className={controlClassName}
          />
        </FormControl>

        <div className="space-y-2 md:col-span-2">
          <label htmlFor="sisense-track-import-file" className="text-sm font-medium">
            Tracks by Growth Rate CSV
          </label>
          <Input
            id="sisense-track-import-file"
            type="file"
            accept=".csv,text/csv,application/csv"
            disabled={busy}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              invalidatePreview();
            }}
            className="block w-full border border-[var(--border)] px-3 py-2 text-sm file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      </div>

      {state.kind === "ready" && (
        <PreviewPanel
          preview={state.preview}
          includeUnmatched={includeUnmatched}
          disabled={busy}
          onIncludeUnmatched={setIncludeUnmatched}
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        {(state.kind === "idle" || state.kind === "error" || state.kind === "success") && (
          <Button
            ref={primaryActionRef}
            data-primary-action
            type="button"
            onClick={previewFile}
            disabled={!formComplete || busy}
            className={buttonClassName}
          >
            Preview file
          </Button>
        )}
        {state.kind === "previewing" && (
          <Button ref={primaryActionRef} data-primary-action type="button" disabled className={buttonClassName}>
            Previewing file…
          </Button>
        )}
        {state.kind === "ready" && (
          <Button
            ref={primaryActionRef}
            data-primary-action
            type="button"
            onClick={applyFile}
            disabled={!canApply || busy}
            className={buttonClassName}
          >
            Import this snapshot
          </Button>
        )}
        <p className="text-sm text-muted-foreground">
          {busy
            ? "Request in progress. Artist, dates, aggregation, file, and acknowledgement are locked."
            : "Preview before importing so the selected context, file hash, and catalog resolution can be verified."}
        </p>
      </div>

      <div aria-live="polite">
        {state.kind === "applying" && (
          <p className="border border-[var(--border)] p-4 text-sm">Importing the previewed snapshot…</p>
        )}
        {state.kind === "success" && (
          <p className="border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">{state.message}</p>
        )}
      </div>

      {state.kind === "error" && <ErrorAlert state={state} />}

      <LatestEvidence evidence={evidence} />
    </section>
  );
}

function FormControl({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function PreviewPanel({
  preview,
  includeUnmatched,
  disabled,
  onIncludeUnmatched,
}: {
  preview: BoundSisenseTrackSnapshotPreview;
  includeUnmatched: boolean;
  disabled: boolean;
  onIncludeUnmatched: (value: boolean) => void;
}) {
  const counts = preview.counts;
  return (
    <div className="border border-[var(--border)] p-4" role="status">
      <h3 className="font-medium">Preview ready</h3>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <Fact label="Artist" value={preview.artistName} />
        <Fact label="File" value={preview.fileName} />
        <Fact label="Reporting context" value={preview.requestedDateRange} />
        <Fact label="Aggregation" value={preview.aggregation} />
        <Fact label="Source evidence" value={`${plural(counts.sourceRows, "source row")} · ${plural(counts.uniqueTracks, "unique track")} · ${plural(counts.exactDuplicates, "exact duplicate")}`} />
        <Fact label="Catalog resolution" value={`${plural(counts.matched, "matched track")} · ${plural(counts.unmatched, "unmatched source row")}`} />
        <Fact label="SHA-256" value={preview.sha256} />
      </dl>
      <div className="mt-4">
        <p className="text-xs font-medium text-muted-foreground">Identity-quality sample</p>
        <ul className="mt-2 divide-y divide-[var(--border)] border border-[var(--border)]">
          {preview.identitySamples.items.map((sample) => (
            <li key={`${sample.sourceRow}:${sample.matchStatus}`} className="p-2 text-sm">
              <span className="font-medium">{sample.trackTitle}</span>
              {sample.releaseTitle ? ` · ${sample.releaseTitle}` : ""}
              {` · ${sample.matchStatus === "matched" ? "Matched" : "Unmatched"} · source row ${sample.sourceRow}`}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Showing {preview.identitySamples.items.length.toLocaleString()} of {preview.identitySamples.total.toLocaleString()} identities
          {preview.identitySamples.truncated ? "; additional identities are not shown." : "."}
        </p>
      </div>
      {counts.unmatched > 0 && (
        <div className="mt-4 flex items-start gap-2 border border-amber-500/40 bg-amber-500/10 p-3">
          <Input
            id="sisense-track-import-unmatched"
            type="checkbox"
            checked={includeUnmatched}
            disabled={disabled}
            required
            aria-required="true"
            aria-describedby="sisense-track-import-unmatched-description"
            onChange={(event) => onIncludeUnmatched(event.target.checked)}
            className="mt-1"
          />
          <label htmlFor="sisense-track-import-unmatched" className="text-sm font-medium">
            Include {plural(counts.unmatched, "unmatched source row")} in this snapshot
          </label>
          <p id="sisense-track-import-unmatched-description" className="text-sm text-muted-foreground">
            This acknowledgement is bound to the current preview hash and is cleared when the artist, dates, aggregation, or file changes.
          </p>
        </div>
      )}
    </div>
  );
}

function ErrorAlert({ state }: { state: Extract<ImportState, { kind: "error" }> }) {
  const samples = state.ambiguities.slice(0, MAX_UI_AMBIGUITY_SAMPLES);
  return (
    <div className="border border-red-500/40 bg-red-500/10 p-3 text-sm" role="alert">
      {state.totalAmbiguityCount > 0 ? (
        <>
          <p className="font-medium">{plural(state.totalAmbiguityCount, "ambiguous identity", "ambiguous identities")} prevent preview.</p>
          <p className="mt-1">Correct the source file or catalog identity, then preview again. Showing {samples.length} corrective samples.</p>
          <ul className="mt-3 space-y-2">
            {samples.map((item, index) => (
              <li key={`${item.identity}-${index}`}>
                <span className="font-medium">{item.identity}</span>: {item.reason}. Source rows {item.sourceRows.join(", ")}.
              </li>
            ))}
          </ul>
        </>
      ) : <p>{state.message}</p>}
    </div>
  );
}

function LatestEvidence({ evidence }: { evidence: LatestSisenseTrackSnapshotImport[] }) {
  return (
    <div className="space-y-3">
      <h3 className="font-medium">Latest dated Sisense track snapshot evidence</h3>
      {evidence.length === 0 ? (
        <p className="border border-[var(--border)] p-4 text-sm text-muted-foreground" role="status">
          No dated Sisense track snapshot imports recorded yet.
        </p>
      ) : (
        <div
          className="overflow-x-auto border border-[var(--border)]"
          role="region"
          tabIndex={0}
          aria-label="Latest dated Sisense track snapshot imports"
        >
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-muted-foreground">
                <th className="p-3">Artist</th>
                <th>Reporting context</th>
                <th>File</th>
                <th>Imported</th>
                <th>Counts</th>
                <th>SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {evidence.map((item) => (
                <tr key={item.artistId} className="border-b border-[var(--border)] align-top">
                  <td className="p-3 font-medium">{item.artistName}</td>
                  <td>{item.requestedDateRange} · {item.aggregation}</td>
                  <td>{item.fileName}</td>
                  <td>{formatImportedAt(item.importedAt)}</td>
                  <td>
                    {plural(item.counts.sourceRows, "source row")} · {item.counts.uniqueTracks.toLocaleString()} unique · {item.counts.matched.toLocaleString()} matched · {item.counts.unmatched.toLocaleString()} unmatched · {plural(item.counts.exactDuplicates, "exact duplicate")}
                  </td>
                  <td className="font-mono text-xs">{item.sha256.slice(0, 12)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-all">{value}</dd></div>;
}

function setErrorState(cause: unknown, setState: (state: ImportState) => void) {
  if (cause instanceof SisenseRequestError) {
    setState({
      kind: "error",
      message: cause.message,
      ambiguities: cause.ambiguities,
      totalAmbiguityCount: cause.totalAmbiguityCount,
    });
    return;
  }
  setState({
    kind: "error",
    message: cause instanceof Error && (
      cause.message === INVALID_PREVIEW_ERROR || cause.message === INVALID_APPLY_ERROR
    ) ? cause.message : GENERIC_ERROR,
    ambiguities: [],
    totalAmbiguityCount: 0,
  });
}

function applyMessage(result: SisenseTrackSnapshotApplyResult): string {
  if (result.kind === "duplicate") {
    return `Duplicate snapshot: no rows were written. The replay matched completed run ${result.runId}; the latest evidence shown below remains authoritative.`;
  }
  return `Import completed: ${result.inserted.toLocaleString()} imported (inserted), ${result.updated.toLocaleString()} updated, and ${result.unchanged.toLocaleString()} unchanged rows.`;
}

function isBoundPreview(value: unknown): value is BoundSisenseTrackSnapshotPreview {
  if (!isRecord(value) || value.kind !== "preview") return false;
  const hasShape = hasStrings(value, [
    "artistId",
    "artistName",
    "fileName",
    "requestedDateRange",
    "reportingFrom",
    "reportingThrough",
    "aggregation",
  ])
    && isLowercaseSha(value.sha256)
    && isLowercaseSha(value.previewFingerprint)
    && isCounts(value.counts)
    && isTotals(value.totals)
    && isIdentitySamples(value.identitySamples);
  if (!hasShape) return false;
  // SAFETY: the structural checks above have already verified every field of BoundSisenseTrackSnapshotPreview.
  return previewIsInternallyConsistent(value as unknown as BoundSisenseTrackSnapshotPreview);
}

function isBoundPreviewForSubmission(
  value: unknown,
  submitted: SubmittedPreview,
): value is BoundSisenseTrackSnapshotPreview {
  if (!isBoundPreview(value)) return false;
  return value.artistId === submitted.artistId
    && value.fileName === submitted.sanitizedFileName
    && value.sha256 === submitted.sha256
    && value.reportingFrom === submitted.reportingFrom
    && value.reportingThrough === submitted.reportingThrough
    && value.requestedDateRange === `${submitted.reportingFrom} to ${submitted.reportingThrough}`
    && value.aggregation === submitted.aggregation;
}

function isApplyResultForPreview(
  value: unknown,
  preview: BoundSisenseTrackSnapshotPreview,
): value is SisenseTrackSnapshotApplyResult {
  if (!isRecord(value) || !hasStrings(value, ["runId"]) || !isLatestEvidence(value.latest)) return false;
  const latest = value.latest;
  if (latest.artistId !== preview.artistId || latest.artistName !== preview.artistName) return false;
  if (value.kind === "duplicate") return true;
  if (
    latest.runId !== value.runId
    || latest.fileName !== preview.fileName
    || latest.sha256 !== preview.sha256
    || latest.reportingFrom !== preview.reportingFrom
    || latest.reportingThrough !== preview.reportingThrough
    || latest.requestedDateRange !== preview.requestedDateRange
    || latest.aggregation !== preview.aggregation
    || latest.rowCount !== preview.counts.sourceRows
    || !sameCounts(latest.counts, preview.counts)
    || !sameTotals(latest.totals, preview.totals)
  ) {
    return false;
  }
  const inserted = nonNegativeInteger(value.inserted);
  const updated = nonNegativeInteger(value.updated);
  const unchanged = nonNegativeInteger(value.unchanged);
  if (
    value.kind !== "imported"
    || inserted === null
    || updated === null
    || unchanged === null
  ) {
    return false;
  }
  return safeIntegerTotal([inserted, updated, unchanged]) === preview.counts.uniqueTracks;
}

function isLatestEvidence(value: unknown): value is LatestSisenseTrackSnapshotImport {
  if (!(isRecord(value)
    && hasStrings(value, [
      "artistId",
      "artistName",
      "runId",
      "fileName",
      "importedAt",
      "reportingFrom",
      "reportingThrough",
      "requestedDateRange",
      "aggregation",
    ])
    && isLowercaseSha(value.sha256)
    && nonNegativeInteger(value.rowCount) !== null
    && isCounts(value.counts)
    && isTotals(value.totals))) {
    return false;
  }
  return Number.isFinite(Date.parse(value.importedAt as string))
    && value.rowCount === value.counts.sourceRows
    && countsAreInternallyConsistent(value.counts);
}

function isCounts(value: unknown): value is BoundSisenseTrackSnapshotPreview["counts"] {
  return isRecord(value) && [
    "sourceRows",
    "uniqueTracks",
    "matched",
    "unmatched",
    "ambiguous",
    "exactDuplicates",
  ].every((key) => nonNegativeInteger(value[key]) !== null);
}

function isTotals(value: unknown): value is BoundSisenseTrackSnapshotPreview["totals"] {
  return isRecord(value)
    && nonNegativeInteger(value.combinedStreams) !== null
    && nonNegativeInteger(value.combinedViews) !== null;
}

function previewIsInternallyConsistent(preview: BoundSisenseTrackSnapshotPreview): boolean {
  if (!countsAreInternallyConsistent(preview.counts)) return false;
  const { items, total, truncated } = preview.identitySamples;
  if (total !== preview.counts.uniqueTracks) return false;
  if (truncated !== (items.length < total)) return false;
  const matchedSamples = items.filter((item) => item.matchStatus === "matched").length;
  const unmatchedSamples = items.length - matchedSamples;
  return matchedSamples <= preview.counts.matched && unmatchedSamples <= preview.counts.unmatched;
}

function countsAreInternallyConsistent(counts: BoundSisenseTrackSnapshotPreview["counts"]): boolean {
  return safeIntegerTotal([counts.uniqueTracks, counts.exactDuplicates]) === counts.sourceRows
    && counts.ambiguous === 0
    && safeIntegerTotal([counts.matched, counts.unmatched]) === counts.uniqueTracks;
}

function isIdentitySamples(value: unknown): value is BoundSisenseTrackSnapshotPreview["identitySamples"] {
  if (!isRecord(value) || !Array.isArray(value.items)) return false;
  const total = nonNegativeInteger(value.total);
  if (total === null || typeof value.truncated !== "boolean" || value.items.length > 20) return false;
  const sourceRows = new Set<number>();
  for (const item of value.items) {
    const sourceRow = isRecord(item) ? nonNegativeInteger(item.sourceRow) : null;
    if (!isRecord(item)
      || !hasStrings(item, ["trackTitle", "primaryArtist"])
      || sourceRow === null
      || sourceRow === 0
      || sourceRows.has(sourceRow)
      || (item.releaseTitle !== null && typeof item.releaseTitle !== "string")
      || (item.isrc !== null && typeof item.isrc !== "string")
      || (item.trackId !== null && typeof item.trackId !== "string")
      || (item.matchStatus !== "matched" && item.matchStatus !== "unmatched")) {
      return false;
    }
    if ([item.trackTitle, item.primaryArtist, item.releaseTitle, item.isrc]
      .some((text) => typeof text === "string" && text.length > 160)) return false;
    if ((item.matchStatus === "matched") !== (typeof item.trackId === "string" && Boolean(item.trackId.trim()))) {
      return false;
    }
    sourceRows.add(sourceRow);
  }
  return true;
}

function sameCounts(
  left: BoundSisenseTrackSnapshotPreview["counts"],
  right: BoundSisenseTrackSnapshotPreview["counts"],
): boolean {
  return left.sourceRows === right.sourceRows
    && left.uniqueTracks === right.uniqueTracks
    && left.matched === right.matched
    && left.unmatched === right.unmatched
    && left.ambiguous === right.ambiguous
    && left.exactDuplicates === right.exactDuplicates;
}

function sameTotals(
  left: BoundSisenseTrackSnapshotPreview["totals"],
  right: BoundSisenseTrackSnapshotPreview["totals"],
): boolean {
  return left.combinedStreams === right.combinedStreams
    && left.combinedViews === right.combinedViews;
}

function safeIntegerTotal(values: number[]): number | null {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || total > Number.MAX_SAFE_INTEGER - value) return null;
    total += value;
  }
  return total;
}

async function sha256File(file: File): Promise<string> {
  const bytes = typeof file.arrayBuffer === "function"
    ? new Uint8Array(await file.arrayBuffer())
    : new Uint8Array(await readFileWithFileReader(file));
  return bytesToHex(sha256(bytes));
}

function readFileWithFileReader(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The selected file could not be read"));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("The selected file could not be read"));
    };
    reader.readAsArrayBuffer(file);
  });
}

function sanitizeFileName(fileName: string): string {
  const sanitized = fileName
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "sisense-tracks-by-growth-rate.csv";
}

function updateEvidence(
  current: LatestSisenseTrackSnapshotImport[],
  result: SisenseTrackSnapshotApplyResult,
): LatestSisenseTrackSnapshotImport[] {
  const existing = current.find((item) => item.artistId === result.latest.artistId);
  if (result.kind === "duplicate" && existing) {
    const candidateTime = Date.parse(result.latest.importedAt);
    const existingTime = Date.parse(existing.importedAt);
    if (Number.isFinite(existingTime) && candidateTime <= existingTime) return current;
  }
  return [
    result.latest,
    ...current.filter((item) => item.artistId !== result.latest.artistId),
  ];
}

function ambiguitySamples(value: unknown): Ambiguity[] {
  if (!Array.isArray(value)) return [];
  const samples: Ambiguity[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate) || typeof candidate.identity !== "string" || typeof candidate.reason !== "string") {
      continue;
    }
    if (!Array.isArray(candidate.sourceRows)) continue;
    const sourceRows = candidate.sourceRows
      .map(nonNegativeInteger)
      .filter((row): row is number => row !== null)
      .slice(0, 10);
    samples.push({ identity: candidate.identity, reason: candidate.reason, sourceRows });
    if (samples.length === MAX_UI_AMBIGUITY_SAMPLES) break;
  }
  return samples;
}

function hasStrings(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => typeof value[key] === "string" && Boolean((value[key] as string).trim()));
}

function isLowercaseSha(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function plural(value: number, singular: string, pluralForm = `${singular}s`): string {
  return `${value.toLocaleString()} ${value === 1 ? singular : pluralForm}`;
}

function formatImportedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const controlClassName = "w-full border border-[var(--border)] bg-transparent px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50";
const buttonClassName = "rounded border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
