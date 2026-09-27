"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ArrowUpDown,
  Banknote,
  BarChart3,
  Building2,
  CalendarDays,
  CheckSquare,
  Clock3,
  ContactRound,
  CornerDownLeft,
  Disc3,
  DollarSign,
  FileSearch,
  FileText,
  Image,
  LayoutDashboard,
  Megaphone,
  Music,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Upload,
  UserRound,
  Users,
  UsersRound,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { HOTKEYS, formatHotkey, matchesHotkey } from "@/lib/hotkeys";
import { STATIC_COMMANDS, type CommandGroup } from "@/lib/commands/registry";
import {
  MIN_RECORD_SEARCH_QUERY_LENGTH,
  recordToCommand,
  type RecordSearchResult,
} from "@/lib/commands/records";
import { dedupeCommands, searchCommands, type CommandResult } from "@/lib/commands/search";
import {
  readCommandUsage,
  recordCommandUsage,
  writeCommandUsage,
  type CommandUsageMap,
} from "@/lib/commands/usage";
import { cn } from "@/lib/utils";
import { APP_NAV_ITEM_BY_ID, navItemHref } from "@/lib/navigation";
import { fetchRecordSearchResults } from "./record-search";

import { Button } from "@/components/ui/button";
const groupIcons: Record<CommandGroup, LucideIcon> = {
  navigation: LayoutDashboard,
  setting: Settings,
  action: Zap,
  record: FileSearch,
};

const navIcons: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  today: CalendarDays,
  "ops-tasks": CheckSquare,
  forecast: TrendingUp,
  analytics: BarChart3,
  artists: Users,
  releases: Disc3,
  works: Music,
  contacts: ContactRound,
  campaigns: Megaphone,
  "radio-plugging": Radio,
  "radio-stations": Radio,
  royalties: Banknote,
  "media-assets": Image,
  documents: FileText,
  budget: DollarSign,
};

const commandIcons: Record<string, LucideIcon> = {
  settings: Settings,
  "settings.profile": UserRound,
  "settings.workspace": Building2,
  "settings.members": UsersRound,
  "settings.preferences": SlidersHorizontal,
  "settings.operations": ShieldCheck,
  "action.new-artist": Plus,
  "action.new-release": Plus,
  "action.new-contact": Plus,
  "action.import-royalties": Upload,
  "action.readiness-sweep": RefreshCw,
};

const groupLabels: Record<CommandGroup, string> = {
  navigation: "Navigation",
  setting: "Settings",
  action: "Actions",
  record: "Records",
};

export function clampActiveIndex(activeIndex: number, resultsLength: number) {
  if (resultsLength <= 0) return 0;
  if (activeIndex < 0) return 0;
  if (activeIndex >= resultsLength) return resultsLength - 1;
  return activeIndex;
}

export function recordSearchStatusMessage(searchState: "idle" | "loading" | "empty" | "error") {
  if (searchState === "loading") return "Searching records.";
  if (searchState === "error") return "Record search is temporarily unavailable.";
  if (searchState === "empty") return "No record results found.";
  return "";
}

export function resolveCommandHref(command: Pick<CommandResult, "id" | "href">, currentUrl: string): string | undefined {
  if (command.id === "nav.forecast") return navItemHref(APP_NAV_ITEM_BY_ID.forecast, currentUrl);
  return command.href;
}

function reasonLabel(result: CommandResult) {
  if (result.reason === "recent") return "Recent";
  if (result.reason === "frequent") return "Frequent";
  if (result.reason === "context") return "Current";
  return groupLabels[result.group];
}

function iconForResult(result: CommandResult) {
  if (result.id.startsWith("nav.")) {
    const navId = result.id.replace("nav.", "");
    return navIcons[navId] ?? groupIcons.navigation;
  }

  return commandIcons[result.id] ?? groupIcons[result.group];
}

function subtitleForResult(result: CommandResult) {
  if (result.group === "navigation") return undefined;
  if (!result.subtitle || result.subtitle.startsWith("/")) return undefined;
  return result.subtitle;
}

