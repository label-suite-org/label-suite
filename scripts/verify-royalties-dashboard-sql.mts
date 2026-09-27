import "dotenv/config";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const orgId = "true-nature";

const totalsSql = `
select
  count(*)::int as row_count,
  round(sum(net_revenue)::numeric, 2) as total_net,
  count(*) filter (
    where lower(coalesce(revenue_type, '')) != 'mechanical'
      and record_name not ilike '%(MPAY)'
  )::int as streaming_rows,
  round(
    sum(net_revenue) filter (
      where lower(coalesce(revenue_type, '')) != 'mechanical'
        and record_name not ilike '%(MPAY)'
    )::numeric,
    2
  ) as streaming_net,
  count(*) filter (
    where lower(coalesce(revenue_type, '')) = 'mechanical'
      or record_name ilike '%(MPAY)'
  )::int as mechanical_rows,
  round(
    sum(net_revenue) filter (
      where lower(coalesce(revenue_type, '')) = 'mechanical'
        or record_name ilike '%(MPAY)'
    )::numeric,
    2
  ) as mechanical_net
from label_suite.royalties_revenue
where org_id = $1 and paid_out != 'paid'
`;

const missingPayeeSql = `
with missing_payee_works as (
  select distinct r.work_id
  from label_suite.roles r
  left join label_suite.contacts c
    on c.id = r.contact_id and c.org_id = r.org_id
  where r.org_id = $1
    and r.scope = 'Master'
    and r.ownership_type != 'Credit'
    and r.percent_share is not null
    and (r.contact_id is null or c.id is null or c.name is null)
),
role_summary as (
  select
    r.work_id,
    round(sum(r.percent_share)::numeric, 2) as master_pct,
    count(*)::int as master_role_count
  from label_suite.roles r
  where r.org_id = $1
    and r.scope = 'Master'
    and r.ownership_type != 'Credit'
    and r.percent_share is not null
  group by r.work_id
),
revenue_summary as (
  select
    rr.work_id,
    round(sum(rr.net_revenue)::numeric, 2) as unpaid_net
  from label_suite.royalties_revenue rr
  where rr.org_id = $1
    and rr.paid_out != 'paid'
    and lower(coalesce(rr.revenue_type, '')) != 'mechanical'
    and rr.record_name not ilike '%(MPAY)'
  group by rr.work_id
)
select
  w.title,
  rs.unpaid_net,
  ro.master_pct,
  ro.master_role_count
from missing_payee_works mp
join label_suite.works w
  on w.id = mp.work_id and w.org_id = $1
join revenue_summary rs
  on rs.work_id = mp.work_id
join role_summary ro
  on ro.work_id = mp.work_id
order by rs.unpaid_net desc
`;

try {
  const totals = await pool.query(totalsSql, [orgId]);
  const missingPayee = await pool.query(missingPayeeSql, [orgId]);
  console.log(JSON.stringify({ totals: totals.rows[0], missingPayee: missingPayee.rows }, null, 2));
} finally {
  await pool.end();
}
