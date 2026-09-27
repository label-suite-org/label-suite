import type { Contact, ContactOrganizationLink } from "./ContactForm";

export type ViewMode = "people" | "organizations" | "all";
export type GroupMode = "letter" | "company" | "role";
export type SortMode = "name" | "company" | "role" | "updated";
export type CompletenessFilter = "all" | "has-image" | "missing-email" | "missing-phone" | "has-notes" | "missing-organization";
export type SelectedEntity = { kind: "person"; id: string } | { kind: "organization"; id: string };

export interface DirectoryContact extends Contact {
  organization_links: ContactOrganizationLink[];
}

export interface Organization {
  id: string;
  name: string;
  type?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  linkedin_url?: string | null;
  address?: string | null;
  image_url?: string | null;
  notes?: string | null;
  source?: string | null;
  contact_count: number;
  created_at?: string | Date | null;
  updated_at?: string | Date | null;
}

export interface EnrichmentSuggestion {
  id: string;
  contact_id?: string | null;
  contact_name?: string | null;
  field: string;
  value: string;
  normalized_value: string;
  confidence: number;
  evidence?: Record<string, unknown> | null;
  source_type: string;
  source_email?: string | null;
  status: string;
  created_at?: string | Date | null;
}

export interface GmailConnection {
  email: string;
  status: string;
  last_scan_at?: string | Date | null;
}

export interface EnrichmentScanState {
  status: "idle" | "running" | "success" | "error";
  scanned_contacts?: number;
  scanned_messages?: number;
  suggestions_created?: number;
  message?: string;
}
