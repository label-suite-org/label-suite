"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

type CampaignAudienceRules = {
  include_contact_roles: string[];
  exclude_contact_roles: string[];
  require_contact_email: boolean;
  exclude_contact_ids: string[];
  include_station_states: string[];
  exclude_station_states: string[];
  require_station_email: boolean;
  exclude_station_ids: string[];
};

type CampaignAudienceOption = {
  id: string;
  name: string;
  description: string | null;
  membership_rules: CampaignAudienceRules;
};

type CampaignAudienceResolvedMember = {
  id: string;
  name: string;
  detail: string;
  status: "included" | "excluded";
  reason: string;
};

type CampaignAudiencePreview = {
  audience_id: string;
  audience_name: string;
  audience_description: string | null;
  counts: {
    included_contacts: number;
    excluded_contacts: number;
    included_stations: number;
    excluded_stations: number;
    explicit_contact_members: number;
    explicit_station_members: number;
  };
  included_contacts: CampaignAudienceResolvedMember[];
  excluded_contacts: CampaignAudienceResolvedMember[];
  included_stations: CampaignAudienceResolvedMember[];
  excluded_stations: CampaignAudienceResolvedMember[];
};

type AudienceSelection = {
  campaign_audience_id: string;
  preview: CampaignAudiencePreview;
};

type CampaignAudienceContact = {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  company: string | null;
};

type CampaignAudienceStation = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  email: string | null;
};

type CampaignAudienceManagerProps = {
  campaignId: string;
  options: CampaignAudienceOption[];
  contactOptions: CampaignAudienceContact[];
  stationOptions: CampaignAudienceStation[];
  currentSelection: AudienceSelection | null;
  canMutate: boolean;
};

