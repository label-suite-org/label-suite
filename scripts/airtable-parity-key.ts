export function normalizeParityKey(table: string, label: string, value: string): string | null {
  let text = value.trim().toLowerCase();
  if (table === "Release Tracks" && label === "title") {
    text = text.replace(/\s*\[[^\]]+\]\s*$/, "");
  }
  if (!text) return null;
  return text
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function findFieldName(available: Set<string>, candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (available.has(candidate)) return candidate;
  }

  const lower = new Map([...available].map((field) => [field.toLowerCase(), field]));
  for (const candidate of candidates) {
    const exact = lower.get(candidate.toLowerCase());
    if (exact) return exact;
  }

  return null;
}

export function fieldValues(value: unknown): string[] {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) {
    return value.flatMap(fieldValues);
  }
  if (typeof value === "object") {
    return [JSON.stringify(value)];
  }
  return [String(value)];
}

export function sourceFieldName(fields: Record<string, unknown>, candidates: string[], available = new Set<string>()): string | null {
  return findFieldName(new Set(Object.keys(fields).filter(key => fieldValues(fields[key]).length > 0)), candidates)
    ?? findFieldName(new Set(Object.keys(fields)), candidates) ?? findFieldName(available, candidates);
}
