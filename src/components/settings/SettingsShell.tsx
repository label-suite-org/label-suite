"use client";

import { useEffect, useState, type MouseEvent } from "react";
import {
  Building2,
  Globe2,
  LogOut,
  Moon,
  PanelLeft,
  ShieldCheck,
  SlidersHorizontal,
  SquareTerminal,
  Sun,
  UserRound,
  UsersRound,
} from "lucide-react";
import { signOut } from "../../lib/auth-client";
import { HOTKEYS, formatHotkey } from "../../lib/hotkeys";
import { cn } from "../../lib/utils";
import type { MembershipRole } from "../../server/tenant";
import type { ClientCapabilityMap } from "../../lib/client-capabilities";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card";
import { MemberSettings } from "./MemberSettings";
import { LocalToolTokenSettings, type LocalToolTokenClientRecord } from "./LocalToolTokenSettings";
import { OperationsSettings } from "./OperationsSettings";
import { PasskeySettings } from "./PasskeySettings";
import { HotkeyRow, SegmentedControl, SectionIntro, initialsFor } from "./SettingsControls";
import { WorkspaceSettings } from "./WorkspaceSettings";
import {
  CURRENT_SEQUENCE_YEAR,
  type SettingsInvitation,
  type SettingsMember,
  type SettingsOrg,
  type SettingsUser,
  type ThemeMode,
  type WorkspaceSettingsState,
} from "./settings-types";

export type { SettingsInvitation, SettingsMember } from "./settings-types";
export { MemberSettings, runSerializedAccessMutation } from "./MemberSettings";
export { SettingsStatus } from "./SettingsControls";

const sections = [
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "workspace", label: "Workspace", icon: Building2 },
  { id: "members", label: "Members", icon: UsersRound },
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
  { id: "operations", label: "Operations", icon: ShieldCheck },
  { id: "codex-tools", label: "Codex tools", icon: SquareTerminal },
] as const;

type SectionId = (typeof sections)[number]["id"];

type SettingsShellProps = {
  user: SettingsUser;
  org: SettingsOrg;
  role: MembershipRole;
  capabilities: ClientCapabilityMap;
  initialMembers: SettingsMember[];
  initialInvitations: SettingsInvitation[];
  initialLocalToolTokens: LocalToolTokenClientRecord[];
  initialSection?: SectionId;
};



function createDefaultWorkspaceSettings(org: SettingsOrg): WorkspaceSettingsState {
  return {
    name: org.name,
    legal_name: "",
    timezone: "Europe/Copenhagen",
    currency: "DKK",
    validation_sweep_mode: "manual",
    default_release_policy: "readiness_gates",
    catalog_prefix: "CAT",
    catalog_number_width: 3,
    isrc_country_code: "",
    isrc_registrant_code: "",
    isrc_prefix: null,
    isrc_config_source: "missing",
    sequence_year: CURRENT_SEQUENCE_YEAR,
    sequence_last_production_number: 0,
    next_isrc_preview: null,
  };
}

function normalizeWorkspaceSettings(
  org: SettingsOrg,
  value: Partial<WorkspaceSettingsState>,
): WorkspaceSettingsState {
  return {
    ...createDefaultWorkspaceSettings(org),
    ...value,
    name: value.name?.trim() || org.name,
    legal_name: value.legal_name ?? "",
    timezone: value.timezone ?? "Europe/Copenhagen",
    currency: (value.currency ?? "DKK").toUpperCase(),
    catalog_prefix: (value.catalog_prefix ?? "CAT").toUpperCase(),
    catalog_number_width: value.catalog_number_width ?? 3,
    isrc_country_code: (value.isrc_country_code ?? "").toUpperCase(),
    isrc_registrant_code: (value.isrc_registrant_code ?? "").toUpperCase(),
    sequence_year: value.sequence_year ?? CURRENT_SEQUENCE_YEAR,
    sequence_last_production_number: value.sequence_last_production_number ?? 0,
    next_isrc_preview: value.next_isrc_preview ?? null,
    isrc_prefix: value.isrc_prefix ?? null,
    isrc_config_source: value.isrc_config_source ?? "missing",
  };
}

function comparableWorkspaceSettings(value: WorkspaceSettingsState) {
  return JSON.stringify({
    name: value.name,
    legal_name: value.legal_name,
    timezone: value.timezone,
    currency: value.currency,
    validation_sweep_mode: value.validation_sweep_mode,
    default_release_policy: value.default_release_policy,
    catalog_prefix: value.catalog_prefix,
    catalog_number_width: value.catalog_number_width,
    isrc_country_code: value.isrc_country_code,
    isrc_registrant_code: value.isrc_registrant_code,
    sequence_year: value.sequence_year,
    sequence_last_production_number: value.sequence_last_production_number,
  });
}

