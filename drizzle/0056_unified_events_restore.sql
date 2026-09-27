alter table label_suite.budget_projects
  add column if not exists project_type text not null default 'release',
  add column if not exists description text,
  add column if not exists owner_contact_id text references label_suite.contacts(id),
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists location_name text,
  add column if not exists country_code text,
  add column if not exists timezone text,
  add column if not exists health text not null default 'on_track',
  add column if not exists cover_image_url text,
  add column if not exists source_system text,
  add column if not exists source_base_id text,
  add column if not exists source_record_id text,
  add column if not exists source_imported_at timestamptz;

alter table label_suite.documents
  add column if not exists project_id text references label_suite.budget_projects(id) on delete set null;

alter table label_suite.media_assets
  add column if not exists project_id text references label_suite.budget_projects(id) on delete set null;
--> statement-breakpoint

create table if not exists label_suite.project_artists (
  id text primary key,
  org_id text not null references label_suite.orgs(id),
  project_id text not null references label_suite.budget_projects(id) on delete cascade,
  artist_id text not null references label_suite.artists(id) on delete cascade,
  role text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists label_suite.project_contacts (
  id text primary key,
  org_id text not null references label_suite.orgs(id),
  project_id text not null references label_suite.budget_projects(id) on delete cascade,
  contact_id text not null references label_suite.contacts(id) on delete cascade,
  role text not null,
  is_primary boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists label_suite.project_organizations (
  id text primary key,
  org_id text not null references label_suite.orgs(id),
  project_id text not null references label_suite.budget_projects(id) on delete cascade,
  organization_id text not null references label_suite.organizations(id) on delete cascade,
  role text not null,
  is_primary boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists label_suite.project_events (
  id text primary key,
  org_id text not null references label_suite.orgs(id),
  project_id text references label_suite.budget_projects(id) on delete set null,
  artist_id text references label_suite.artists(id) on delete set null,
  release_id text references label_suite.releases(id) on delete set null,
  contact_id text references label_suite.contacts(id) on delete set null,
  owner_contact_id text references label_suite.contacts(id) on delete set null,
  title text not null,
  event_type text not null,
  status text not null default 'planned',
  start_date date not null,
  end_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean not null default true,
  timezone text,
  venue_name text,
  address text,
  city text,
  region text,
  country_code text,
  notes text,
  is_confirmed boolean not null default false,
  source_system text,
  source_base_id text,
  source_table_id text,
  source_record_id text,
  source_imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

create table if not exists label_suite.tour_details (
  id text primary key,
  org_id text not null references label_suite.orgs(id),
  project_id text not null references label_suite.budget_projects(id) on delete cascade,
  billing_role text,
  headline_artist_id text references label_suite.artists(id) on delete set null,
  touring_party_size integer,
  base_city text,
  base_timezone text,
  default_set_length integer,
  default_guarantee numeric(18,2),
  currency text,
  announce_date date,
  decision_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists label_suite.tour_show_details (
  id text primary key,
  org_id text not null references label_suite.orgs(id),
  event_id text not null references label_suite.project_events(id) on delete cascade,
  participation text,
  show_type text,
  venue_organization_id text references label_suite.organizations(id) on delete set null,
  promoter_contact_id text references label_suite.contacts(id) on delete set null,
  agent_contact_id text references label_suite.contacts(id) on delete set null,
  capacity integer,
  guarantee numeric(18,2),
  currency text,
  set_length integer,
  advance_status text,
  source_advanced boolean not null default false,
  comps integer,
  merch_terms text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists label_suite.tour_travel_legs (
  id text primary key,
  org_id text not null references label_suite.orgs(id),
  project_id text not null references label_suite.budget_projects(id) on delete cascade,
  origin_event_id text references label_suite.project_events(id) on delete set null,
  destination_event_id text references label_suite.project_events(id) on delete set null,
  start_date date not null,
  end_date date,
  departs_at timestamptz,
  arrives_at timestamptz,
  origin_label text,
  destination_label text,
  transport_mode text,
  carrier text,
  booking_reference text,
  booking_status text,
  estimated_cost numeric(18,2),
  actual_cost numeric(18,2),
  currency text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  check (arrives_at is null or departs_at is null or arrives_at >= departs_at)
);

create table if not exists label_suite.tour_lodging (
  id text primary key,
  org_id text not null references label_suite.orgs(id),
  project_id text not null references label_suite.budget_projects(id) on delete cascade,
  event_id text references label_suite.project_events(id) on delete set null,
  travel_leg_id text references label_suite.tour_travel_legs(id) on delete set null,
  organization_id text references label_suite.organizations(id) on delete set null,
  stop_name text not null,
  address text,
  check_in date not null,
  check_out date,
  rooms integer,
  nights integer,
  booking_reference text,
  booking_status text,
  estimated_cost numeric(18,2),
  actual_cost numeric(18,2),
  currency text,
  cost_sharing_status text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (check_out is null or check_out >= check_in)
);

create table if not exists label_suite.tour_deal_terms (
  id text primary key,
  org_id text not null references label_suite.orgs(id),
  project_id text not null references label_suite.budget_projects(id) on delete cascade,
  fee_per_show numeric(18,2),
  paid_shows integer,
  total_guarantee numeric(18,2),
  currency text,
  slot text,
  set_length integer,
  all_in_costs numeric(18,2),
  all_in_costs_text text,
  radius_clause text,
  offer_expires timestamptz,
  announce_decision text,
  deal_status text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists label_suite.project_import_runs (
  id text primary key,
  org_id text not null references label_suite.orgs(id),
  source_system text not null,
  source_base_id text,
  mode text not null,
  status text not null,
  source_count integer not null default 0,
  snapshot_hash text,
  warnings jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists label_suite.project_source_records (
  id text primary key,
  org_id text not null references label_suite.orgs(id),
  import_run_id text not null references label_suite.project_import_runs(id) on delete cascade,
  source_system text not null,
  source_base_id text,
  source_table_id text,
  source_record_id text,
  source_created_at timestamptz,
  normalized_payload_hash text,
  raw_payload jsonb not null,
  entity_type text,
  entity_id text,
  imported_at timestamptz not null default now()
);
--> statement-breakpoint

create index if not exists budget_projects_org_type_idx on label_suite.budget_projects (org_id, project_type);
create index if not exists budget_projects_org_dates_idx on label_suite.budget_projects (org_id, start_date, end_date);
create index if not exists budget_projects_org_owner_idx on label_suite.budget_projects (org_id, owner_contact_id);
create index if not exists documents_org_project_idx on label_suite.documents (org_id, project_id);
create index if not exists media_assets_org_project_idx on label_suite.media_assets (org_id, project_id);
create index if not exists project_artists_org_project_idx on label_suite.project_artists (org_id, project_id);
create unique index if not exists project_artists_unique_idx on label_suite.project_artists (org_id, project_id, artist_id);
create index if not exists project_contacts_org_project_idx on label_suite.project_contacts (org_id, project_id);
create unique index if not exists project_contacts_unique_idx on label_suite.project_contacts (org_id, project_id, contact_id, role);
create index if not exists project_organizations_org_project_idx on label_suite.project_organizations (org_id, project_id);
create unique index if not exists project_organizations_unique_idx on label_suite.project_organizations (org_id, project_id, organization_id, role);
create index if not exists project_events_org_project_date_idx on label_suite.project_events (org_id, project_id, start_date);
create index if not exists project_events_org_date_idx on label_suite.project_events (org_id, start_date);
create index if not exists project_events_org_type_idx on label_suite.project_events (org_id, event_type);
create unique index if not exists tour_details_project_unique_idx on label_suite.tour_details (org_id, project_id);
create index if not exists tour_details_org_project_idx on label_suite.tour_details (org_id, project_id);
create unique index if not exists tour_show_details_event_unique_idx on label_suite.tour_show_details (org_id, event_id);
create index if not exists tour_show_details_org_event_idx on label_suite.tour_show_details (org_id, event_id);
create index if not exists tour_travel_legs_org_project_date_idx on label_suite.tour_travel_legs (org_id, project_id, start_date);
create index if not exists tour_lodging_org_project_date_idx on label_suite.tour_lodging (org_id, project_id, check_in);
create unique index if not exists tour_deal_terms_project_unique_idx on label_suite.tour_deal_terms (org_id, project_id);
create index if not exists tour_deal_terms_org_project_idx on label_suite.tour_deal_terms (org_id, project_id);
create index if not exists project_import_runs_org_source_idx on label_suite.project_import_runs (org_id, source_system, started_at);
create index if not exists project_source_records_org_entity_idx on label_suite.project_source_records (org_id, entity_type, entity_id);
create index if not exists project_source_records_import_run_idx on label_suite.project_source_records (org_id, import_run_id);
create unique index if not exists project_source_records_source_unique_idx
  on label_suite.project_source_records (org_id, source_system, source_base_id, source_table_id, source_record_id)
  where source_record_id is not null;
--> statement-breakpoint

DO $$
DECLARE target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'project_artists', 'project_contacts', 'project_organizations', 'project_events',
    'tour_details', 'tour_show_details', 'tour_travel_legs', 'tour_lodging',
    'tour_deal_terms', 'project_import_runs', 'project_source_records'
  ] LOOP
    EXECUTE format('alter table label_suite.%I enable row level security', target_table);
    EXECUTE format('drop policy if exists tenant_isolation on label_suite.%I', target_table);
    EXECUTE format('create policy tenant_isolation on label_suite.%I using (org_id = label_suite.current_org_id()) with check (org_id = label_suite.current_org_id())', target_table);
  END LOOP;
END $$;

alter table label_suite.project_artists enable row level security;
alter table label_suite.project_contacts enable row level security;
alter table label_suite.project_organizations enable row level security;
alter table label_suite.project_events enable row level security;
alter table label_suite.tour_details enable row level security;
alter table label_suite.tour_show_details enable row level security;
alter table label_suite.tour_travel_legs enable row level security;
alter table label_suite.tour_lodging enable row level security;
alter table label_suite.tour_deal_terms enable row level security;
alter table label_suite.project_import_runs enable row level security;
alter table label_suite.project_source_records enable row level security;
--> statement-breakpoint

DROP TRIGGER IF EXISTS same_org_references ON label_suite.budget_projects;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.budget_projects FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('artist_id', 'artists', 'release_id', 'releases', 'owner_contact_id', 'contacts');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.documents;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.documents FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('release_id', 'releases', 'artist_id', 'artists', 'contact_id', 'contacts', 'project_id', 'budget_projects');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.media_assets;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.media_assets FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('linked_artist_id', 'artists', 'linked_release_id', 'releases', 'project_id', 'budget_projects');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.project_artists;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.project_artists FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('project_id', 'budget_projects', 'artist_id', 'artists');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.project_contacts;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.project_contacts FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('project_id', 'budget_projects', 'contact_id', 'contacts');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.project_organizations;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.project_organizations FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('project_id', 'budget_projects', 'organization_id', 'organizations');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.project_events;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.project_events FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('project_id', 'budget_projects', 'artist_id', 'artists', 'release_id', 'releases', 'contact_id', 'contacts', 'owner_contact_id', 'contacts');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.tour_details;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.tour_details FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('project_id', 'budget_projects', 'headline_artist_id', 'artists');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.tour_show_details;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.tour_show_details FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('event_id', 'project_events', 'venue_organization_id', 'organizations', 'promoter_contact_id', 'contacts', 'agent_contact_id', 'contacts');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.tour_travel_legs;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.tour_travel_legs FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('project_id', 'budget_projects', 'origin_event_id', 'project_events', 'destination_event_id', 'project_events');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.tour_lodging;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.tour_lodging FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('project_id', 'budget_projects', 'event_id', 'project_events', 'travel_leg_id', 'tour_travel_legs', 'organization_id', 'organizations');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.tour_deal_terms;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.tour_deal_terms FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('project_id', 'budget_projects');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.project_source_records;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.project_source_records FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('import_run_id', 'project_import_runs');
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.project_artists;
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.project_artists FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.project_contacts;
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.project_contacts FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.project_organizations;
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.project_organizations FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.project_events;
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.project_events FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.tour_details;
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.tour_details FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.tour_show_details;
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.tour_show_details FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.tour_travel_legs;
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.tour_travel_legs FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.tour_lodging;
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.tour_lodging FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.tour_deal_terms;
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.tour_deal_terms FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.project_import_runs;
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.project_import_runs FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.project_source_records;
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.project_source_records FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
