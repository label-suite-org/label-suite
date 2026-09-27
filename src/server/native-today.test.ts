import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { expect, it, vi } from "vitest";

const query = vi.hoisted(() => ({ where: vi.fn(), rows: [] as Record<string, unknown>[] }));
vi.mock("../lib/db", () => ({ db: { select: () => {
  const chain = { from: () => chain, where: query.where, orderBy: () => chain, limit: async () => query.rows };
  query.where.mockReturnValue(chain);
  return chain;
} } }));

import { listNativeToday } from "./native-today";

it("treats member names and emails as literal assignments, not wildcard patterns", async () => {
  await listNativeToday("org-a", { userId: "member-a", userName: "%", userEmail: "a_b@example.test", role: "member" });
  const clause = new PgDialect().sqlToQuery(query.where.mock.calls[0][0] as SQL);
  expect(clause.params).toEqual(expect.arrayContaining(["org-a", "member-a", "%", "a_b@example.test"]));
  expect(clause.sql).not.toMatch(/\bilike\b|\blike\b/i);
});

it("includes workspace-member multi-assignment and routes assigned tasks to canonical task detail", async () => {
  query.where.mockClear();
  query.rows = [{ id: "task-a", title: "Artist preparation", status: "todo", linked_artist_id: "artist-a" }];
  const result = await listNativeToday("org-a", { userId: "member-a", role: "member" });
  const clause = new PgDialect().sqlToQuery(query.where.mock.calls[0][0] as SQL);
  expect(clause.sql).toContain('"assignee_ids"');
  expect(clause.params).toContain("member-a");
  expect(result.items[0].href).toBe("/tasks/task-a");
});