export function CommandPalette() {
  const recordSearchStatusId = "command-palette-record-search-status";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [usage, setUsage] = useState<CommandUsageMap>({});
  const [currentPath, setCurrentPath] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [recordResults, setRecordResults] = useState<RecordSearchResult[]>([]);
  const [recordSearchState, setRecordSearchState] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const recordSearchRequestId = useRef(0);
  const searchQuery = useMemo(() => query.trim(), [query]);

  function openPalette() {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }

  useEffect(() => {
    setUsage(readCommandUsage(window.localStorage));
    setCurrentPath(window.location.pathname);
    setCurrentUrl(`${window.location.pathname}${window.location.search}`);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesHotkey(event, HOTKEYS.searchOpen)) return;

      event.preventDefault();
      openPalette();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const onOpenRequest = () => openPalette();

    window.addEventListener("label-suite:open-command-palette", onOpenRequest);
    return () => window.removeEventListener("label-suite:open-command-palette", onOpenRequest);
  }, []);

  useEffect(() => {
    if (!open) return;

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    if (!open || searchQuery.length < MIN_RECORD_SEARCH_QUERY_LENGTH) {
      setRecordResults([]);
      setRecordSearchState("idle");
      return;
    }

    const requestId = ++recordSearchRequestId.current;
    const controller = new AbortController();
    setRecordSearchState("loading");
    setRecordResults([]);
    const timer = window.setTimeout(async () => {
      const response = await fetchRecordSearchResults({
        query: searchQuery,
        isLatestRequest: () => requestId === recordSearchRequestId.current,
        signal: controller.signal,
      });

      if (response.status === "success") {
        setRecordResults(response.records);
        setRecordSearchState(response.records.length ? "idle" : "empty");
      } else if (response.status === "stale") {
        if (requestId !== recordSearchRequestId.current) return;
      } else if (response.status === "aborted") {
        if (requestId !== recordSearchRequestId.current) return;
        setRecordSearchState("idle");
      } else if (response.status === "error") {
        setRecordResults([]);
        setRecordSearchState("error");
      }
    }, 150);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, searchQuery]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePalette();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const dedupedCommands = useMemo(
    () => dedupeCommands([...STATIC_COMMANDS, ...recordResults.map(recordToCommand)]),
    [recordResults],
  );

  const results = useMemo(
    () =>
      searchCommands({
        commands: dedupedCommands,
        query: searchQuery,
        usage,
        currentPath,
        limit: 9,
      }),
    [currentPath, searchQuery, usage, dedupedCommands],
  );

  useEffect(() => {
    setActiveIndex((index) => clampActiveIndex(index, results.length));
  }, [results.length]);

  const activeResult = results[activeIndex];
  const recordSearchStatus = recordSearchStatusMessage(recordSearchState);

  function closePalette() {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
    setRecordResults([]);
    setRecordSearchState("idle");
    previousFocusRef.current?.focus();
  }

  function activateCommand(command: CommandResult | undefined) {
    if (!command) return;

    const nextUsage = recordCommandUsage(usage, command.id);
    setUsage(nextUsage);
    writeCommandUsage(window.localStorage, nextUsage);

    const href = resolveCommandHref(command, currentUrl);
    if (href) {
      window.location.assign(href);
      return;
    }

    closePalette();
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => clampActiveIndex(index + 1, results.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => clampActiveIndex(index - 1, results.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      activateCommand(activeResult);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/10 px-3 pt-[12vh] backdrop-blur-xs">
      <Button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close command palette"
        onClick={closePalette}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
      >
        <div className="flex h-14 items-center gap-3 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <h2 id="command-palette-title" className="sr-only">
            Command palette
          </h2>
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search pages, records, settings, and actions"
            role="combobox"
            aria-expanded={open}
            aria-label="Search commands"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-activedescendant={activeResult ? `command-${activeResult.id}` : undefined}
            aria-controls="command-palette-results"
            aria-describedby={recordSearchStatusId}
            className="h-11 border-0 px-0 text-base shadow-none focus-visible:ring-0 md:text-base"
          />
          <kbd className="hidden rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground sm:inline-flex">
            {formatHotkey(HOTKEYS.searchOpen)}
          </kbd>
        </div>

        <p id={recordSearchStatusId} role="status" aria-live="polite" className="sr-only">
          {recordSearchStatus}
        </p>
        <div
          id="command-palette-results"
          role="listbox"
          aria-label="Search results"
          aria-busy={recordSearchState === "loading"}
          aria-describedby={recordSearchStatusId}
          className="max-h-[min(520px,60vh)] overflow-y-auto p-2"
        >
          {results.length ? (
            <div className="grid gap-1">
              {results.map((result: CommandResult, index: number) => {
                const Icon = iconForResult(result);
                const subtitle = subtitleForResult(result);
                const selected = index === activeIndex;

                return (
                  <Button
                    id={`command-${result.id}`}
                    key={result.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => activateCommand(result)}
                    className={cn(
                      "flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                      selected ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-muted",
                    )}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{result.title}</span>
                      {subtitle && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {subtitle}
                        </span>
                      )}
                    </span>
                    <Badge variant={selected ? "secondary" : "outline"} className="hidden sm:inline-flex">
                      {reasonLabel(result)}
                    </Badge>
                  </Button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
              <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Sparkles className="size-4" />
              </div>
              <div>
                <p className="text-sm font-medium">
                  {recordSearchState === "loading" ? "Searching records…" : "No results found"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {recordSearchState === "error"
                    ? "Record search is temporarily unavailable."
                    : "Try a page, record, setting, or action name."}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ArrowUpDown className="size-3.5" />
            Move
          </span>
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft className="size-3.5" />
            Open
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock3 className="size-3.5" />
            Learns recents
          </span>
        </div>
      </section>
    </div>
  );
}
