"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownAZ,
  Building2,
  Filter,
  Search,
  Sparkles,
  Tags,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { ContactCreateDialog } from "./ContactCreateDialog";
import type { ContactOrganizationLink } from "./ContactForm";

import type { CompletenessFilter, DirectoryContact, EnrichmentScanState, EnrichmentSuggestion, GmailConnection, GroupMode, Organization, SelectedEntity, SortMode, ViewMode } from "./contact-types";
import { apiWrite, completenessLabels, ContactAvatar, ControlSelect, emptyFallback, GroupHeader, normalizeValue, OrganizationAvatar, primaryOrganization } from "./ContactControls";
import { ContactDetail, OrganizationDetail } from "./ContactDetails";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
export function ContactsBook({
  contacts,
  initialContactId = null,
  organizations,
  enrichmentSuggestions = [],
  gmailConnected = false,
  gmailConnection = null,
  canMutate = true,
  canEnrichContacts = false,
}: {
  contacts: DirectoryContact[];
  initialContactId?: string | null;
  organizations: Organization[];
  enrichmentSuggestions?: EnrichmentSuggestion[];
  gmailConnected?: boolean;
  gmailConnection?: GmailConnection | null;
  canMutate?: boolean;
  canEnrichContacts?: boolean;
}) {
  const [people, setPeople] = useState<DirectoryContact[]>(contacts);
  const [orgs, setOrgs] = useState<Organization[]>(organizations);
  const [suggestions, setSuggestions] = useState<EnrichmentSuggestion[]>(enrichmentSuggestions);
  const [scanState, setScanState] = useState<EnrichmentScanState>({ status: "idle" });
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("people");
  const [selected, setSelected] = useState<SelectedEntity>(
    initialContactId ? { kind: "person", id: initialContactId } : people[0] ? { kind: "person", id: people[0].id } : orgs[0] ? { kind: "organization", id: orgs[0].id } : { kind: "person", id: "" },
  );
  const [companyFilter, setCompanyFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [groupMode, setGroupMode] = useState<GroupMode>("letter");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [completenessFilter, setCompletenessFilter] = useState<CompletenessFilter>("all");

  const organizationOptions = useMemo(() => orgs.map((org) => org.name).sort((a, b) => a.localeCompare(b)), [orgs]);
  const roleOptions = useMemo(
    () => [...new Set(people.map((contact) => normalizeValue(contact.role, "No role")))].sort((a, b) => a.localeCompare(b)),
    [people],
  );
  const organizationTypeOptions = useMemo(
    () => [...new Set(orgs.map((org) => normalizeValue(org.type, "No type")))].sort((a, b) => a.localeCompare(b)),
    [orgs],
  );

  const hasActiveFilters =
    query.trim() ||
    companyFilter !== "all" ||
    roleFilter !== "all" ||
    groupMode !== "letter" ||
    sortMode !== "name" ||
    completenessFilter !== "all";

  const filteredPeople = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return people
      .filter((contact) => {
        const orgNames = contact.organization_links.map((link) => link.organization_name);
        const matchesSearch =
          !needle ||
          [contact.name, contact.company, contact.role, contact.email, contact.phone, contact.notes, ...orgNames]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(needle));

        const matchesCompany =
          companyFilter === "all" ||
          contact.organization_links.some((link) => link.organization_name === companyFilter) ||
          normalizeValue(contact.company, "No company") === companyFilter;
        const matchesRole = roleFilter === "all" || normalizeValue(contact.role, "No role") === roleFilter;
        const matchesCompleteness =
          completenessFilter === "all" ||
          (completenessFilter === "has-image" && !!contact.image_url) ||
          (completenessFilter === "missing-email" && !contact.email) ||
          (completenessFilter === "missing-phone" && !contact.phone) ||
          (completenessFilter === "has-notes" && !!contact.notes) ||
          (completenessFilter === "missing-organization" && contact.organization_links.length === 0);

        return matchesSearch && matchesCompany && matchesRole && matchesCompleteness;
      })
      .sort((a, b) => {
        if (sortMode === "company") {
          return normalizeValue(primaryOrganization(a)?.organization_name ?? a.company, "No organization").localeCompare(
            normalizeValue(primaryOrganization(b)?.organization_name ?? b.company, "No organization"),
          ) || a.name.localeCompare(b.name);
        }
        if (sortMode === "role") {
          return normalizeValue(a.role, "No role").localeCompare(normalizeValue(b.role, "No role")) || a.name.localeCompare(b.name);
        }
        if (sortMode === "updated") {
          return new Date(b.updated_at ?? b.created_at ?? 0).getTime() - new Date(a.updated_at ?? a.created_at ?? 0).getTime();
        }
        return a.name.localeCompare(b.name);
      });
  }, [companyFilter, completenessFilter, people, query, roleFilter, sortMode]);

  const filteredOrganizations = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return orgs
      .filter((org) => {
        const matchesSearch =
          !needle ||
          [org.name, org.type, org.website, org.linkedin_url, org.notes]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(needle));
        const matchesCompany = companyFilter === "all" || org.name === companyFilter;
        const matchesType = roleFilter === "all" || normalizeValue(org.type, "No type") === roleFilter;
        return matchesSearch && matchesCompany && matchesType;
      })
      .sort((a, b) => {
        if (sortMode === "role") return normalizeValue(a.type, "No type").localeCompare(normalizeValue(b.type, "No type")) || a.name.localeCompare(b.name);
        if (sortMode === "updated") return new Date(b.updated_at ?? b.created_at ?? 0).getTime() - new Date(a.updated_at ?? a.created_at ?? 0).getTime();
        return a.name.localeCompare(b.name);
      });
  }, [companyFilter, orgs, query, roleFilter, sortMode]);

  const groupedPeople = useMemo(() => {
    return filteredPeople.reduce<Record<string, DirectoryContact[]>>((groups, contact) => {
      let key = "#";
      if (groupMode === "company") key = normalizeValue(primaryOrganization(contact)?.organization_name ?? contact.company, "No organization");
      if (groupMode === "role") key = normalizeValue(contact.role, "No role");
      if (groupMode === "letter") {
        const letter = contact.name.trim()[0]?.toUpperCase() ?? "#";
        key = /[A-Z]/.test(letter) ? letter : "#";
      }
      groups[key] ??= [];
      groups[key].push(contact);
      return groups;
    }, {});
  }, [filteredPeople, groupMode]);

  const groupedOrganizations = useMemo(() => {
    return filteredOrganizations.reduce<Record<string, Organization[]>>((groups, org) => {
      const key = groupMode === "role" ? normalizeValue(org.type, "No type") : groupMode === "letter" ? (org.name.trim()[0]?.toUpperCase() ?? "#") : "Organizations";
      groups[key] ??= [];
      groups[key].push(org);
      return groups;
    }, {});
  }, [filteredOrganizations, groupMode]);

  const selectedContact =
    selected.kind === "person"
      ? people.find((contact) => contact.id === selected.id) ?? (initialContactId === selected.id ? null : filteredPeople[0] ?? null)
      : null;
  const selectedOrganization =
    selected.kind === "organization"
      ? orgs.find((organization) => organization.id === selected.id) ?? filteredOrganizations[0] ?? null
      : null;

  const visibleCount =
    (viewMode === "organizations" ? 0 : filteredPeople.length) +
    (viewMode === "people" ? 0 : filteredOrganizations.length);

  function clearFilters() {
    setQuery("");
    setCompanyFilter("all");
    setRoleFilter("all");
    setGroupMode("letter");
    setSortMode("name");
    setCompletenessFilter("all");
  }

  function patchPerson(contactId: string, patch: Partial<DirectoryContact>) {
    setPeople((current) => current.map((contact) => (contact.id === contactId ? { ...contact, ...patch } : contact)));
  }

  function patchOrganization(organizationId: string, patch: Partial<Organization>) {
    setOrgs((current) => current.map((organization) => (organization.id === organizationId ? { ...organization, ...patch } : organization)));
    setPeople((current) =>
      current.map((contact) => ({
        ...contact,
        organization_links: contact.organization_links.map((link) =>
          link.organization_id === organizationId
            ? {
                ...link,
                organization_name: patch.name ?? link.organization_name,
                organization_type: patch.type ?? link.organization_type,
                organization_website: patch.website ?? link.organization_website,
                organization_linkedin_url: patch.linkedin_url ?? link.organization_linkedin_url,
              }
            : link,
        ),
      })),
    );
  }

  function patchContactOrganization(linkId: string, patch: Partial<ContactOrganizationLink>) {
    setPeople((current) =>
      current.map((contact) => ({
        ...contact,
        organization_links: contact.organization_links.map((link) => (link.id === linkId ? { ...link, ...patch } : link)),
      })),
    );
  }

  function addContactOrganization(contactId: string, link: ContactOrganizationLink) {
    setPeople((current) =>
      current.map((contact) =>
        contact.id === contactId ? { ...contact, organization_links: [...contact.organization_links, link] } : contact,
      ),
    );
    setOrgs((current) =>
      current.map((organization) =>
        organization.id === link.organization_id
          ? { ...organization, contact_count: organization.contact_count + 1 }
          : organization,
      ),
    );
  }

  function removeContactOrganization(link: ContactOrganizationLink) {
    setPeople((current) =>
      current.map((contact) => ({
        ...contact,
        organization_links: contact.organization_links.filter((candidate) => candidate.id !== link.id),
      })),
    );
    setOrgs((current) =>
      current.map((organization) =>
        organization.id === link.organization_id
          ? { ...organization, contact_count: Math.max(0, organization.contact_count - 1) }
          : organization,
      ),
    );
  }

  async function connectGmail() {
    const result = await apiWrite("/api/gmail/connect", "POST", {});
    if (typeof result.authUrl === "string") {
        // SAFETY: only follow absolute https authorization URLs returned by our own integration API.
        try {
          const target = new URL(result.authUrl);
          if (target.protocol !== "https:") throw new Error("Unexpected authorization URL");
          window.location.assign(target.href);
        } catch {
          alert("The authorization URL was invalid. Check the integration settings.");
        }
      }
  }

  async function scanGmail(contactId?: string) {
    setScanState({ status: "running" });
    try {
      const result = await apiWrite("/api/gmail/enrich", "POST", contactId ? { contact_id: contactId } : { limit: 10 });
      const nextSuggestions = Array.isArray(result.suggestions) ? result.suggestions as EnrichmentSuggestion[] : [];
      setSuggestions((current) => {
        if (contactId) return [...current.filter((suggestion) => suggestion.contact_id !== contactId), ...nextSuggestions];
        return nextSuggestions;
      });
      setScanState({
        status: "success",
        scanned_contacts: typeof result.scanned_contacts === "number" ? result.scanned_contacts : undefined,
        scanned_messages: typeof result.scanned_messages === "number" ? result.scanned_messages : undefined,
        suggestions_created: typeof result.suggestions_created === "number" ? result.suggestions_created : undefined,
      });
      return result;
    } catch (error) {
      setScanState({ status: "error", message: error instanceof Error ? error.message : "Gmail scan failed" });
      throw error;
    }
  }

  async function resolveSuggestion(suggestion: EnrichmentSuggestion, action: "apply" | "ignore") {
    await apiWrite("/api/contact-enrichment-suggestions", "PUT", { id: suggestion.id, action });
    setSuggestions((current) => current.filter((candidate) => candidate.id !== suggestion.id));

    if (action !== "apply" || !suggestion.contact_id) return;
    if (isContactSuggestionField(suggestion.field)) {
      patchPerson(suggestion.contact_id, { [suggestion.field]: suggestion.value } as Partial<DirectoryContact>);
      return;
    }

    if (suggestion.field === "organization_name") {
      window.location.reload();
    }
  }

  if (!people.length && !orgs.length) {
    return (
      <div className="-m-6 flex min-h-[calc(100vh-65px)] items-center justify-center bg-background px-6 py-14 text-center">
        <div className="max-w-md">
          <div className="mx-auto mb-5 flex size-20 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <UserRound className="size-9" />
          </div>
          {canMutate && !canEnrichContacts && <p className="text-sm text-muted-foreground">Gmail enrichment requires operator access.</p>}
          {canMutate ? <div className="mt-6"><ContactCreateDialog /></div> : <p className="mt-6 text-sm text-muted-foreground">Read-only for your role</p>}
        </div>
      </div>
    );
  }

  return (
    <section className="-m-6 flex h-[calc(100vh-65px)] min-h-[640px] flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 justify-end border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {!canMutate && <span className="text-xs text-muted-foreground">Read-only for your role</span>}
          {canMutate && !canEnrichContacts && <span className="text-xs text-muted-foreground">Gmail enrichment requires operator access.</span>}
          {canEnrichContacts &&
          <Button
            type="button"
            onClick={() => gmailConnected ? scanGmail() : connectGmail()}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition hover:bg-muted"
          >
            <Sparkles className="size-4" />
            {gmailConnected ? "Scan Gmail" : "Connect Gmail"}
          </Button>}
          {canMutate && <ContactCreateDialog />}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[400px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-border bg-muted/35 lg:border-b-0 lg:border-r">
          <div className="shrink-0 border-b border-border bg-muted/75 p-3 backdrop-blur">
            <div className="mb-3 grid grid-cols-3 rounded-md border border-border bg-background p-1">
              {(["people", "organizations", "all"] as ViewMode[]).map((mode) => (
                <Button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={`h-8 rounded-sm text-xs font-medium capitalize transition ${viewMode === mode ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {mode}
                </Button>
              ))}
            </div>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search people and organizations"
                className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none transition focus:border-foreground focus:ring-2 focus:ring-ring/30"
              />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <ControlSelect
                icon={Building2}
                label="Organization"
                value={companyFilter}
                onChange={setCompanyFilter}
                options={[["all", "All organizations"], ...organizationOptions.map((company) => [company, company] as const)]}
              />
              <ControlSelect
                icon={Tags}
                label={viewMode === "organizations" ? "Organization type" : "Role"}
                value={roleFilter}
                onChange={setRoleFilter}
                options={[
                  ["all", viewMode === "organizations" ? "All types" : "All roles"],
                  ...(viewMode === "organizations" ? organizationTypeOptions : roleOptions).map((role) => [role, role] as const),
                ]}
              />
              <ControlSelect
                icon={UsersRound}
                label="Group"
                value={groupMode}
                onChange={(value) => setGroupMode(value as GroupMode)}
                options={[
                  ["letter", "Group A-Z"],
                  ["company", "Group organization"],
                  ["role", viewMode === "organizations" ? "Group type" : "Group role"],
                ]}
              />
              <ControlSelect
                icon={ArrowDownAZ}
                label="Sort"
                value={sortMode}
                onChange={(value) => setSortMode(value as SortMode)}
                options={[
                  ["name", "Sort name"],
                  ["company", "Sort organization"],
                  ["role", viewMode === "organizations" ? "Sort type" : "Sort role"],
                  ["updated", "Sort updated"],
                ]}
              />
            </div>
            <div className="mt-2 flex gap-2">
              <ControlSelect
                icon={Filter}
                label="Completeness"
                value={completenessFilter}
                onChange={(value) => setCompletenessFilter(value as CompletenessFilter)}
                options={(Object.entries(completenessLabels) as [CompletenessFilter, string][]).map(([value, label]) => [value, label])}
                className="min-w-0 flex-1"
              />
              {hasActiveFilters && (
                <Button variant="outline"
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition hover:text-foreground"
                  aria-label="Clear contact filters"
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {visibleCount === 0 ? (
              <div className="px-3 py-10 text-center text-sm text-muted-foreground">No records match those filters.</div>
            ) : (
              <>
                {viewMode !== "organizations" && (
                  <DirectoryPeopleList
                    groupedPeople={groupedPeople}
                    selected={selected}
                    onSelect={(id) => setSelected({ kind: "person", id })}
                  />
                )}
                {viewMode !== "people" && (
                  <DirectoryOrganizationList
                    groupedOrganizations={groupedOrganizations}
                    selected={selected}
                    onSelect={(id) => setSelected({ kind: "organization", id })}
                  />
                )}
              </>
            )}
          </div>
        </aside>

        <main className="min-h-0 min-w-0 overflow-y-auto bg-background">
          {selectedContact ? (
            <ContactDetail
              contact={selectedContact}
              organizations={orgs}
              onPatchContact={patchPerson}
              onPatchLink={patchContactOrganization}
              onAddLink={addContactOrganization}
              onRemoveLink={removeContactOrganization}
              onCreateOrganization={(organization) => setOrgs((current) => [...current, organization].sort((a, b) => a.name.localeCompare(b.name)))}
              onSelectOrganization={(id) => setSelected({ kind: "organization", id })}
              suggestions={suggestions.filter((suggestion) => suggestion.contact_id === selectedContact.id)}
              gmailConnected={gmailConnected}
              gmailConnection={gmailConnection}
              scanState={scanState}
              onConnectGmail={connectGmail}
              onScanContact={() => scanGmail(selectedContact.id)}
              onResolveSuggestion={resolveSuggestion}
              canMutate={canMutate}
              canEnrichContacts={canEnrichContacts}
            />
          ) : selectedOrganization ? (
            <OrganizationDetail
              organization={selectedOrganization}
              people={people}
              onPatchOrganization={patchOrganization}
              onSelectPerson={(id) => setSelected({ kind: "person", id })}
              canMutate={canMutate}
            />
          ) : (
            <div className="flex min-h-[460px] items-center justify-center text-sm text-muted-foreground">
              {initialContactId === selected.id ? "The linked contact is no longer available in this workspace." : "Select a person or organization to view details."}
            </div>
          )}
        </main>
      </div>
    </section>
  );
}

function isContactSuggestionField(field: string): field is keyof DirectoryContact {
  return ["email", "phone", "website", "linkedin_url", "address", "role"].includes(field);
}

function DirectoryPeopleList({
  groupedPeople,
  selected,
  onSelect,
}: {
  groupedPeople: Record<string, DirectoryContact[]>;
  selected: SelectedEntity;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {Object.entries(groupedPeople).map(([label, group]) => (
        <div key={label} className="pb-2">
          <GroupHeader label={label} count={group.length} />
          <div className="space-y-1">
            {group.map((contact) => {
              const selectedRow = selected.kind === "person" && selected.id === contact.id;
              const primary = primaryOrganization(contact);
              return (
                <Button
                  key={contact.id}
                  type="button"
                  onClick={() => onSelect(contact.id)}
                  className={`grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-md px-3 py-2.5 text-left transition ${
                    selectedRow ? "bg-background text-foreground shadow-sm ring-1 ring-border" : "text-foreground hover:bg-background/70"
                  }`}
                >
                  <ContactAvatar contact={contact} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{contact.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[primary?.title ?? contact.role, primary?.organization_name ?? contact.company].filter(Boolean).join(" · ") || emptyFallback(contact.email)}
                    </span>
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

function DirectoryOrganizationList({
  groupedOrganizations,
  selected,
  onSelect,
}: {
  groupedOrganizations: Record<string, Organization[]>;
  selected: SelectedEntity;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {Object.entries(groupedOrganizations).map(([label, group]) => (
        <div key={label} className="pb-2">
          <GroupHeader label={label} count={group.length} />
          <div className="space-y-1">
            {group.map((organization) => {
              const selectedRow = selected.kind === "organization" && selected.id === organization.id;
              return (
                <Button
                  key={organization.id}
                  type="button"
                  onClick={() => onSelect(organization.id)}
                  className={`grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-md px-3 py-2.5 text-left transition ${
                    selectedRow ? "bg-background text-foreground shadow-sm ring-1 ring-border" : "text-foreground hover:bg-background/70"
                  }`}
                >
                  <OrganizationAvatar organization={organization} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{organization.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[organization.type, `${organization.contact_count} people`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
