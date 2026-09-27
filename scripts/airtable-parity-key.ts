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
