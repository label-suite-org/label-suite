import "dotenv/config";
import { Pool } from "pg";

const SOURCE_DATABASE_URL =
  process.env.SOURCE_DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TARGET_DATABASE_URL = process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL;
const SCHEMA = process.env.MIGRATE_SCHEMA || "label_suite";
const SHOULD_TRUNCATE = process.env.MIGRATE_TRUNCATE === "true";
const REST_PAGE_SIZE = Number(process.env.MIGRATE_REST_PAGE_SIZE ?? 1000);

const TABLES = [
  "contacts",
  "artists",
  "releases",
  "works",
  "tracks",
  "roles",
  "budget_categories",
  "budget_line_items",
  "calls",
  "dsp_pitches",
  "bugs",
  "isrc_sequences",
  "campaigns",
  "radio_stations",
  "campaign_stations",
  "media_assets",
  "documents",
  "side_artists",
  "royalties_revenue",
  "ops_tasks",
  "user",
  "account",
  "session",
  "verification",
];

if (!TARGET_DATABASE_URL) {
  fail("TARGET_DATABASE_URL or DATABASE_URL is required.");
}

if (!SOURCE_DATABASE_URL && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)) {
  fail(
    "Set SOURCE_DATABASE_URL/SUPABASE_DATABASE_URL, or SUPABASE_URL plus SUPABASE_SERVICE_ROLE_KEY.",
  );
}

if (SOURCE_DATABASE_URL && SOURCE_DATABASE_URL === TARGET_DATABASE_URL) {
  fail("Source and target database URLs are identical. Refusing to migrate.");
}

const source = SOURCE_DATABASE_URL ? new Pool({ connectionString: SOURCE_DATABASE_URL }) : null;
const target = new Pool({ connectionString: TARGET_DATABASE_URL });

try {
  const targetInfo = redactDbUrl(TARGET_DATABASE_URL);
  if (source) {
    console.log(`Source: ${redactDbUrl(SOURCE_DATABASE_URL)}`);
  } else {
    console.log(`Source: Supabase REST at ${redactHttpUrl(SUPABASE_URL)}`);
  }
  console.log(`Target: ${targetInfo}`);
  console.log(`Schema: ${SCHEMA}`);

  if (source) {
    await assertSchema(source, "source");
    await assertTables(source, "source");
  }
  await assertSchema(target, "target");
  await assertTables(target, "target");

  const targetCounts = await getTableCounts(target);
  const occupied = targetCounts.filter((row) => row.count > 0);
  if (occupied.length && !SHOULD_TRUNCATE) {
    console.log("Target is not empty:");
    for (const row of occupied) {
      console.log(`  ${row.table}: ${row.count}`);
    }
    fail("Set MIGRATE_TRUNCATE=true to replace target data.");
  }

  await target.query("begin");
  try {
    if (SHOULD_TRUNCATE) {
      const tableList = TABLES.map((table) => qname(SCHEMA, table)).join(", ");
      await target.query(`truncate table ${tableList} restart identity cascade`);
      console.log("Target data truncated.");
    }

    for (const table of TABLES) {
      const result = await copyTable(table);
      console.log(`${table}: copied ${result.count}`);
    }

    await target.query("commit");
  } catch (error) {
    await target.query("rollback");
    throw error;
  }

  const finalCounts = await getTableCounts(target);
  console.log("Target counts:");
  for (const row of finalCounts) {
    console.log(`  ${row.table}: ${row.count}`);
  }
} finally {
  await source?.end();
  await target.end();
}

async function copyTable(table) {
  const targetColumns = await getColumns(target, table);
  const { rows, columns } = source
    ? await readPostgresRows(table, targetColumns)
    : await readSupabaseRows(table, targetColumns);

  if (!columns.length) {
    return { count: 0 };
  }

  if (!rows.length) {
    return { count: 0 };
  }

  await insertRows(table, columns, rows);
  return { count: rows.length };
}

