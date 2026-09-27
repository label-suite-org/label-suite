// Validates and opens an absolute URL in a new tab.
// Only https/http URLs are allowed, and the anchor uses rel="noopener noreferrer"
// so the opened page cannot access window.opener.

export function isSafeExternalUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function openExternalUrl(value: unknown): boolean {
  if (typeof window === "undefined" || !isSafeExternalUrl(value)) return false;
  const anchor = document.createElement("a");
  anchor.href = value;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
}
