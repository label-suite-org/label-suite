"use client";

import { useState, useRef, useCallback } from "react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
interface ParsedRow {
  record_name: string;
  statement_period: string | null;
  source: string | null;
  gross_revenue: number | null;
  costs: number | null;
  net_revenue: number | null;
  paid_out: string | null;
  payment_date: string | null;
  notes: string | null;
  revenue_type: string | null;
}

export function StatementImport({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [dragOver, setDragOver] = useState(false);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);
  const [error, setError] = useState("");
  const [stemResult, setStemResult] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const detectDelimiter = useCallback((header: string): string => {
    if (header.includes("\t")) return "\t";
    return ",";
  }, []);

  const parseNumber = useCallback((val: string): number | null => {
    const cleaned = val.replace(/[$€£,\s]/g, "").trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    return isNaN(n) ? null : n;
  }, []);

  const autoDetectColumn = useCallback(
    (headers: string[]): { trackIdx: number; isrcIdx: number; streamsIdx: number; revenueIdx: number } => {
      let trackIdx = -1,
        isrcIdx = -1,
        streamsIdx = -1,
        revenueIdx = -1;

      const hl = headers.map((h) => h.toLowerCase().trim());

      for (let i = 0; i < hl.length; i++) {
        const h = hl[i];
        if (/track|song|title|record_name|record name/i.test(h) && trackIdx === -1) trackIdx = i;
        if (/(^isrc$|^isrc\b)/i.test(h) && isrcIdx === -1) isrcIdx = i;
        if (/streams|plays|count|listens/i.test(h) && streamsIdx === -1) streamsIdx = i;
        if (/revenue|income|earnings|amount|net|gross|royalty/i.test(h) && revenueIdx === -1) revenueIdx = i;
      }

      return { trackIdx, isrcIdx, streamsIdx, revenueIdx };
    },
    [],
  );

  const parseCSV = useCallback(
    (text: string) => {
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) {
        setError("CSV must have a header row and at least one data row.");
        return;
      }

      const delimiter = detectDelimiter(lines[0]);
      const headers = lines[0].split(delimiter).map((h) => h.trim().replace(/^["']|["']$/g, ""));

      const { trackIdx, isrcIdx, streamsIdx, revenueIdx } = autoDetectColumn(headers);

      if (trackIdx === -1) {
        setError("Could not find a 'Track' or 'Record Name' column in the CSV. Expected columns: track, ISRC, streams, revenue");
        return;
      }

      const rows: ParsedRow[] = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(delimiter).map((c) => c.trim().replace(/^["']|["']$/g, ""));
        if (cols.length <= trackIdx) continue;

        const trackName = cols[trackIdx] || `Row ${i}`;
        const streams = streamsIdx >= 0 ? parseNumber(cols[streamsIdx]) : null;
        const revenue = revenueIdx >= 0 ? parseNumber(cols[revenueIdx]) : null;

        rows.push({
          record_name: trackName,
          statement_period: null,
          source: null,
          gross_revenue: revenue,
          costs: null,
          net_revenue: revenue,
          paid_out: "unpaid",
          payment_date: null,
          notes: isrcIdx >= 0 && cols[isrcIdx] ? `ISRC: ${cols[isrcIdx]}` + (streams === null ? "" : ` | Streams: ${streams}`) : streams === null ? null : `Streams: ${streams}`,
          revenue_type: "streaming",
        });
      }

      if (!rows.length) {
        setError("No rows could be parsed. Check your CSV format.");
        return;
      }

      setParsedRows(rows);
      setError("");
    },
    [detectDelimiter, parseNumber, autoDetectColumn],
  );

  const handleFile = useCallback(
    (file: File) => {
      setError("");
      const lowerName = file.name.toLowerCase();

      if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
        setError("XLSX import is disabled for safety. Export the statement as CSV or TSV and upload that file.");
        return;
      }

      if (!lowerName.endsWith(".csv") && !lowerName.endsWith(".tsv") && !lowerName.endsWith(".txt")) {
        setError("Please upload a CSV or TSV file.");
        return;
      }

      if (lowerName.endsWith(".tsv") || lowerName.includes("stem")) {
        handleStemExport(file);
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        parseCSV(text);
      };
      reader.onerror = () => setError("Failed to read file.");
      reader.readAsText(file);
    },
    [parseCSV],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => setDragOver(false), []);

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  async function doImport() {
    if (!parsedRows.length) return;
    setImporting(true);
    setError("");
    try {
      const res = await fetch("/api/royalties/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsedRows }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Import failed");
      }
      setImported(true);
      onImported();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  async function handleStemExport(file: File) {
    setImporting(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/royalties/import-stem", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Import failed");
      }

      const result = await res.json();
      setStemResult(result);
      setImported(true);
      onImported();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-4">
      {!parsedRows.length && !imported ? (
        <>
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
              dragOver ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/50"
            }`}
          >
            <svg className="mx-auto w-10 h-10 text-muted-foreground mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm font-medium text-foreground">
              Drag & drop a CSV or TSV file here, or click to browse
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Expected columns: Track/Record Name, ISRC, Streams, Revenue. STEM exports: use CSV or TSV.
            </p>
            <Input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.txt"
              onChange={onFileSelect}
              className="hidden"
            />
          </div>
        </>
      ) : imported ? (
        <div className="text-center py-8">
          <svg className="mx-auto w-12 h-12 text-green-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-lg font-medium text-foreground">Import complete!</p>
          {stemResult ? (
            <div className="text-sm text-muted-foreground mt-1 space-y-1">
              <p>{stemResult.rows_imported} aggregated rows from {stemResult.rows_parsed} STEM rows</p>
              <p>{stemResult.isrcs_matched} of {stemResult.isrcs_total} ISRCs matched to works</p>
              <p className="font-medium text-foreground">Total: ${Number(stemResult.total_net).toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground mt-1">{parsedRows.length} royalty rows imported.</p>
          )}
          <Button onClick={onClose} className="mt-4 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:opacity-90">
            Done
          </Button>
        </div>
      ) : (
        <>
          <div className="bg-muted/30 border border-border rounded-xl p-4">
            <p className="text-sm font-medium text-foreground mb-1">
              {parsedRows.length} row{parsedRows.length === 1 ? "" : "s"} parsed
            </p>
            <p className="text-xs text-muted-foreground">
              {parsedRows[0]?.record_name ? `First: ${parsedRows[0].record_name}` : ""}
              {parsedRows[0]?.net_revenue == null ? "" : ` — $${Number(parsedRows[0].net_revenue).toFixed(2)}`}
            </p>
          </div>

          <div className="max-h-60 overflow-y-auto border border-border rounded-xl divide-y divide-border">
            {parsedRows.slice(0, 50).map((row, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="truncate flex-1">{row.record_name}</span>
                <span className="text-muted-foreground shrink-0 ml-2">
                  {row.net_revenue == null ? "—" : `$${Number(row.net_revenue).toFixed(2)}`}
                </span>
              </div>
            ))}
            {parsedRows.length > 50 && (
              <p className="px-4 py-2 text-xs text-muted-foreground text-center">
                … and {parsedRows.length - 50} more rows
              </p>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2 justify-end">
            <Button
              onClick={() => { setParsedRows([]); setError(""); }}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={doImport}
              disabled={importing}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {importing ? "Importing…" : `Import ${parsedRows.length} Row${parsedRows.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
