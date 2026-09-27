import { asc, eq } from "drizzle-orm";
import { catalog_entries, releases } from "../src/db/schema";
import { db, pool } from "../src/lib/db";
import { syncReleaseCatalogEntry } from "../src/server/catalog";

const rawArgs = process.argv.slice(2);
const orgId = readOption("--org") ?? "true-nature";
const apply = rawArgs.includes("--apply");

if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
  console.log(`Usage: npm run catalog:backfill -- [--org <org-id>] [--apply]

Reconciles one catalog entry for every existing release and lets the shared
chronological sequencer fill missing numbers. Dry-run is the default; use
--apply to write changes.

Required environment:
  DATABASE_URL   Postgres connection string for the target Label Suite DB`);
  await pool.end();
  process.exit(0);
}

try {
  const releaseRows = await db
    .select({ id: releases.id, title: releases.title })
    .from(releases)
    .where(eq(releases.org_id, orgId))
    .orderBy(asc(releases.release_date), asc(releases.id));
  const existingRows = await db
    .select({ release_id: catalog_entries.release_id })
    .from(catalog_entries)
    .where(eq(catalog_entries.org_id, orgId));
  const existingReleaseIds = new Set(existingRows.map((row) => row.release_id).filter(Boolean));
  const missing = releaseRows.filter((release) => !existingReleaseIds.has(release.id));

  console.log(JSON.stringify({ orgId, releases: releaseRows.length, missingCatalogEntries: missing.length, apply }, null, 2));
  if (!apply) process.exit(0);

  await db.transaction(async (tx) => {
    for (const release of releaseRows) {
      await syncReleaseCatalogEntry(tx, orgId, release.id);
    }
  });
  console.log(`Reconciled ${releaseRows.length} releases for ${orgId}.`);
} finally {
  await pool.end();
}

function readOption(name: string): string | undefined {
  const index = rawArgs.indexOf(name);
  if (index >= 0) return rawArgs[index + 1];
  const prefix = `${name}=`;
  return rawArgs.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}
