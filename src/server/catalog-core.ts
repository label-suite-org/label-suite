export type CatalogEntryKind = "release" | "cd" | "lp" | "video";

export type CatalogOrderingEntry = {
  id: string;
  entry_type: CatalogEntryKind;
  release_date: string | null;
  sort_position: number;
  created_at: string | Date;
  catalog_number: string | null;
  catalog_number_locked: boolean;
};

export type CatalogNumberConfig = {
  prefix: string;
  width: number;
};

export function compareCatalogEntries(a: CatalogOrderingEntry, b: CatalogOrderingEntry): number {
  const aDate = normalizedDate(a.release_date);
  const bDate = normalizedDate(b.release_date);

  if (aDate && bDate) {
    const dateComparison = aDate.localeCompare(bDate);
    if (dateComparison) return dateComparison;
  } else if (aDate) {
    return -1;
  } else if (bDate) {
    return 1;
  }

  const positionComparison = a.sort_position - b.sort_position;
  if (positionComparison) return positionComparison;

  const createdComparison = createdAtTime(a.created_at) - createdAtTime(b.created_at);
  if (createdComparison) return createdComparison;

  return a.id.localeCompare(b.id);
}

export function formatCatalogNumber(
  config: CatalogNumberConfig,
  number: number,
  suffix = "",
): string {
  const prefix = config.prefix.trim().toUpperCase();
  if (!prefix || !/^[A-Z0-9_-]+$/.test(prefix)) {
    throw new Error("Catalog prefix must contain only letters, numbers, underscores, or hyphens");
  }
  if (!Number.isInteger(config.width) || config.width < 1 || config.width > 12) {
    throw new Error("Catalog number width must be between 1 and 12");
  }
  if (!Number.isInteger(number) || number < 1) {
    throw new Error("Catalog number must be a positive integer");
  }
  if (suffix && !/^[A-Z]+$/.test(suffix)) {
    throw new Error("Catalog number suffix must contain only uppercase letters");
  }

  return `${prefix}${String(number).padStart(config.width, "0")}${suffix}`;
}

export function buildCatalogNumberPlan(
  entries: CatalogOrderingEntry[],
  config: CatalogNumberConfig,
): Map<string, string> {
  const ordered = [...entries].sort(compareCatalogEntries);
  const plan = new Map<string, string>();
  const occupied = new Set<string>();

  for (const entry of ordered) {
    if (!entry.catalog_number_locked || !entry.catalog_number) continue;
    if (occupied.has(entry.catalog_number)) {
      throw new Error(`Duplicate locked catalog number: ${entry.catalog_number}`);
    }
    occupied.add(entry.catalog_number);
    plan.set(entry.id, entry.catalog_number);
  }

  for (const [index, entry] of ordered.entries()) {
    if (entry.catalog_number_locked && entry.catalog_number) continue;

    const number = index + 1;
    const base = formatCatalogNumber(config, number);
    if (!occupied.has(base)) {
      occupied.add(base);
      plan.set(entry.id, base);
      continue;
    }

    let suffixIndex = 0;
    let candidate = formatCatalogNumber(config, number, alphabeticSuffix(suffixIndex));
    while (occupied.has(candidate)) {
      suffixIndex += 1;
      candidate = formatCatalogNumber(config, number, alphabeticSuffix(suffixIndex));
    }
    occupied.add(candidate);
    plan.set(entry.id, candidate);
  }

  return plan;
}

function normalizedDate(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function createdAtTime(value: string | Date): number {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function alphabeticSuffix(index: number): string {
  let value = index + 1;
  let suffix = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    suffix = String.fromCharCode(65 + remainder) + suffix;
    value = Math.floor((value - 1) / 26);
  }
  return suffix;
}
