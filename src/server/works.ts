import { and, asc, eq, sql } from "drizzle-orm";
import { artists, contacts, roles, tracks, works } from "../db/schema";
import { db } from "../lib/db";

export type WorkPriorityRow = {
  id: string;
  title: string;
  isrc: string | null;
  iswc: string | null;
  genre: string | null;
  audio_url: string | null;
  duration: number | null;
  trackCount: number;
  releaseTitles: string | null;
  artistNames: string | null;
  releaseStatuses: string | null;
  latestReleaseDate: string | null;
  pubRoleCount: number;
  masterRoleCount: number;
  creditCount: number;
  pubProgress: number;
  masterProgress: number;
  pubEntered: number;
  masterEntered: number;
  pendingRoleCount: number;
  releasedTrackCount: number;
  activeReleaseCount: number;
  payoutRows: number;
  payoutNet: number;
  isUnknown: boolean;
  priorityScore: number;
};

export async function listWorks(orgId: string) {
  return db
    .select()
    .from(works)
    .where(eq(works.org_id, orgId))
    .orderBy(asc(works.title));
}

export async function listWorkPriorities(orgId: string): Promise<WorkPriorityRow[]> {
  const result = await db.execute<{
    id: string;
    title: string;
    isrc: string | null;
    iswc: string | null;
    genre: string | null;
    audio_url: string | null;
    duration: number | null;
    track_count: string | number | null;
    release_titles: string | null;
    artist_names: string | null;
    release_statuses: string | null;
    latest_release_date: string | null;
    pub_role_count: string | number | null;
    master_role_count: string | number | null;
    credit_count: string | number | null;
    pub_progress: string | number | null;
    master_progress: string | number | null;
    pub_entered: string | number | null;
    master_entered: string | number | null;
    pending_role_count: string | number | null;
    released_track_count: string | number | null;
    active_release_count: string | number | null;
    payout_rows: string | number | null;
    payout_net: string | number | null;
    is_unknown: boolean | null;
    priority_score: string | number | null;
  }>(sql`
    with role_rollup as (
      select
        r.work_id,
        count(distinct case when r.ownership_type != 'Credit' and r.scope in ('Publishing', 'Mechanical') then r.id end)::int as pub_role_count,
        count(distinct case when r.ownership_type != 'Credit' and r.scope = 'Master' then r.id end)::int as master_role_count,
        count(distinct case when r.ownership_type = 'Credit' then r.id end)::int as credit_count,
        coalesce(sum(case when r.ownership_type != 'Credit' and r.scope in ('Publishing', 'Mechanical') then r.percent_share else 0 end), 0)::numeric as pub_entered,
        coalesce(sum(case when r.ownership_type != 'Credit' and r.scope = 'Master' then r.percent_share else 0 end), 0)::numeric as master_entered,
        coalesce(sum(case when r.ownership_type != 'Credit' and r.scope in ('Publishing', 'Mechanical') then r.percent_share * case r.clearance_status when 'Signed' then 1 when 'Confirmed' then 0.75 when 'Pending' then 0.25 else 0 end else 0 end), 0)::numeric as pub_weighted,
        coalesce(sum(case when r.ownership_type != 'Credit' and r.scope = 'Master' then r.percent_share * case r.clearance_status when 'Signed' then 1 when 'Confirmed' then 0.75 when 'Pending' then 0.25 else 0 end else 0 end), 0)::numeric as master_weighted,
        count(distinct case when r.ownership_type != 'Credit' and coalesce(r.clearance_status, 'Unknown') not in ('Signed', 'Confirmed') then r.id end)::int as pending_role_count
      from label_suite.roles r
      where r.org_id = ${orgId}
      group by r.work_id
    ),
    linked_rollup as (
      select
        t.work_id,
        count(distinct t.id)::int as track_count,
        string_agg(distinct rel.title, ', ' order by rel.title) as release_titles,
        string_agg(distinct a.name, ', ' order by a.name) as artist_names,
        string_agg(distinct rel.status, ', ' order by rel.status) as release_statuses,
        max(rel.release_date) as latest_release_date,
        count(distinct case when lower(coalesce(rel.status, '')) = 'released' or (rel.release_date is not null and rel.release_date <= to_char(current_date, 'YYYY-MM-DD')) then t.id end)::int as released_track_count,
        count(distinct case when rel.id is not null and coalesce(lower(rel.status), '') != 'archived' then rel.id end)::int as active_release_count
      from label_suite.tracks t
      left join label_suite.releases rel on rel.id = t.release_id and rel.org_id = t.org_id
      left join label_suite.artists a on a.id = rel.artist_id and a.org_id = t.org_id
      where t.org_id = ${orgId}
        and t.work_id is not null
      group by t.work_id
    ),
    payout_rollup as (
      select
        rr.work_id,
        count(*) filter (where coalesce(lower(rr.paid_out), 'unpaid') != 'paid')::int as payout_rows,
        coalesce(sum(case when coalesce(lower(rr.paid_out), 'unpaid') != 'paid' then rr.net_revenue else 0 end), 0)::numeric as payout_net
      from label_suite.royalties_revenue rr
      where rr.org_id = ${orgId}
        and rr.work_id is not null
      group by rr.work_id
    )
    select
      w.id,
      w.title,
      w.isrc,
      w.iswc,
      w.genre,
      w.audio_url,
      w.duration,
      coalesce(lr.track_count, 0)::int as track_count,
      lr.release_titles,
      lr.artist_names,
      lr.release_statuses,
      lr.latest_release_date,
      coalesce(rr.pub_role_count, 0)::int as pub_role_count,
      coalesce(rr.master_role_count, 0)::int as master_role_count,
      coalesce(rr.credit_count, 0)::int as credit_count,
      case when coalesce(rr.pub_entered, 0) > 0 then least(round(rr.pub_weighted), 100) else 0 end::int as pub_progress,
      case when coalesce(rr.master_entered, 0) > 0 then least(round(rr.master_weighted), 100) else 0 end::int as master_progress,
      coalesce(rr.pub_entered, 0)::numeric as pub_entered,
      coalesce(rr.master_entered, 0)::numeric as master_entered,
      coalesce(rr.pending_role_count, 0)::int as pending_role_count,
      coalesce(lr.released_track_count, 0)::int as released_track_count,
      coalesce(lr.active_release_count, 0)::int as active_release_count,
      coalesce(pr.payout_rows, 0)::int as payout_rows,
      coalesce(pr.payout_net, 0)::numeric as payout_net,
      (
        lower(trim(w.title)) = 'unknown'
        or lower(trim(w.title)) like 'unknown %'
        or lower(trim(w.title)) like '%unknown work%'
      ) as is_unknown,
      (
        case when coalesce(pr.payout_rows, 0) > 0 and not (coalesce(rr.master_role_count, 0) > 0 and coalesce(rr.master_entered, 0) between 99.5 and 100.5 and coalesce(rr.master_weighted, 0) >= 99.5) then 100 else 0 end
        + case when coalesce(lr.released_track_count, 0) > 0 and not (coalesce(rr.pub_role_count, 0) > 0 and coalesce(rr.master_role_count, 0) > 0 and coalesce(rr.pub_entered, 0) between 99.5 and 100.5 and coalesce(rr.master_entered, 0) between 99.5 and 100.5 and coalesce(rr.pub_weighted, 0) >= 99.5 and coalesce(rr.master_weighted, 0) >= 99.5) then 80 else 0 end
        + case when coalesce(rr.pub_role_count, 0) = 0 or coalesce(rr.master_role_count, 0) = 0 then 35 else 0 end
        + case when coalesce(rr.pending_role_count, 0) > 0 then 20 else 0 end
        + case when lower(trim(w.title)) = 'unknown' or lower(trim(w.title)) like 'unknown %' or lower(trim(w.title)) like '%unknown work%' then 18 else 0 end
        + case when w.isrc is null and w.iswc is null then 8 else 0 end
        + least(coalesce(pr.payout_net, 0)::int, 25)
      )::int as priority_score
    from label_suite.works w
    left join role_rollup rr on rr.work_id = w.id
    left join linked_rollup lr on lr.work_id = w.id
    left join payout_rollup pr on pr.work_id = w.id
    where w.org_id = ${orgId}
    order by priority_score desc, w.title asc
  `);

  return (result.rows ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    isrc: row.isrc,
    iswc: row.iswc,
    genre: row.genre,
    audio_url: row.audio_url,
    duration: row.duration,
    trackCount: Number(row.track_count ?? 0),
    releaseTitles: row.release_titles,
    artistNames: row.artist_names,
    releaseStatuses: row.release_statuses,
    latestReleaseDate: row.latest_release_date,
    pubRoleCount: Number(row.pub_role_count ?? 0),
    masterRoleCount: Number(row.master_role_count ?? 0),
    creditCount: Number(row.credit_count ?? 0),
    pubProgress: Number(row.pub_progress ?? 0),
    masterProgress: Number(row.master_progress ?? 0),
    pubEntered: Number(row.pub_entered ?? 0),
    masterEntered: Number(row.master_entered ?? 0),
    pendingRoleCount: Number(row.pending_role_count ?? 0),
    releasedTrackCount: Number(row.released_track_count ?? 0),
    activeReleaseCount: Number(row.active_release_count ?? 0),
    payoutRows: Number(row.payout_rows ?? 0),
    payoutNet: Number(row.payout_net ?? 0),
    isUnknown: Boolean(row.is_unknown),
    priorityScore: Number(row.priority_score ?? 0),
  }));
}

