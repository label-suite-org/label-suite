"use client";

import { RefreshCw, WandSparkles } from "lucide-react";
import type { MembershipRole } from "../../server/tenant";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { ActionRow, Field, ReadonlyField, SectionIntro, SettingsStatus } from "./SettingsControls";
import { CURRENT_SEQUENCE_YEAR, type SettingsOrg, type WorkspaceSettingsState } from "./settings-types";

export function WorkspaceSettings({
  org,
  role,
  settings,
  canEdit,
  isLoading,
  isLoadingSequence,
  isSaving,
  isGenerating,
  isDirty,
  generatedIsrc,
  statusError,
  statusMessage,
  onChange,
  onSave,
  onDiscard,
  onGenerate,
  onLoadSequence,
}: {
  org: SettingsOrg;
  role: MembershipRole;
  settings: WorkspaceSettingsState;
  canEdit: boolean;
  isLoading: boolean;
  isLoadingSequence: boolean;
  isSaving: boolean;
  isGenerating: boolean;
  isDirty: boolean;
  generatedIsrc: string | null;
  statusError: string | null;
  statusMessage: string | null;
  onChange: <K extends keyof WorkspaceSettingsState>(key: K, value: WorkspaceSettingsState[K]) => void;
  onSave: () => Promise<void>;
  onDiscard: () => void;
  onGenerate: () => Promise<void>;
  onLoadSequence: () => void;
}) {
  const generatorBlocked = !canEdit || isDirty || !settings.isrc_prefix;

  return (
    <div className="space-y-4">
      <SectionIntro title="Workspace" description="Workspace identity and ISRC allocation rules." />
      <SettingsStatus statusError={statusError} statusMessage={statusMessage} />

      <Card>
        <CardHeader>
          <CardTitle>Workspace identity</CardTitle>
          <CardDescription>
            {canEdit ? "Owners and operators can keep workspace metadata and label details current here." : "Your role is read-only for workspace metadata."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Workspace name">
              <Input
                value={settings.name}
                disabled={!canEdit || isLoading || isSaving}
                onChange={(event) => onChange("name", event.target.value)}
                placeholder="True Nature"
              />
            </Field>
            <Field label="Legal label name">
              <Input
                value={settings.legal_name}
                disabled={!canEdit || isLoading || isSaving}
                onChange={(event) => onChange("legal_name", event.target.value)}
                placeholder="True Nature Records ApS"
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <ReadonlyField label="Slug" value={org.slug} />
            <ReadonlyField label="Workspace ID" value={org.id} mono />
            <ReadonlyField label="Plan" value={org.plan ?? "internal"} />
            <ReadonlyField label="Current role" value={role} />
          </div>

          {canEdit && (
            <ActionRow
              isDirty={isDirty}
              isSaving={isSaving}
              saveLabel="Save workspace"
              onSave={onSave}
              onDiscard={onDiscard}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Catalog numbering</CardTitle>
          <CardDescription>
            Set the shared prefix and padding used for new chronological catalog entries. Existing locked numbers are never rewritten.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
            <Field label="Catalog prefix">
              <Input
                value={settings.catalog_prefix}
                disabled={!canEdit || isLoading || isSaving}
                maxLength={16}
                onChange={(event) => onChange("catalog_prefix", event.target.value.toUpperCase())}
                placeholder="TN"
              />
            </Field>
            <Field label="Number width">
              <Input
                type="number"
                min={1}
                max={12}
                value={String(settings.catalog_number_width)}
                disabled={!canEdit || isLoading || isSaving}
                onChange={(event) => onChange("catalog_number_width", Number(event.target.value || 3))}
              />
            </Field>
          </div>
          <p className="font-mono text-sm text-muted-foreground">Preview: {settings.catalog_prefix}{String(1).padStart(settings.catalog_number_width, "0")}</p>
          {canEdit && (
            <ActionRow
              isDirty={isDirty}
              isSaving={isSaving}
              saveLabel="Save catalog settings"
              onSave={onSave}
              onDiscard={onDiscard}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ISRC generator</CardTitle>
          <CardDescription>
            Save the label prefix and current sequence so future generation stays collision-safe across the workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Country code">
              <Input
                value={settings.isrc_country_code}
                disabled={!canEdit || isLoading || isSaving}
                maxLength={2}
                onChange={(event) => onChange("isrc_country_code", event.target.value.toUpperCase())}
                placeholder="DK"
              />
            </Field>
            <Field label="Registrant code">
              <Input
                value={settings.isrc_registrant_code}
                disabled={!canEdit || isLoading || isSaving}
                maxLength={3}
                onChange={(event) => onChange("isrc_registrant_code", event.target.value.toUpperCase())}
                placeholder="O7P"
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="grid gap-4 md:grid-cols-2">
              <ReadonlyField label="Active prefix" value={settings.isrc_prefix ?? "Not configured"} mono />
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs font-medium text-muted-foreground">Config source</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {settings.isrc_config_source === "workspace" && <Badge variant="secondary">Workspace</Badge>}
                  {settings.isrc_config_source === "legacy-true-nature" && <Badge variant="outline">Legacy True Nature fallback</Badge>}
                  {settings.isrc_config_source === "missing" && <Badge variant="outline">Missing</Badge>}
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">Next code preview</p>
              <p className="mt-1 font-mono text-sm">{settings.next_isrc_preview ?? "Save prefix details to preview the next ISRC."}</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto]">
            <Field label="Sequence year">
              <Input
                type="number"
                min={1900}
                max={9999}
                value={String(settings.sequence_year)}
                disabled={!canEdit || isLoading || isSaving}
                onChange={(event) => onChange("sequence_year", Number(event.target.value || CURRENT_SEQUENCE_YEAR))}
              />
            </Field>
            <Field label="Last assigned designation">
              <Input
                type="number"
                min={0}
                max={99999}
                value={String(settings.sequence_last_production_number)}
                disabled={!canEdit || isLoading || isSaving}
                onChange={(event) => onChange("sequence_last_production_number", Number(event.target.value || 0))}
              />
            </Field>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                disabled={!canEdit || isLoading || isSaving || isLoadingSequence}
                onClick={onLoadSequence}
              >
                <RefreshCw className={cn("size-4", isLoadingSequence && "animate-spin")} />
                Load year
              </Button>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Set this to the last designation already issued for the selected year so the generator starts after your historical catalog instead of colliding with it.
          </p>

          {generatedIsrc && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Reserved ISRC</p>
              <p className="mt-1 font-mono text-base font-semibold text-foreground">{generatedIsrc}</p>
            </div>
          )}

          {generatorBlocked && canEdit && (
            <p className="text-sm text-muted-foreground">
              {isDirty ? "Save or discard your ISRC changes before reserving the next code." : "Add a country code and registrant code before reserving an ISRC."}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            {canEdit && (
              <ActionRow
                isDirty={isDirty}
                isSaving={isSaving}
                saveLabel="Save ISRC settings"
                onSave={onSave}
                onDiscard={onDiscard}
              />
            )}
            <Button
              type="button"
              variant="outline"
              disabled={generatorBlocked || isGenerating || isSaving}
              onClick={onGenerate}
            >
              <WandSparkles className={cn("size-4", isGenerating && "animate-pulse")} />
              Reserve next ISRC
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
