import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const mock = vi.hoisted(() => {
  const state = { rows: [] as any[], total: 0, filters: [] as any[], joins: [] as any[], orders: [] as any[], limit: 0, offset: 0 };
  const select = vi.fn(() => {
    const query: any = {
      from: () => query,
      leftJoin: (_table: unknown, condition: unknown) => { state.joins.push(condition); return query; },
      where: (condition: unknown) => { state.filters.push(condition); return query; },
      orderBy: (...order: unknown[]) => { state.orders = order; return query; },
      limit: (limit: number) => { state.limit = limit; return query; },
      offset: (offset: number) => { state.offset = offset; return Promise.resolve(state.rows); },
      then: (resolve: any, reject: any) => Promise.resolve([{ total: state.total }]).then(resolve, reject),
    };
    return query;
  });
  return { state, select };
});
vi.mock("../lib/db", () => ({ db: { select: mock.select } }));
import { listNativeCatalogEntries } from "./catalog";

describe("native Catalog bounded query", () => {
  beforeEach(() => { vi.clearAllMocks(); Object.assign(mock.state, { rows: [], total: 0, filters: [], joins: [], orders: [], limit: 0, offset: 0 }); });
  it("pages beyond the initial hundred without loading an unbounded result", async () => {
    mock.state.rows = Array.from({ length: 51 }, (_, index) => ({ id: `row-${100 + index}` }));
    mock.state.total = 200;
    const result = await listNativeCatalogEntries("org-a", { query: null, cursor: "100", limit: "50" });
    expect(mock.state.offset).toBe(100);
    expect(mock.state.limit).toBe(51);
    expect(result.rows).toHaveLength(50);
    expect(result.next_cursor).toBe("150");
    expect(result.has_more).toBe(true);
  });
  it("binds tenant on both queries and Release join, escaping literal search characters", async () => {
    await listNativeCatalogEntries("org-a", { query: "100%_\\mix", cursor: null, limit: null });
    const dialect = new PgDialect();
    for (const filter of mock.state.filters) {
      const query = dialect.sqlToQuery(filter);
      expect(query.params).toContain("org-a");
      expect(query.params).toContain("%100\\%\\_\\\\mix%");
    }
    for (const join of mock.state.joins) expect(dialect.sqlToQuery(join).params).toContain("org-a");
    const order = mock.state.orders.map((part) => dialect.sqlToQuery(part).sql).join(" ");
    expect(order).toContain('"release_date" asc');
    expect(order).toContain('"id" asc');
  });
  it("bounds page size and rejects unsafe numeric offsets", async () => {
    await listNativeCatalogEntries("org-a", { query: null, cursor: "1e100", limit: "999999" });
    expect(mock.state.offset).toBe(0);
    expect(mock.state.limit).toBe(101);
  });
});
