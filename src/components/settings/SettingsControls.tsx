"use client";

import type { ChangeEvent, ReactNode } from "react";
import { Check, Command, RefreshCw, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

import { NativeSelect } from "@/components/ui/native-select";
export function SectionIntro({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export function SettingsStatus({
  statusError,
  statusMessage,
  statusWarning = null,
}: {
  statusError: string | null;
  statusMessage: string | null;
  statusWarning?: string | null;
}) {
  if (!statusError && !statusMessage && !statusWarning) return null;

  return <div className="space-y-2">
    {statusMessage && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{statusMessage}</div>}
    {statusError && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{statusError}</div>}
    {statusWarning && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">{statusWarning}</div>}
  </div>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

export function Select({
  value,
  disabled,
  onChange,
  options,
}: {
  value: string;
  disabled?: boolean;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <NativeSelect
      value={value}
      disabled={disabled}
      onChange={onChange}
      className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </NativeSelect>
  );
}

export function ReadonlyField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate text-sm font-medium", mono && "font-mono")}>{value}</p>
    </div>
  );
}

export function ActionRow({
  isDirty,
  isSaving,
  saveLabel,
  onSave,
  onDiscard,
}: {
  isDirty: boolean;
  isSaving: boolean;
  saveLabel: string;
  onSave: () => Promise<void>;
  onDiscard: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      <Button type="button" onClick={() => void onSave()} disabled={!isDirty || isSaving}>
        <RefreshCw className={cn("size-4", isSaving && "animate-spin")} />
        {saveLabel}
      </Button>
      <Button type="button" variant="outline" onClick={onDiscard} disabled={!isDirty || isSaving}>
        Discard
      </Button>
    </div>
  );
}

export function SegmentedControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string; icon: LucideIcon }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((option) => {
          const Icon = option.icon;
          const active = option.value === value;
          return (
            <Button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={cn(
                "flex h-10 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors",
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              aria-pressed={active}
            >
              <Icon className="size-4" />
              {option.label}
              {active && <Check className="size-3.5" />}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

export function HotkeyRow({ label, shortcut }: { label: string; shortcut: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <Command className="size-4 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{label}</span>
      </div>
      <kbd className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
        {shortcut}
      </kbd>
    </div>
  );
}

export function SettingMetric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

export function humanizeSetting(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function initialsFor(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}