export default function CampaignAudienceManager({
  campaignId,
  options,
  contactOptions,
  stationOptions,
  currentSelection,
  canMutate,
}: CampaignAudienceManagerProps) {
  const [audiences, setAudiences] = useState<CampaignAudienceOption[]>(options);
  const [selectedAudienceId, setSelectedAudienceId] = useState(
    currentSelection?.campaign_audience_id ?? "",
  );
  const [preview, setPreview] = useState<CampaignAudiencePreview | null>(
    currentSelection?.preview ?? null,
  );
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [savingName, setSavingName] = useState("");
  const [savingDescription, setSavingDescription] = useState("");
  const [includeContactRoles, setIncludeContactRoles] = useState("");
  const [excludeContactRoles, setExcludeContactRoles] = useState("");
  const [includeStationStates, setIncludeStationStates] = useState("");
  const [excludeStationStates, setExcludeStationStates] = useState("");
  const [requireContactEmail, setRequireContactEmail] = useState(true);
  const [requireStationEmail, setRequireStationEmail] = useState(true);
  const [contactExcludeIds, setContactExcludeIds] = useState<string[]>([]);
  const [contactMemberIds, setContactMemberIds] = useState<string[]>([]);
  const [stationExcludeIds, setStationExcludeIds] = useState<string[]>([]);
  const [stationMemberIds, setStationMemberIds] = useState<string[]>([]);

  useEffect(() => {
    if (!selectedAudienceId || !canMutate) {
      return;
    }
    void loadPreview(selectedAudienceId);
  }, [selectedAudienceId, canMutate]);

  const selectedAudience = useMemo(
    () =>
      audiences.find((audience) => audience.id === selectedAudienceId) ?? null,
    [audiences, selectedAudienceId],
  );

  async function loadPreview(audienceId: string) {
    const response = await fetch(
      `/api/campaign-audiences/${encodeURIComponent(audienceId)}`,
    );
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || "Could not load audience preview");
    }
    const next = (await response.json()) as CampaignAudiencePreview;
    setPreview(next);
  }

  async function withMutation<T>(callback: () => Promise<T>): Promise<T> {
    setIsMutating(true);
    setError("");
    try {
      return await callback();
    } catch (callbackError: unknown) {
      const message =
        callbackError instanceof Error
          ? callbackError.message
          : "Action failed";
      setError(message);
      throw callbackError;
    } finally {
      setIsMutating(false);
    }
  }

  async function onSelectAudience(nextAudienceId: string) {
    if (!canMutate) return;
    await withMutation(async () => {
      if (!nextAudienceId) {
        const detach = await fetch(
          `/api/campaigns/${encodeURIComponent(campaignId)}/audience`,
          { method: "DELETE" },
        );
        if (!detach.ok) {
          const data = await detach.json().catch(() => null);
          throw new Error(data?.error || "Could not detach audience");
        }
        setSelectedAudienceId("");
        setPreview(null);
        return;
      }

      const response = await fetch(
        `/api/campaigns/${encodeURIComponent(campaignId)}/audience`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audience_id: nextAudienceId }),
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Could not attach audience");
      }
      setSelectedAudienceId(nextAudienceId);
      await loadPreview(nextAudienceId);
    });
  }

  async function onCreateAudience(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutate) return;

    if (!savingName.trim()) {
      setError("Audience name is required");
      return;
    }

    const payload: CreateAudiencePayload = {
      name: savingName.trim(),
      description: savingDescription.trim() || null,
      contact_member_ids: contactMemberIds,
      station_member_ids: stationMemberIds,
      membership_rules: {
        include_contact_roles: splitCsvLines(includeContactRoles),
        exclude_contact_roles: splitCsvLines(excludeContactRoles),
        require_contact_email: requireContactEmail,
        exclude_contact_ids: contactExcludeIds,
        include_station_states: splitCsvLines(includeStationStates),
        exclude_station_states: splitCsvLines(excludeStationStates),
        require_station_email: requireStationEmail,
        exclude_station_ids: stationExcludeIds,
      },
    };

    await withMutation(async () => {
      const response = await fetch("/api/campaign-audiences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Could not create audience");
      }
      const data = (await response.json()) as { id: string };
      const newAudience: CampaignAudienceOption = {
        id: data.id,
        name: payload.name,
        description: payload.description,
        membership_rules: payload.membership_rules,
      };
      setAudiences((rows) => [newAudience, ...rows]);
      setCreateOpen(false);
      setSavingName("");
      setSavingDescription("");
      setIncludeContactRoles("");
      setExcludeContactRoles("");
      setIncludeStationStates("");
      setExcludeStationStates("");
      setContactMemberIds([]);
      setContactExcludeIds([]);
      setStationMemberIds([]);
      setStationExcludeIds([]);
      setRequireContactEmail(true);
      setRequireStationEmail(true);
    });
  }

  return (
    <section className="space-y-4">
      <h3 className="text-base font-semibold">Saved audience groups</h3>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardContent className="space-y-3 p-4">
            <Label
              htmlFor="campaign-audience-select"
              className="block text-sm font-medium"
            >
              Current saved audience for this campaign
            </Label>
            <NativeSelect
              id="campaign-audience-select"
              className="w-full"
              value={selectedAudienceId}
              onChange={(event) => void onSelectAudience(event.target.value)}
              disabled={isMutating || !canMutate}
            >
              <option value="">No audience selected</option>
              {audiences.map((audience) => (
                <option key={audience.id} value={audience.id}>
                  {audience.name}
                </option>
              ))}
            </NativeSelect>

            {selectedAudience ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {selectedAudience.description || "No description"}
                </p>
                {preview ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                      <div className="rounded-md border border-border bg-muted/20 p-2">
                        <p className="text-xs text-muted-foreground">
                          Contacts (included)
                        </p>
                        <p className="text-lg font-semibold">
                          {preview.counts.included_contacts}
                        </p>
                      </div>
                      <div className="rounded-md border border-border bg-muted/20 p-2">
                        <p className="text-xs text-muted-foreground">
                          Contacts (excluded)
                        </p>
                        <p className="text-lg font-semibold">
                          {preview.counts.excluded_contacts}
                        </p>
                      </div>
                      <div className="rounded-md border border-border bg-muted/20 p-2">
                        <p className="text-xs text-muted-foreground">
                          Stations (included)
                        </p>
                        <p className="text-lg font-semibold">
                          {preview.counts.included_stations}
                        </p>
                      </div>
                      <div className="rounded-md border border-border bg-muted/20 p-2">
                        <p className="text-xs text-muted-foreground">
                          Stations (excluded)
                        </p>
                        <p className="text-lg font-semibold">
                          {preview.counts.excluded_stations}
                        </p>
                      </div>
                      <div className="rounded-md border border-border bg-muted/20 p-2">
                        <p className="text-xs text-muted-foreground">
                          Explicit contacts
                        </p>
                        <p className="text-lg font-semibold">
                          {preview.counts.explicit_contact_members}
                        </p>
                      </div>
                      <div className="rounded-md border border-border bg-muted/20 p-2">
                        <p className="text-xs text-muted-foreground">
                          Explicit stations
                        </p>
                        <p className="text-lg font-semibold">
                          {preview.counts.explicit_station_members}
                        </p>
                      </div>
                    </div>

                    <details className="mt-2" open>
                      <summary className="cursor-pointer text-sm font-medium">
                        Included contacts
                      </summary>
                      <ul className="mt-2 grid gap-1 text-sm">
                        {preview.included_contacts.map((member) => (
                          <li
                            key={`inc-contact-${member.id}`}
                            className="rounded border border-border/80 px-2 py-1"
                          >
                            <span className="font-medium">{member.name}</span>{" "}
                            {" \u2013 "}
                            {member.detail}
                          </li>
                        ))}
                        {preview.included_contacts.length === 0 && (
                          <li className="text-muted-foreground">
                            No contacts included
                          </li>
                        )}
                      </ul>
                    </details>

                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm font-medium">
                        Excluded contacts
                      </summary>
                      <ul className="mt-2 grid gap-1 text-sm">
                        {preview.excluded_contacts.map((member) => (
                          <li
                            key={`exc-contact-${member.id}`}
                            className="rounded border border-border/80 px-2 py-1"
                          >
                            <span className="font-medium">{member.name}</span>{" "}
                            {" \u2013 "}
                            {member.reason}
                          </li>
                        ))}
                        {preview.excluded_contacts.length === 0 && (
                          <li className="text-muted-foreground">
                            No contacts excluded
                          </li>
                        )}
                      </ul>
                    </details>

                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm font-medium">
                        Included stations
                      </summary>
                      <ul className="mt-2 grid gap-1 text-sm">
                        {preview.included_stations.map((station) => (
                          <li
                            key={`inc-station-${station.id}`}
                            className="rounded border border-border/80 px-2 py-1"
                          >
                            <span className="font-medium">{station.name}</span>{" "}
                            {" \u2013 "}
                            {station.detail}
                          </li>
                        ))}
                        {preview.included_stations.length === 0 && (
                          <li className="text-muted-foreground">
                            No stations included
                          </li>
                        )}
                      </ul>
                    </details>

                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm font-medium">
                        Excluded stations
                      </summary>
                      <ul className="mt-2 grid gap-1 text-sm">
                        {preview.excluded_stations.map((station) => (
                          <li
                            key={`exc-station-${station.id}`}
                            className="rounded border border-border/80 px-2 py-1"
                          >
                            <span className="font-medium">{station.name}</span>{" "}
                            {" \u2013 "}
                            {station.reason}
                          </li>
                        ))}
                        {preview.excluded_stations.length === 0 && (
                          <li className="text-muted-foreground">
                            No stations excluded
                          </li>
                        )}
                      </ul>
                    </details>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No members are currently computed for this audience.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Pick an audience to inspect counts and members.
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              Eligibility/exclusion rules are evaluated each time a preview is
              requested. No email or transport records are written from this
              screen.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">Create saved audience</h4>
              {canMutate && (
                <Button
                  type="button"
                  variant="link"
                  onClick={() => setCreateOpen((open) => !open)}
                  className="h-auto p-0 text-sm font-medium"
                  disabled={isMutating}
                >
                  {createOpen ? "Cancel" : "New audience"}
                </Button>
              )}
            </div>

            {createOpen ? (
              canMutate ? (
                <form className="mt-3 space-y-3" onSubmit={onCreateAudience}>
                  <div className="space-y-1">
                    <Label htmlFor="audience-name">Name</Label>
                    <Input
                      id="audience-name"
                      required
                      value={savingName}
                      onChange={(event) => setSavingName(event.target.value)}
                      className="mt-1 w-full"
                      disabled={isMutating}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="audience-description">Description</Label>
                    <Input
                      id="audience-description"
                      value={savingDescription}
                      onChange={(event) =>
                        setSavingDescription(event.target.value)
                      }
                      className="mt-1 w-full"
                      disabled={isMutating}
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="audience-include-contact-roles">
                        Include contact roles
                      </Label>
                      <Textarea
                        id="audience-include-contact-roles"
                        value={includeContactRoles}
                        onChange={(event) =>
                          setIncludeContactRoles(event.target.value)
                        }
                        placeholder="A&R, Marketing, Promo"
                        className="mt-1 w-full"
                        rows={2}
                        disabled={isMutating}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="audience-exclude-contact-roles">
                        Exclude contact roles
                      </Label>
                      <Textarea
                        id="audience-exclude-contact-roles"
                        value={excludeContactRoles}
                        onChange={(event) =>
                          setExcludeContactRoles(event.target.value)
                        }
                        placeholder="Former, Internal"
                        className="mt-1 w-full"
                        rows={2}
                        disabled={isMutating}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Require contact email</Label>
                      <Label className="mt-2 inline-flex items-center gap-2 text-sm font-normal">
                        <Checkbox
                          checked={requireContactEmail}
                          onCheckedChange={(checked) =>
                            setRequireContactEmail(checked === true)
                          }
                          disabled={isMutating}
                        />
                        Yes
                      </Label>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="audience-include-station-states">
                        Include station states
                      </Label>
                      <Textarea
                        id="audience-include-station-states"
                        value={includeStationStates}
                        onChange={(event) =>
                          setIncludeStationStates(event.target.value)
                        }
                        placeholder="NY, CA"
                        className="mt-1 w-full"
                        rows={2}
                        disabled={isMutating}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="audience-exclude-station-states">
                        Exclude station states
                      </Label>
                      <Textarea
                        id="audience-exclude-station-states"
                        value={excludeStationStates}
                        onChange={(event) =>
                          setExcludeStationStates(event.target.value)
                        }
                        placeholder="US, WA"
                        className="mt-1 w-full"
                        rows={2}
                        disabled={isMutating}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Require station email</Label>
                      <Label className="mt-2 inline-flex items-center gap-2 text-sm font-normal">
                        <Checkbox
                          checked={requireStationEmail}
                          onCheckedChange={(checked) =>
                            setRequireStationEmail(checked === true)
                          }
                          disabled={isMutating}
                        />
                        Yes
                      </Label>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="audience-explicit-contacts">
                        Explicit contacts
                      </Label>
                      <NativeSelect
                        id="audience-explicit-contacts"
                        multiple
                        value={contactMemberIds}
                        onChange={(event) =>
                          setContactMemberIds(
                            Array.from(event.currentTarget.selectedOptions).map(
                              (option) => option.value,
                            ),
                          )
                        }
                        className="mt-1 h-28 w-full px-2"
                        disabled={isMutating}
                      >
                        {contactOptions.map((contact) => (
                          <option key={contact.id} value={contact.id}>
                            {contact.name} ({contact.role || "—"})
                          </option>
                        ))}
                      </NativeSelect>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="audience-exclude-contacts">
                        Exclude contacts
                      </Label>
                      <NativeSelect
                        id="audience-exclude-contacts"
                        multiple
                        value={contactExcludeIds}
                        onChange={(event) =>
                          setContactExcludeIds(
                            Array.from(event.currentTarget.selectedOptions).map(
                              (option) => option.value,
                            ),
                          )
                        }
                        className="mt-1 h-28 w-full px-2"
                        disabled={isMutating}
                      >
                        {contactOptions.map((contact) => (
                          <option key={contact.id} value={contact.id}>
                            {contact.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="audience-explicit-stations">
                        Explicit stations
                      </Label>
                      <NativeSelect
                        id="audience-explicit-stations"
                        multiple
                        value={stationMemberIds}
                        onChange={(event) =>
                          setStationMemberIds(
                            Array.from(event.currentTarget.selectedOptions).map(
                              (option) => option.value,
                            ),
                          )
                        }
                        className="mt-1 h-28 w-full px-2"
                        disabled={isMutating}
                      >
                        {stationOptions.map((station) => (
                          <option key={station.id} value={station.id}>
                            {station.name} ({station.state || "—"})
                          </option>
                        ))}
                      </NativeSelect>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="audience-exclude-stations">
                        Exclude stations
                      </Label>
                      <NativeSelect
                        id="audience-exclude-stations"
                        multiple
                        value={stationExcludeIds}
                        onChange={(event) =>
                          setStationExcludeIds(
                            Array.from(event.currentTarget.selectedOptions).map(
                              (option) => option.value,
                            ),
                          )
                        }
                        className="mt-1 h-28 w-full px-2"
                        disabled={isMutating}
                      >
                        {stationOptions.map((station) => (
                          <option key={station.id} value={station.id}>
                            {station.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                  </div>

                  <Button type="submit" disabled={isMutating}>
                    {isMutating ? "Creating..." : "Create"}
                  </Button>
                </form>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Read-only access prevents creating or editing saved audiences.
                </p>
              )
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                A saved group is a tenant-scoped selection of explicit members
                and eligibility/exclusion rules.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function splitCsvLines(value: string): string[] {
  return value
    .split(/[\n,]/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

type CreateAudiencePayload = {
  name: string;
  description: string | null;
  contact_member_ids: string[];
  station_member_ids: string[];
  membership_rules: CampaignAudienceRules;
};
