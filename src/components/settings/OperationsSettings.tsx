"use client";

import { Clock3, Globe2, RefreshCw, WalletCards } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { JobQueuePanel } from "./JobQueuePanel";
import { ActionRow, Field, SectionIntro, Select, SettingMetric, SettingsStatus, humanizeSetting } from "./SettingsControls";
import type { WorkspaceSettingsState } from "./settings-types";

export function OperationsSettings({
  canEdit,
  settings,
  isLoading,
  isSaving,
  isDirty,
  statusError,
  statusMessage,
  onChange,
  onSave,
  onDiscard,
}: {
  canEdit: boolean;
  settings: WorkspaceSettingsState;
  isLoading: boolean;
  isSaving: boolean;
  isDirty: boolean;
  statusError: string | null;
  statusMessage: string | null;
  onChange: <K extends keyof WorkspaceSettingsState>(key: K, value: WorkspaceSettingsState[K]) => void;
  onSave: () => Promise<void>;
  onDiscard: () => void;
}) {
  return (
    <div className="space-y-4">
      <SectionIntro title="Operations" description="Defaults that shape release and validation workflows." />
      <SettingsStatus statusError={statusError} statusMessage={statusMessage} />
      <Card>
        <CardHeader>
          <CardTitle>Operational defaults</CardTitle>
          <CardDescription>
            {canEdit ? "These defaults apply across the active workspace." : "Your role is read-only for operational defaults."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Currency">
              <Input
                value={settings.currency}
                disabled={!canEdit || isLoading || isSaving}
                maxLength={8}
                onChange={(event) => onChange("currency", event.target.value.toUpperCase())}
                placeholder="DKK"
              />
            </Field>
            <Field label="Timezone">
              <Input
                value={settings.timezone}
                disabled={!canEdit || isLoading || isSaving}
                onChange={(event) => onChange("timezone", event.target.value)}
                placeholder="Europe/Copenhagen"
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Validation sweep">
              <Select
                value={settings.validation_sweep_mode}
                disabled={!canEdit || isLoading || isSaving}
                onChange={(event) => onChange("validation_sweep_mode", event.target.value as WorkspaceSettingsState["validation_sweep_mode"])}
                options={[
                  { value: "manual", label: "Manual" },
                  { value: "scheduled", label: "Scheduled" },
                  { value: "post_write", label: "Post-write" },
                ]}
              />
            </Field>
            <Field label="Release policy">
              <Select
                value={settings.default_release_policy}
                disabled={!canEdit || isLoading || isSaving}
                onChange={(event) => onChange("default_release_policy", event.target.value as WorkspaceSettingsState["default_release_policy"])}
                options={[
                  { value: "readiness_gates", label: "Readiness gates" },
                  { value: "flexible", label: "Flexible" },
                ]}
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <SettingMetric icon={WalletCards} label="Currency" value={settings.currency} />
            <SettingMetric icon={Globe2} label="Timezone" value={settings.timezone} />
            <SettingMetric icon={RefreshCw} label="Validation sweep" value={humanizeSetting(settings.validation_sweep_mode)} />
            <SettingMetric icon={Clock3} label="Release policy" value={humanizeSetting(settings.default_release_policy)} />
          </div>

          {canEdit && (
            <ActionRow
              isDirty={isDirty}
              isSaving={isSaving}
              saveLabel="Save operations"
              onSave={onSave}
              onDiscard={onDiscard}
            />
          )}
        </CardContent>
      </Card>
      {canEdit && <JobQueuePanel />}
    </div>
  );
}
