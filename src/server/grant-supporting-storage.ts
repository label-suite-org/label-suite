import { HttpError } from "./errors";

export function validateGrantSupportingStorageKey(orgId: string, applicationId: string, storageKey: string) {
  try {
    const expectedPrefix = `${tenantStorageKey(orgId, `grant-applications/${normalizeStorageSegment(applicationId)}`)}/attachments/`;
    const normalized = normalizeStorageKey(storageKey);
    if (!normalized.startsWith(expectedPrefix) || normalized.length === expectedPrefix.length) {
      throw new Error("Storage key does not match attachment context");
    }
    return normalized;
  } catch {
    throw new HttpError("Storage key does not match this grant application", 400);
  }
}

function tenantStorageKey(orgId: string, key: string): string {
  const safeOrgId = normalizeStorageSegment(orgId);
  const normalized = normalizeStorageKey(key);
  if (normalized === safeOrgId || normalized.startsWith(`${safeOrgId}/`)) return normalized;
  return `${safeOrgId}/${normalized}`;
}

function normalizeStorageKey(key: string): string {
  const normalized = key
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");

  if (!normalized || normalized.includes("..")) {
    throw new Error("Invalid storage key");
  }

  return normalized;
}

function normalizeStorageSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]/g, "-");
  if (!normalized) {
    throw new Error("Invalid storage org");
  }
  return normalized;
}
