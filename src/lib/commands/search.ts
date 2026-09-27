import type { CommandDefinition } from "./registry";
import type { CommandUsageMap } from "./usage";

export type CommandResult = CommandDefinition & {
  score: number;
  reason?: "exact" | "prefix" | "word" | "fuzzy" | "recent" | "frequent" | "context";
};

type CommandResultReason = NonNullable<CommandResult["reason"]>;

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function acronym(value: string) {
  return normalize(value)
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("");
}

function fuzzyScore(query: string, target: string) {
  let queryIndex = 0;
  let runLength = 0;
  let score = 0;

  for (const char of target) {
    if (char === query[queryIndex]) {
      queryIndex += 1;
      runLength += 1;
      score += 6 + runLength;
      if (queryIndex === query.length) break;
    } else {
      runLength = 0;
    }
  }

  return queryIndex === query.length ? score : 0;
}

function baseScore(command: CommandDefinition, query: string): { score: number; reason?: CommandResultReason } {
  if (!query) return { score: 10, reason: undefined };

  const fields = [command.title, command.subtitle, ...(command.keywords ?? [])].filter(Boolean);
  const normalizedFields = fields.map((field) => normalize(field ?? ""));
  const title = normalize(command.title);
  const titleAcronym = acronym(command.title);

  if (title === query) return { score: 1000, reason: "exact" as const };
  if (title.startsWith(query)) return { score: 850, reason: "prefix" as const };
  if (titleAcronym && titleAcronym.startsWith(query)) return { score: 780, reason: "word" as const };

  for (const field of normalizedFields) {
    if (field.split(" ").some((part) => part.startsWith(query))) {
      return { score: 720, reason: "word" as const };
    }
  }

  for (const field of normalizedFields) {
    if (field.includes(query)) {
      return { score: 620, reason: "fuzzy" as const };
    }
  }

  const fuzzy = Math.max(...normalizedFields.map((field) => fuzzyScore(query, field)), 0);
  return fuzzy > 0 ? { score: 420 + fuzzy, reason: "fuzzy" as const } : { score: 0, reason: undefined };
}

function usageBoost(commandId: string, usage: CommandUsageMap): { score: number; reason?: CommandResultReason } {
  const item = usage[commandId];
  if (!item) return { score: 0, reason: undefined };

  const ageMs = Date.now() - new Date(item.usedAt).getTime();
  const recency = Number.isFinite(ageMs) ? Math.max(0, 120 - ageMs / (1000 * 60 * 60 * 24)) : 0;
  const frequency = Math.min(80, item.count * 8);
  const reason: CommandResultReason = recency >= frequency ? "recent" : "frequent";

  return { score: recency + frequency, reason };
}

function contextBoost(command: CommandDefinition, currentPath?: string) {
  if (!currentPath || !command.href) return 0;
  if (command.href === currentPath) return 40;
  if (command.href.startsWith(`${currentPath}?`)) return 50;
  return 0;
}

export function searchCommands({
  commands,
  query,
  usage = {},
  currentPath,
  limit = 8,
}: {
  commands: readonly CommandDefinition[];
  query: string;
  usage?: CommandUsageMap;
  currentPath?: string;
  limit?: number;
}): CommandResult[] {
  const normalizedQuery = normalize(query);

  return commands
    .map((command) => {
      const base = baseScore(command, normalizedQuery);
      const usageScore = usageBoost(command.id, usage);
      const contextScore = contextBoost(command, currentPath);
      const score = base.score + usageScore.score + contextScore;
      const reason: CommandResult["reason"] = base.reason ?? (contextScore ? "context" : usageScore.reason);

      return { ...command, score, reason };
    })
    .filter((result) => result.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.title.localeCompare(b.title, "en", { sensitivity: "base" }) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

export function dedupeCommands<TCommand extends CommandDefinition>(commands: readonly TCommand[]): TCommand[] {
  const deduped = new Map<string, TCommand>();

  for (const command of commands) {
    if (!deduped.has(command.id)) {
      deduped.set(command.id, command);
    }
  }

  return [...deduped.values()];
}
