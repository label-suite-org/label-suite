import type {
  ManagedField,
  ModuleName,
  SeedRegistry,
  SeedRegistryEntry,
  SeedRegistryIndex,
} from "./types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MODULE_NAMES = new Set<ModuleName>([
  "Product Confidence & Delivery",
  "Analytics & Forecasting",
  "Artists, Releases & Rights",
  "Directory & Campaigns",
  "Events, Tasks & Search",
  "Content, Assets & Budgets",
]);

const MANAGED_FIELDS = new Set<ManagedField>([
  "state",
  "priority",
  "module",
  "milestones",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`);
  return value;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value;
}

function loadIssueNumbers(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("issueNumbers must be a non-empty array");
  }

  const issueNumbers = value.map((issueNumber) => {
    if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
      throw new Error("issueNumbers must contain positive integers");
    }
    return issueNumber;
  });

  if (new Set(issueNumbers).size !== issueNumbers.length) {
    throw new Error("issueNumbers must not contain duplicates");
  }

  return issueNumbers;
}

function loadManagedFields(value: unknown): ManagedField[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("managedFields must be a non-empty array");
  }

  const managedFields = value.map((field) => {
    if (typeof field !== "string" || !MANAGED_FIELDS.has(field as ManagedField)) {
      throw new Error(`managedFields contains unsupported value: ${String(field)}`);
    }
    return field as ManagedField;
  });

  if (new Set(managedFields).size !== managedFields.length) {
    throw new Error("managedFields must not contain duplicates");
  }

  return managedFields;
}

function loadEntry(value: unknown): SeedRegistryEntry {
  const entry = requireRecord(value, "entry");
  const providedPlaneWorkItemId = requireString(entry.planeWorkItemId, "planeWorkItemId");
  if (!UUID_PATTERN.test(providedPlaneWorkItemId)) throw new Error("planeWorkItemId must be a UUID");
  const planeWorkItemId = providedPlaneWorkItemId.toLowerCase();

  const moduleName = requireString(entry.moduleName, "moduleName");
  if (!MODULE_NAMES.has(moduleName as ModuleName)) {
    throw new Error(`moduleName contains unsupported value: ${moduleName}`);
  }

  if (typeof entry.curatedTitle !== "boolean") {
    throw new Error("curatedTitle must be a boolean");
  }

  return {
    planeWorkItemId,
    issueNumbers: loadIssueNumbers(entry.issueNumbers),
    moduleName: moduleName as ModuleName,
    managedFields: loadManagedFields(entry.managedFields),
    curatedTitle: entry.curatedTitle,
  };
}

export function loadSeedRegistry(value: unknown): SeedRegistry {
  const rawRegistry = requireRecord(value, "registry");
  if (rawRegistry.version !== 1) throw new Error("registry version must equal 1");
  if (!Array.isArray(rawRegistry.entries)) throw new Error("registry entries must be an array");

  const entries = rawRegistry.entries.map(loadEntry);
  const planeWorkItemIds = new Set<string>();
  for (const entry of entries) {
    if (planeWorkItemIds.has(entry.planeWorkItemId)) {
      throw new Error("planeWorkItemId must be unique");
    }
    planeWorkItemIds.add(entry.planeWorkItemId);
  }

  return { version: 1, entries };
}

export function indexSeedRegistry(registry: SeedRegistry): SeedRegistryIndex {
  const byIssue = new Map<number, SeedRegistryEntry[]>();
  const byPlaneItem = new Map<string, SeedRegistryEntry>();

  for (const entry of registry.entries) {
    if (byPlaneItem.has(entry.planeWorkItemId)) {
      throw new Error("planeWorkItemId must be unique");
    }
    byPlaneItem.set(entry.planeWorkItemId, entry);

    for (const issueNumber of entry.issueNumbers) {
      const entries = byIssue.get(issueNumber);
      if (entries) {
        entries.push(entry);
      } else {
        byIssue.set(issueNumber, [entry]);
      }
    }
  }

  return { byIssue, byPlaneItem };
}