export function SettingsShell({ user, org, role, capabilities, initialMembers, initialInvitations, initialLocalToolTokens, initialSection = "profile" }: SettingsShellProps) {
  const canManageLocalToolTokens = capabilities["operations.mutate"];
  const [activeSection, setActiveSection] = useState<SectionId>(
    initialSection === "codex-tools" && !canManageLocalToolTokens ? "profile" : initialSection,
  );
  const [localToolTokens, setLocalToolTokens] = useState<LocalToolTokenClientRecord[]>(initialLocalToolTokens);
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettingsState>(() => createDefaultWorkspaceSettings(org));
  const [savedWorkspaceSettings, setSavedWorkspaceSettings] = useState<WorkspaceSettingsState>(() => createDefaultWorkspaceSettings(org));
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [generatedIsrc, setGeneratedIsrc] = useState<string | null>(null);
  const [isLoadingWorkspaceSettings, setIsLoadingWorkspaceSettings] = useState(true);
  const [isSavingWorkspaceSettings, setIsSavingWorkspaceSettings] = useState(false);
  const [isLoadingSequence, setIsLoadingSequence] = useState(false);
  const [isGeneratingIsrc, setIsGeneratingIsrc] = useState(false);

  const canEditWorkspace = capabilities["workspace.manage_settings"];
  const isDirty = comparableWorkspaceSettings(workspaceSettings) !== comparableWorkspaceSettings(savedWorkspaceSettings);

  useEffect(() => {
    void loadWorkspaceSettings();
  }, []);

  async function loadWorkspaceSettings(
    sequenceYear = workspaceSettings.sequence_year,
    options?: { preserveDraft?: boolean },
  ) {
    const preserveDraft = options?.preserveDraft ?? false;

    setSettingsError(null);
    setSettingsMessage(null);
    setGeneratedIsrc(null);
    if (preserveDraft) {
      setIsLoadingSequence(true);
    } else {
      setIsLoadingWorkspaceSettings(true);
    }

    try {
      const response = await fetch(`/api/settings/workspace?sequenceYear=${sequenceYear}`);
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load workspace settings");
      }

      const nextSettings = normalizeWorkspaceSettings(org, payload);
      if (preserveDraft) {
        setWorkspaceSettings((current) => ({
          ...current,
          sequence_year: nextSettings.sequence_year,
          sequence_last_production_number: nextSettings.sequence_last_production_number,
          next_isrc_preview:
            current.isrc_prefix
              ? `${current.isrc_prefix}${String(nextSettings.sequence_year).slice(-2)}${String(nextSettings.sequence_last_production_number + 1).padStart(5, "0")}`
              : nextSettings.next_isrc_preview,
        }));
        setSavedWorkspaceSettings((current) => ({
          ...current,
          isrc_prefix: nextSettings.isrc_prefix,
          isrc_config_source: nextSettings.isrc_config_source,
          sequence_year: nextSettings.sequence_year,
          sequence_last_production_number: nextSettings.sequence_last_production_number,
          next_isrc_preview: nextSettings.next_isrc_preview,
        }));
      } else {
        setWorkspaceSettings(nextSettings);
        setSavedWorkspaceSettings(nextSettings);
      }
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Failed to load workspace settings");
    } finally {
      setIsLoadingWorkspaceSettings(false);
      setIsLoadingSequence(false);
    }
  }

  function updateWorkspaceSetting<K extends keyof WorkspaceSettingsState>(
    key: K,
    value: WorkspaceSettingsState[K],
  ) {
    setWorkspaceSettings((current) => {
      const next = { ...current, [key]: value };
      if (key === "isrc_country_code" || key === "isrc_registrant_code") {
        const countryCode = (key === "isrc_country_code" ? value : next.isrc_country_code) as string;
        const registrantCode = (key === "isrc_registrant_code" ? value : next.isrc_registrant_code) as string;
        next.isrc_prefix =
          countryCode.length === 2 && registrantCode.length === 3
            ? `${countryCode}${registrantCode}`
            : null;
        next.next_isrc_preview =
          next.isrc_prefix
            ? `${next.isrc_prefix}${String(next.sequence_year).slice(-2)}${String(next.sequence_last_production_number + 1).padStart(5, "0")}`
            : null;
      }
      if (key === "sequence_year" || key === "sequence_last_production_number") {
        next.next_isrc_preview =
          next.isrc_prefix
            ? `${next.isrc_prefix}${String(next.sequence_year).slice(-2)}${String(next.sequence_last_production_number + 1).padStart(5, "0")}`
            : null;
      }
      return next;
    });
    setSettingsError(null);
    setSettingsMessage(null);
    setGeneratedIsrc(null);
  }

  async function saveWorkspaceSettings() {
    setIsSavingWorkspaceSettings(true);
    setSettingsError(null);
    setSettingsMessage(null);
    setGeneratedIsrc(null);

    try {
      const response = await fetch("/api/settings/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: workspaceSettings.name.trim(),
          legal_name: workspaceSettings.legal_name.trim() || null,
          timezone: workspaceSettings.timezone.trim() || null,
          currency: workspaceSettings.currency.trim() || null,
          validation_sweep_mode: workspaceSettings.validation_sweep_mode,
          default_release_policy: workspaceSettings.default_release_policy,
          catalog_prefix: workspaceSettings.catalog_prefix.trim(),
          catalog_number_width: workspaceSettings.catalog_number_width,
          isrc_country_code: workspaceSettings.isrc_country_code.trim() || null,
          isrc_registrant_code: workspaceSettings.isrc_registrant_code.trim() || null,
          sequence_year: workspaceSettings.sequence_year,
          sequence_last_production_number: workspaceSettings.sequence_last_production_number,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save workspace settings");
      }

      const nextSettings = normalizeWorkspaceSettings(org, payload);
      setWorkspaceSettings(nextSettings);
      setSavedWorkspaceSettings(nextSettings);
      setSettingsMessage("Workspace settings saved.");
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Failed to save workspace settings");
    } finally {
      setIsSavingWorkspaceSettings(false);
    }
  }

  async function generateNextIsrc() {
    setIsGeneratingIsrc(true);
    setSettingsError(null);
    setSettingsMessage(null);
    setGeneratedIsrc(null);

    try {
      const response = await fetch("/api/settings/isrc/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: workspaceSettings.sequence_year }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to reserve the next ISRC");
      }

      setGeneratedIsrc(payload.isrc ?? null);
      await loadWorkspaceSettings(workspaceSettings.sequence_year, { preserveDraft: true });
      setSettingsMessage("Next ISRC reserved.");
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Failed to reserve the next ISRC");
    } finally {
      setIsGeneratingIsrc(false);
    }
  }

  function discardWorkspaceChanges() {
    setWorkspaceSettings(savedWorkspaceSettings);
    setSettingsError(null);
    setSettingsMessage(null);
    setGeneratedIsrc(null);
  }

  function selectSection(sectionId: SectionId, event?: MouseEvent<HTMLAnchorElement>) {
    event?.preventDefault();
    setActiveSection(sectionId);

    if (typeof window !== "undefined") {
      // SAFETY: wrap URL parsing so a malformed location cannot crash the handler.
      let nextUrl: URL;
      try {
        nextUrl = new URL(window.location.href);
      } catch {
        return;
      }
      nextUrl.searchParams.set("section", sectionId);
      window.history.replaceState(null, "", `${nextUrl.pathname}${nextUrl.search}`);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="space-y-6">
        <section className="space-y-2 border-b border-border pb-6">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Settings</p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Workspace settings</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">Manage account identity, workspace policy, member access, preferences, and operational controls.</p>
        </section>

        <nav className="flex gap-2 overflow-x-auto border-b border-border pb-2" role="tablist" aria-label="Settings sections">
          {sections.filter((section) => section.id !== "codex-tools" || canManageLocalToolTokens).map((section) => (
            <a
              key={section.id}
              href={`?section=${section.id}`}
              role="tab"
              aria-selected={activeSection === section.id}
              onClick={(event) => selectSection(section.id, event)}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                activeSection === section.id
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <section.icon className="size-4" />
              {section.label}
            </a>
          ))}
        </nav>

        <section className="min-w-0" aria-live="polite">
          {activeSection === "profile" && <ProfileSettings user={user} role={role} />}
          {activeSection === "workspace" && (
            <WorkspaceSettings
              org={org}
              role={role}
              settings={workspaceSettings}
              canEdit={canEditWorkspace}
              isLoading={isLoadingWorkspaceSettings}
              isLoadingSequence={isLoadingSequence}
              isSaving={isSavingWorkspaceSettings}
              isGenerating={isGeneratingIsrc}
              isDirty={isDirty}
              generatedIsrc={generatedIsrc}
              statusError={settingsError}
              statusMessage={settingsMessage}
              onChange={updateWorkspaceSetting}
              onSave={saveWorkspaceSettings}
              onDiscard={discardWorkspaceChanges}
              onGenerate={generateNextIsrc}
              onLoadSequence={() => loadWorkspaceSettings(workspaceSettings.sequence_year, { preserveDraft: true })}
            />
          )}
          {activeSection === "members" && <MemberSettings user={user} role={role} initialMembers={initialMembers} initialInvitations={initialInvitations} />}
          {activeSection === "preferences" && <PreferenceSettings />}
          {activeSection === "operations" && (
            <OperationsSettings
              canEdit={canEditWorkspace}
              settings={workspaceSettings}
              isLoading={isLoadingWorkspaceSettings}
              isSaving={isSavingWorkspaceSettings}
              isDirty={isDirty}
              statusError={settingsError}
              statusMessage={settingsMessage}
              onChange={updateWorkspaceSetting}
              onSave={saveWorkspaceSettings}
              onDiscard={discardWorkspaceChanges}
            />
          )}
          {activeSection === "codex-tools" && canManageLocalToolTokens && (
            <LocalToolTokenSettings tokens={localToolTokens} onTokensChange={setLocalToolTokens} canMutate />
          )}
        </section>
      </div>
    </div>
  );
}

