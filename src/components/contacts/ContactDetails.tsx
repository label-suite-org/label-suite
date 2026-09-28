"use client";

import { Check, ExternalLink, Globe2, Image as ImageIcon, Link2, Mail, MapPin, Phone, Tags, Trash2, UsersRound, X } from "lucide-react";
import { ContactDeleteButton } from "./ContactActionButtons";
import type { ContactOrganizationLink } from "./ContactForm";
import type { DirectoryContact, EnrichmentScanState, EnrichmentSuggestion, GmailConnection, Organization } from "./contact-types";
import { AddOrganizationLink, ContactEnrichmentPanel } from "./ContactEnrichment";
import { ContactAvatar, EditableBlock, EditableInfoRow, emptyFallback, HealthPanel, HealthRow, IconLink, InlineLabelField, InlineText, OrganizationAvatar, primaryOrganization, RecordPanel, apiWrite } from "./ContactControls";

import { Button } from "@/components/ui/button";
export function ContactDetail({
  contact,
  organizations,
  onPatchContact,
  onPatchLink,
  onAddLink,
  onRemoveLink,
  onCreateOrganization,
  onSelectOrganization,
  suggestions,
  gmailConnected,
  gmailConnection,
  scanState,
  onConnectGmail,
  onScanContact,
  onResolveSuggestion,
  canMutate,
  canEnrichContacts,
}: {
  contact: DirectoryContact;
  organizations: Organization[];
  onPatchContact: (contactId: string, patch: Partial<DirectoryContact>) => void;
  onPatchLink: (linkId: string, patch: Partial<ContactOrganizationLink>) => void;
  onAddLink: (contactId: string, link: ContactOrganizationLink) => void;
  onRemoveLink: (link: ContactOrganizationLink) => void;
  onCreateOrganization: (organization: Organization) => void;
  onSelectOrganization: (id: string) => void;
  suggestions: EnrichmentSuggestion[];
  gmailConnected: boolean;
  gmailConnection?: GmailConnection | null;
  scanState: EnrichmentScanState;
  onConnectGmail: () => Promise<void>;
  onScanContact: () => Promise<unknown>;
  onResolveSuggestion: (suggestion: EnrichmentSuggestion, action: "apply" | "ignore") => Promise<void>;
  canMutate: boolean;
  canEnrichContacts: boolean;
}) {
  const primary = primaryOrganization(contact);

  async function saveContactField(field: keyof DirectoryContact, value: string) {
    const normalized = value.trim() || null;
    await apiWrite("/api/contacts", "PUT", { id: contact.id, [field]: normalized });
    onPatchContact(contact.id, { [field]: normalized } as Partial<DirectoryContact>);
  }

  async function saveLinkField(link: ContactOrganizationLink, field: keyof ContactOrganizationLink, value: string) {
    const normalized = value.trim() || null;
    await apiWrite("/api/contact-organizations", "PUT", { id: link.id, [field]: normalized });
    onPatchLink(link.id, { [field]: normalized } as Partial<ContactOrganizationLink>);
  }

  async function unlink(link: ContactOrganizationLink) {
    await apiWrite("/api/contact-organizations", "DELETE", { id: link.id });
    onRemoveLink(link);
  }

  return (
    <article className="mx-auto flex max-w-5xl flex-col px-5 py-6 sm:px-8 sm:py-8">
      <div className="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
          <ContactAvatar contact={contact} size="lg" />
          <div className="min-w-0">
            <InlineText
              value={contact.name}
              className="text-3xl font-semibold tracking-tight sm:text-4xl"
              onSave={(value) => saveContactField("name", value)}
              canEdit={canMutate}
            />
            <p className="mt-2 text-sm text-muted-foreground">
              {[primary?.title ?? contact.role, primary?.organization_name ?? contact.company].filter(Boolean).join(" at ") || "Person"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild><a href={`/documents?contact_id=${encodeURIComponent(contact.id)}`}>Documents</a></Button>
          {contact.email && <IconLink href={`mailto:${contact.email}`} label={`Email ${contact.name}`} icon={Mail} />}
          {contact.phone && <IconLink href={`tel:${contact.phone}`} label={`Call ${contact.name}`} icon={Phone} />}
          {canMutate && <ContactDeleteButton
            contact={contact}
            className="inline-flex size-10 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-700 transition hover:bg-red-100 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300"
          >
            <Trash2 className="size-4" />
          </ContactDeleteButton>}
        </div>
      </div>

      <div className="grid gap-6 py-7 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <section>
            <h3 className="mb-3 text-sm font-semibold">Person</h3>
            <div className="divide-y divide-border rounded-lg border border-border">
              <EditableInfoRow canEdit={canMutate} icon={Mail} label="Email" value={contact.email} onSave={(value) => saveContactField("email", value)} />
              <EditableInfoRow canEdit={canMutate} icon={Phone} label="Phone" value={contact.phone} onSave={(value) => saveContactField("phone", value)} />
              <EditableInfoRow canEdit={canMutate} icon={Globe2} label="Website" value={contact.website} onSave={(value) => saveContactField("website", value)} />
              <EditableInfoRow canEdit={canMutate} icon={Link2} label="LinkedIn" value={contact.linkedin_url} onSave={(value) => saveContactField("linkedin_url", value)} />
              <EditableInfoRow canEdit={canMutate} icon={MapPin} label="Address" value={contact.address} onSave={(value) => saveContactField("address", value)} />
              <EditableInfoRow canEdit={canMutate} icon={Tags} label="Fallback role" value={contact.role} onSave={(value) => saveContactField("role", value)} />
              <EditableInfoRow canEdit={canMutate} icon={ImageIcon} label="Image URL" value={contact.image_url} onSave={(value) => saveContactField("image_url", value)} />
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold">Organizations</h3>
            <div className="space-y-2">
              {contact.organization_links.length ? (
                contact.organization_links.map((link) => (
                  <div key={link.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <Button type="button" onClick={() => onSelectOrganization(link.organization_id)} className="min-w-0 text-left">
                        <span className="block truncate text-sm font-semibold">{link.organization_name}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {[link.organization_type, link.relationship_type || "linked organization"].filter(Boolean).join(" · ")}
                        </span>
                      </Button>
                      {canMutate && <Button
                        type="button"
                        onClick={() => unlink(link)}
                        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-red-50 hover:text-red-700"
                        aria-label={`Unlink ${link.organization_name}`}
                      >
                        <X className="size-4" />
                      </Button>}
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <InlineLabelField canEdit={canMutate} label="Title" value={link.title} onSave={(value) => saveLinkField(link, "title", value)} />
                      <InlineLabelField canEdit={canMutate} label="Department" value={link.department} onSave={(value) => saveLinkField(link, "department", value)} />
                      <InlineLabelField canEdit={canMutate} label="Relationship" value={link.relationship_type} onSave={(value) => saveLinkField(link, "relationship_type", value)} />
                      <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        <span>Primary</span>
                        {canMutate ? <Button
                          type="button"
                          onClick={async () => {
                            await apiWrite("/api/contact-organizations", "PUT", { id: link.id, is_primary: !link.is_primary });
                            onPatchLink(link.id, { is_primary: !link.is_primary });
                          }}
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium ${link.is_primary ? "bg-foreground text-background" : "bg-background text-muted-foreground"}`}
                        >
                          {link.is_primary ? <Check className="size-3" /> : null}
                          {link.is_primary ? "Yes" : "No"}
                        </Button> : <span className="font-medium">{link.is_primary ? "Yes" : "No"}</span>}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  This person is not linked to an organization yet.
                </div>
              )}
              {canMutate && <AddOrganizationLink
                contact={contact}
                organizations={organizations}
                onCreateOrganization={onCreateOrganization}
                onAddLink={onAddLink}
              />}
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold">Notes</h3>
            <EditableBlock canEdit={canMutate} value={contact.notes} onSave={(value) => saveContactField("notes", value)} />
          </section>
        </div>

        <aside className="space-y-4">
          {canEnrichContacts && <ContactEnrichmentPanel
            connected={gmailConnected}
            connection={gmailConnection}
            scanState={scanState}
            suggestions={suggestions}
            onConnect={onConnectGmail}
            onScan={onScanContact}
            onResolve={onResolveSuggestion}
          />}
          <HealthPanel contact={contact} />
          <RecordPanel createdAt={contact.created_at} updatedAt={contact.updated_at} source="Person" />
        </aside>
      </div>
    </article>
  );
}

export function OrganizationDetail({
  organization,
  people,
  onPatchOrganization,
  onSelectPerson,
  canMutate,
}: {
  organization: Organization;
  people: DirectoryContact[];
  onPatchOrganization: (organizationId: string, patch: Partial<Organization>) => void;
  onSelectPerson: (id: string) => void;
  canMutate: boolean;
}) {
  const linkedPeople = people.filter((contact) => contact.organization_links.some((link) => link.organization_id === organization.id));

  async function saveOrganizationField(field: keyof Organization, value: string) {
    const normalized = value.trim() || null;
    await apiWrite("/api/organizations", "PUT", { id: organization.id, [field]: normalized });
    onPatchOrganization(organization.id, { [field]: normalized } as Partial<Organization>);
  }

  return (
    <article className="mx-auto flex max-w-5xl flex-col px-5 py-6 sm:px-8 sm:py-8">
      <div className="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
          <OrganizationAvatar organization={organization} size="lg" />
          <div className="min-w-0">
            <InlineText
              value={organization.name}
              className="text-3xl font-semibold tracking-tight sm:text-4xl"
              onSave={(value) => saveOrganizationField("name", value)}
              canEdit={canMutate}
            />
            <p className="mt-2 text-sm text-muted-foreground">
              {[organization.type, `${linkedPeople.length} linked people`].filter(Boolean).join(" · ") || "Organization"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {organization.website && <IconLink href={organization.website} label={`Open ${organization.name} website`} icon={ExternalLink} />}
          {organization.linkedin_url && <IconLink href={organization.linkedin_url} label={`Open ${organization.name} LinkedIn`} icon={Link2} />}
        </div>
      </div>

      <div className="grid gap-6 py-7 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <section>
            <h3 className="mb-3 text-sm font-semibold">Organization</h3>
            <div className="divide-y divide-border rounded-lg border border-border">
              <EditableInfoRow canEdit={canMutate} icon={Tags} label="Type" value={organization.type} onSave={(value) => saveOrganizationField("type", value)} />
              <EditableInfoRow canEdit={canMutate} icon={Mail} label="Email" value={organization.email} onSave={(value) => saveOrganizationField("email", value)} />
              <EditableInfoRow canEdit={canMutate} icon={Phone} label="Phone" value={organization.phone} onSave={(value) => saveOrganizationField("phone", value)} />
              <EditableInfoRow canEdit={canMutate} icon={ExternalLink} label="Website" value={organization.website} onSave={(value) => saveOrganizationField("website", value)} />
              <EditableInfoRow canEdit={canMutate} icon={Link2} label="LinkedIn" value={organization.linkedin_url} onSave={(value) => saveOrganizationField("linkedin_url", value)} />
              <EditableInfoRow canEdit={canMutate} icon={MapPin} label="Address" value={organization.address} onSave={(value) => saveOrganizationField("address", value)} />
              <EditableInfoRow canEdit={canMutate} icon={ImageIcon} label="Image URL" value={organization.image_url} onSave={(value) => saveOrganizationField("image_url", value)} />
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold">People</h3>
            <div className="divide-y divide-border rounded-lg border border-border">
              {linkedPeople.length ? (
                linkedPeople.map((contact) => {
                  const link = contact.organization_links.find((candidate) => candidate.organization_id === organization.id);
                  return (
                    <Button
                      key={contact.id}
                      type="button"
                      onClick={() => onSelectPerson(contact.id)}
                      className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/45"
                    >
                      <ContactAvatar contact={contact} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{contact.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[link?.title ?? contact.role, link?.department].filter(Boolean).join(" · ") || emptyFallback(contact.email)}
                        </span>
                      </span>
                    </Button>
                  );
                })
              ) : (
                <div className="px-4 py-6 text-sm text-muted-foreground">No people are linked to this organization yet.</div>
              )}
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold">Notes</h3>
            <EditableBlock canEdit={canMutate} value={organization.notes} onSave={(value) => saveOrganizationField("notes", value)} />
          </section>
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold">Directory health</h3>
            <div className="mt-3 space-y-2 text-sm">
              <HealthRow complete={!!organization.type} icon={Tags} label="Type" />
              <HealthRow complete={!!organization.email} icon={Mail} label="Email" />
              <HealthRow complete={!!organization.phone} icon={Phone} label="Phone" />
              <HealthRow complete={!!organization.website} icon={ExternalLink} label="Website" />
              <HealthRow complete={!!organization.linkedin_url} icon={Link2} label="LinkedIn" />
              <HealthRow complete={!!organization.address} icon={MapPin} label="Address" />
              <HealthRow complete={linkedPeople.length > 0} icon={UsersRound} label="People" />
            </div>
          </div>
          <RecordPanel createdAt={organization.created_at} updatedAt={organization.updated_at} source={organization.source || "Organization"} />
        </aside>
      </div>
    </article>
  );
}
