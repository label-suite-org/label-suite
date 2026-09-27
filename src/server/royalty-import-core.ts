import { createHash } from "node:crypto";

export const STEM_IMPORT_SOURCE = "stem";

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildImportId(orgId: string, source: string, checksum: string): string {
  return `royalty_import_${sha256(`${orgId}:${source}:${checksum}`).slice(0, 24)}`;
}

export function buildSourceRowId(checksum: string, rowIndex: number): string {
  return `${checksum.slice(0, 24)}:${rowIndex}`;
}

export function reportPeriod(year: number, month: number): string | null {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function endOfMonth(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
