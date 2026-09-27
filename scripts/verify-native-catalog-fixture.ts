import assert from "node:assert/strict";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.equal(process.env.NATIVE_CATALOG_DISPOSABLE_TEST, "1", "Explicit disposable fixture opt-in required");
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
assert.equal(url.pathname, "/native_catalog_fixture", "Refuse non-fixture databases");
const { listNativeCatalogEntries } = await import("../src/server/catalog");
const { projectNativeCatalog } = await import("../src/server/native-catalog");
const { pool } = await import("../src/lib/db");
try {
  const first = await listNativeCatalogEntries("org-a", { query: null, cursor: null, limit: "50" });
  assert.equal(first.total, 151);
  assert.equal(first.rows.length, 50);
  assert.equal(first.next_cursor, "50");
  const projection = projectNativeCatalog(first.rows);
  assert.equal(projection[0].relationship_state, "duplicate"); // Other link is on page four.
  assert.equal(projection[1].relationship_state, "missing");
  assert.equal(projection[1].release, null);
  assert.equal(projection[2].relationship_state, "invalid");
  assert.equal(projection[2].release, null);
  const later = await listNativeCatalogEntries("org-a", { query: null, cursor: "100", limit: "50" });
  assert.equal(later.rows[0].id, "catalog-101");
  assert.equal(later.next_cursor, "150");
  const final = await listNativeCatalogEntries("org-a", { query: null, cursor: "150", limit: "50" });
  assert.equal(final.rows.length, 1);
  assert.equal(final.has_more, false);
  const search = await listNativeCatalogEntries("org-a", { query: "TN-150", cursor: null, limit: "50" });
  assert.equal(search.total, 1);
  assert.equal(search.rows[0].id, "catalog-150");
  assert.equal(search.rows.some(row => row.id === "foreign-catalog"), false);
  const literal = await listNativeCatalogEntries("org-a", { query: "%_\\", cursor: null, limit: "50" });
  assert.equal(literal.total, 1);
  assert.equal(literal.rows[0].id, "catalog-151");
  console.log("PASS real SQL: tenant isolation, chronological paging beyond 100, global search, duplicate and invalid-link projection");
} finally { await pool.end(); }