export async function getWorkDetail(orgId: string, id: string) {
  const workRows = await db
    .select()
    .from(works)
    .where(and(eq(works.id, id), eq(works.org_id, orgId)));
  const roleRows = await db
    .select({
      id: roles.id,
      contact_id: roles.contact_id,
      role: roles.role,
      scope: roles.scope,
      ownership_type: roles.ownership_type,
      percent_share: roles.percent_share,
      clearance_status: roles.clearance_status,
      contact_name: contacts.name,
    })
    .from(roles)
    .leftJoin(contacts, and(eq(roles.contact_id, contacts.id), eq(contacts.org_id, orgId)))
    .where(and(eq(roles.work_id, id), eq(roles.org_id, orgId)));

  const contactRows = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
      role: contacts.role,
      company: contacts.company,
      role_names: sql<string | null>`string_agg(distinct nullif(trim(${roles.role}), ''), ', ' order by nullif(trim(${roles.role}), ''))`,
      is_artist: sql<boolean>`count(distinct ${artists.id}) > 0`,
      has_pro: sql<boolean>`count(distinct case when nullif(trim(${artists.pro}), '') is not null then ${artists.id} end) > 0`,
      has_ipi: sql<boolean>`count(distinct case when nullif(trim(${artists.ipi}), '') is not null then ${artists.id} end) > 0`,
      rights_role_count: sql<number>`count(distinct case when ${roles.ownership_type} != 'Credit' then ${roles.id} end)`,
      publishing_role_count: sql<number>`count(distinct case when ${roles.ownership_type} != 'Credit' and ${roles.scope} in ('Publishing', 'Mechanical') then ${roles.id} end)`,
      master_role_count: sql<number>`count(distinct case when ${roles.ownership_type} != 'Credit' and ${roles.scope} = 'Master' then ${roles.id} end)`,
      credit_role_count: sql<number>`count(distinct case when ${roles.ownership_type} = 'Credit' then ${roles.id} end)`,
    })
    .from(contacts)
    .leftJoin(artists, and(eq(artists.contact_id, contacts.id), eq(artists.org_id, orgId)))
    .leftJoin(roles, and(eq(roles.contact_id, contacts.id), eq(roles.org_id, orgId)))
    .where(eq(contacts.org_id, orgId))
    .groupBy(contacts.id, contacts.name, contacts.role, contacts.company)
    .orderBy(asc(contacts.name));

  const trackRows = await db
    .select()
    .from(tracks)
    .where(and(eq(tracks.work_id, id), eq(tracks.org_id, orgId)))
    .orderBy(asc(tracks.position));

  return {
    work: workRows[0] ?? null,
    roles: roleRows,
    contacts: contactRows,
    tracks: trackRows,
  };
}
