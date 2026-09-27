import { PermanentSyncError } from "./errors.js";

const MANAGED_MARKER = /<!-- plane-sync:([a-z0-9-]+):(start|end) -->/g;

function markers(key: string): { start: string; end: string } {
  if (!/^[a-z0-9-]+$/.test(key)) throw new PermanentSyncError("plane_managed_section_key_invalid");
  return {
    start: `<!-- plane-sync:${key}:start -->`,
    end: `<!-- plane-sync:${key}:end -->`,
  };
}

function validateManagedMarkers(html: string): void {
  const stack: string[] = [];
  const seenStarts = new Set<string>();
  for (const match of html.matchAll(MANAGED_MARKER)) {
    const key = match[1]!;
    const boundary = match[2]!;
    if (boundary === "start") {
      if (stack.length > 0) throw new PermanentSyncError("plane_managed_section_malformed");
      if (seenStarts.has(key)) throw new PermanentSyncError("plane_managed_section_ambiguous");
      seenStarts.add(key);
      stack.push(key);
      continue;
    }
    if (stack.pop() !== key) throw new PermanentSyncError("plane_managed_section_malformed");
  }
  if (stack.length > 0) throw new PermanentSyncError("plane_managed_section_malformed");
}

export function replaceManagedSection(existingHtml: string, key: string, replacementHtml: string): string {
  const { start, end } = markers(key);
  validateManagedMarkers(existingHtml);
  if (MANAGED_MARKER.test(replacementHtml)) {
    MANAGED_MARKER.lastIndex = 0;
    throw new PermanentSyncError("plane_managed_section_malformed");
  }
  MANAGED_MARKER.lastIndex = 0;
  const startIndex = existingHtml.indexOf(start);
  const endIndex = existingHtml.indexOf(end);
  if (startIndex === -1 && endIndex === -1) return `${existingHtml}${start}${replacementHtml}${end}`;
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new PermanentSyncError("plane_managed_section_malformed");
  }
  const secondStart = existingHtml.indexOf(start, startIndex + start.length);
  const secondEnd = existingHtml.indexOf(end, endIndex + end.length);
  if (secondStart !== -1 && secondStart < endIndex) throw new PermanentSyncError("plane_managed_section_malformed");
  if (secondStart !== -1 || secondEnd !== -1) throw new PermanentSyncError("plane_managed_section_ambiguous");
  return `${existingHtml.slice(0, startIndex + start.length)}${replacementHtml}${existingHtml.slice(endIndex)}`;
}

export function managedSectionContent(existingHtml: string, key: string): string | null {
  const { start, end } = markers(key);
  validateManagedMarkers(existingHtml);
  const startIndex = existingHtml.indexOf(start);
  const endIndex = existingHtml.indexOf(end);
  if (startIndex === -1 && endIndex === -1) return null;
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new PermanentSyncError("plane_managed_section_malformed");
  }
  return existingHtml.slice(startIndex + start.length, endIndex);
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "'":
        return "&#39;";
      case '"':
        return "&quot;";
      default:
        return character;
    }
  });
}
