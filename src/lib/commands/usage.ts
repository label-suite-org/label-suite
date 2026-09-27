export type CommandUsage = {
  commandId: string;
  usedAt: string;
  count: number;
};

export type CommandUsageMap = Record<string, CommandUsage>;

const STORAGE_KEY = "label-suite.command-usage.v1";

export function readCommandUsage(storage: Pick<Storage, "getItem"> | undefined): CommandUsageMap {
  if (!storage) return {};

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CommandUsageMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function recordCommandUsage(
  usage: CommandUsageMap,
  commandId: string,
  now = new Date(),
): CommandUsageMap {
  const current = usage[commandId];

  return {
    ...usage,
    [commandId]: {
      commandId,
      usedAt: now.toISOString(),
      count: (current?.count ?? 0) + 1,
    },
  };
}

export function writeCommandUsage(storage: Pick<Storage, "setItem"> | undefined, usage: CommandUsageMap) {
  if (!storage) return;

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(usage));
  } catch {
    // Ignore storage quota/privacy failures; command navigation should still work.
  }
}