async function readPostgresRows(table, targetColumns) {
  const sourceColumns = await getColumns(source, table);
  const columns = targetColumns.filter((column) => sourceColumns.includes(column));
  if (!columns.length) {
    return { columns: [], rows: [] };
  }

  const result = await source.query(
    `select ${columns.map(quoteIdent).join(", ")} from ${qname(SCHEMA, table)}`,
  );

  return { columns, rows: result.rows };
}

async function readSupabaseRows(table, targetColumns) {
  const rows = await fetchSupabaseRows(table);
  if (!rows.length) {
    return { columns: targetColumns, rows };
  }

  const columns = targetColumns.filter((column) =>
    rows.some((row) => Object.prototype.hasOwnProperty.call(row, column)),
  );

  return { columns, rows };
}

async function insertRows(table, columns, rows) {
  const columnList = columns.map(quoteIdent).join(", ");
  const chunkSize = Math.max(1, Math.floor(60000 / columns.length));

  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const placeholders = [];
    const values = [];
    let n = 1;

    for (const row of chunk) {
      const rowPlaceholders = [];
      for (const column of columns) {
        rowPlaceholders.push(`$${n++}`);
        values.push(row[column] ?? null);
      }
      placeholders.push(`(${rowPlaceholders.join(", ")})`);
    }

    await target.query(
      `insert into ${qname(SCHEMA, table)} (${columnList}) values ${placeholders.join(", ")}`,
      values,
    );
  }
}

async function assertSchema(pool, label) {
  const result = await pool.query(
    "select 1 from information_schema.schemata where schema_name = $1",
    [SCHEMA],
  );
  if (!result.rowCount) {
    fail(`${label} database is missing schema ${SCHEMA}.`);
  }
}

async function assertTables(pool, label) {
  const result = await pool.query(
    `
      select table_name
      from information_schema.tables
      where table_schema = $1
        and table_name = any($2::text[])
    `,
    [SCHEMA, TABLES],
  );
  const found = new Set(result.rows.map((row) => row.table_name));
  const missing = TABLES.filter((table) => !found.has(table));
  if (missing.length) {
    fail(`${label} database is missing table(s): ${missing.join(", ")}`);
  }
}

async function getColumns(pool, table) {
  const result = await pool.query(
    `
      select column_name
      from information_schema.columns
      where table_schema = $1
        and table_name = $2
      order by ordinal_position
    `,
    [SCHEMA, table],
  );
  return result.rows.map((row) => row.column_name);
}

async function getTableCounts(pool) {
  const rows = [];
  for (const table of TABLES) {
    const result = await pool.query(`select count(*)::int as count from ${qname(SCHEMA, table)}`);
    rows.push({ table, count: result.rows[0]?.count ?? 0 });
  }
  return rows;
}

async function fetchSupabaseRows(table) {
  const rows = [];
  let offset = 0;

  while (true) {
    const url = new URL(`rest/v1/${encodeURIComponent(table)}`, normalizeBaseUrl(SUPABASE_URL));
    url.searchParams.set("select", "*");

    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Accept-Profile": SCHEMA,
        Prefer: "count=exact",
        Range: `${offset}-${offset + REST_PAGE_SIZE - 1}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      fail(
        `Supabase REST could not read ${SCHEMA}.${table}: ${response.status} ${response.statusText} ${body.slice(0, 300)}`,
      );
    }

    const page = await response.json();
    if (!Array.isArray(page)) {
      fail(`Supabase REST returned an unexpected response for ${SCHEMA}.${table}.`);
    }

    rows.push(...page);
    if (page.length < REST_PAGE_SIZE) {
      break;
    }
    offset += page.length;
  }

  return rows;
}

function qname(schema, table) {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function redactDbUrl(value) {
  const url = new URL(value);
  return `${url.protocol}//***:***@${url.hostname}${url.pathname}`;
}

function redactHttpUrl(value) {
  const url = new URL(value);
  return `${url.protocol}//${url.host}`;
}

function normalizeBaseUrl(value) {
  const baseUrl = value.endsWith("/") ? value : `${value}/`;
  return baseUrl;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
