import type { MembershipRole } from "../../server/tenant";

export type ThemeMode = "system" | "light" | "dark";
export type IsrcConfigSource = "workspace" | "legacy-true-nature" | "missing";

export type SettingsUser = {
  id: string;
  name?: string | null;
  email?: string | null;
};

export type SettingsOrg = {
  id: string;
  name: string;
  slug: string;
  plan: string | null;
};


export type SettingsMember = {
  membershipId: string;
  orgId: string;
  userId: string;
  name: string;
  email: string;
  role: MembershipRole;
  joinedAt: string;
};

export type SettingsInvitation = {
  id: string;
  orgId: string;
  email: string;
  normalizedEmail: string;
  role: MembershipRole;
  status: string;
  invitedByUserId: string | null;
  acceptedByUserId: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  lastSentAt: string | null;
  createdAt: string;
};


export type WorkspaceSettingsState = {
  name: string;
  legal_name: string;
  timezone: string;
  currency: string;
  validation_sweep_mode: "manual" | "scheduled" | "post_write";
  default_release_policy: "readiness_gates" | "flexible";
  catalog_prefix: string;
  catalog_number_width: number;
  isrc_country_code: string;
  isrc_registrant_code: string;
  isrc_prefix: string | null;
  isrc_config_source: IsrcConfigSource;
  sequence_year: number;
  sequence_last_production_number: number;
  next_isrc_preview: string | null;
};

export const CURRENT_SEQUENCE_YEAR = new Date().getFullYear();