function ProfileSettings({ user, role }: { user: SettingsUser; role: MembershipRole }) {
  const initials = initialsFor(user.name || user.email || "User");
  const displayName = user.name?.trim() || "Unnamed user";
  const email = user.email?.trim() || "No email";

  async function onSignOut() {
    await signOut();
    window.location.assign("/login");
  }

  return (
    <div className="space-y-4">
      <SectionIntro title="Profile" description="Account identity and session actions." />
      <Card>
        <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-foreground text-sm font-semibold text-background">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">{displayName}</p>
              <p className="truncate text-sm text-muted-foreground">{email}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="outline" className="capitalize">{role}</Badge>
                <Badge variant="secondary">Active session</Badge>
              </div>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={onSignOut}>
            <LogOut className="size-4" />
            Sign out
          </Button>
        </CardContent>
      </Card>
      <PasskeySettings />
    </div>
  );
}

function PreferenceSettings() {
  const [theme, setTheme] = useState<ThemeMode>("system");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const storedTheme = localStorage.getItem("dark-mode");
    setTheme(storedTheme === null ? "system" : storedTheme === "true" ? "dark" : "light");

    const sidebarCookie = document.cookie
      .split("; ")
      .find((row) => row.startsWith("sidebar_state="))
      ?.split("=")[1];
    setSidebarOpen(sidebarCookie === "true");
  }, []);

  function applyTheme(nextTheme: ThemeMode) {
    setTheme(nextTheme);
    const dark =
      nextTheme === "dark" ||
      (nextTheme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

    if (nextTheme === "system") {
      localStorage.removeItem("dark-mode");
    } else {
      localStorage.setItem("dark-mode", String(nextTheme === "dark"));
    }

    document.documentElement.classList.toggle("dark", dark);
    window.dispatchEvent(new CustomEvent("label-suite:theme-change", { detail: { mode: nextTheme } }));
  }

  function applySidebar(open: boolean) {
    setSidebarOpen(open);
    document.cookie = `sidebar_state=${open}; path=/; max-age=${60 * 60 * 24 * 7}`;
    window.dispatchEvent(new CustomEvent("label-suite:sidebar-state-change", { detail: { open } }));
  }

  return (
    <div className="space-y-4">
      <SectionIntro title="Preferences" description="Local app behavior for this browser." />
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Theme preference applies immediately.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SegmentedControl
            label="Theme"
            value={theme}
            options={[
              { value: "system", label: "System", icon: Globe2 },
              { value: "light", label: "Light", icon: Sun },
              { value: "dark", label: "Dark", icon: Moon },
            ]}
            onChange={(value) => applyTheme(value as ThemeMode)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sidebar</CardTitle>
          <CardDescription>Collapsed mode still auto-peeks on hover.</CardDescription>
        </CardHeader>
        <CardContent>
          <SegmentedControl
            label="Pinned state"
            value={sidebarOpen ? "open" : "collapsed"}
            options={[
              { value: "collapsed", label: "Collapsed", icon: PanelLeft },
              { value: "open", label: "Expanded", icon: PanelLeft },
            ]}
            onChange={(value) => applySidebar(value === "open")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Keyboard</CardTitle>
          <CardDescription>Canonical shortcuts used across the app shell.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          <HotkeyRow label={HOTKEYS.sidebarToggle.label} shortcut={formatHotkey(HOTKEYS.sidebarToggle)} />
          <HotkeyRow label={HOTKEYS.searchOpen.label} shortcut={formatHotkey(HOTKEYS.searchOpen)} />
        </CardContent>
      </Card>
    </div>
  );
}
