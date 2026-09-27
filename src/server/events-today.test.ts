import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  results: [] as Array<unknown[]>,
  selectCalls: 0,
  limits: [] as number[],
  whereCalls: [] as unknown[][],
  whereSql: [] as string[],
  select: vi.fn(),
}));

const neCalls = vi.hoisted(() => ({
  calls: [] as Array<{ lhs: unknown; rhs: unknown }>,
}));

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    ne: vi.fn((lhs: unknown, rhs: unknown) => {
      neCalls.calls.push({ lhs, rhs });
      return actual.ne(lhs as never, rhs as never);
    }),
  };
});

dbMocks.select.mockImplementation(() => {
  const rowResult = dbMocks.results[dbMocks.selectCalls++] ?? [];
  const chain: any = {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn((...args: unknown[]) => {
      dbMocks.whereCalls.push(args);
      const first = args[0] as { toSQL?: () => { sql: string; params?: unknown[] } } | undefined;
      if (first?.toSQL) {
        try {
          const sql = first.toSQL();
          dbMocks.whereSql.push(`${sql.sql} :: ${JSON.stringify(sql.params ?? [])}`);
        } catch (_error) {
          dbMocks.whereSql.push("sql-extract-failed");
        }
      } else {
        dbMocks.whereSql.push("no-sql");
      }
      return chain;
    }),
    orderBy: vi.fn(() => chain),
    groupBy: vi.fn(() => chain),
    limit: vi.fn(async (count: number) => {
      dbMocks.limits.push(count);
      return rowResult as never;
    }),
  };
  return chain;
});

vi.mock("../lib/db", () => ({ db: { select: dbMocks.select } }));
vi.mock("./observability", () => ({ observeOperation: vi.fn((_name: string, _orgId: string, fn: () => Promise<unknown>) => fn()) }));

describe("today hub event slice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.selectCalls = 0;
    dbMocks.limits.length = 0;
    dbMocks.whereCalls.length = 0;
    dbMocks.whereSql.length = 0;
    neCalls.calls.length = 0;
    dbMocks.results = [
      [{ id: "call-1" }],
      [{ id: "task-1" }],
      [{ id: "bug-1" }],
      [{ id: "release-1" }],
      [{ id: "week-1" }],
      [{ id: "event-1", title: "Arena", event_type: "concert", status: "planned", start_date: "2026-08-20", project_name: "Tour", venue_name: "Vega", city: "Berlin" }],
    ];
  });

  it("loads upcoming events into today payload", async () => {
    const { getTodayHubData } = await import("./today");
    const result = await getTodayHubData("org-1");

    expect(result.eventRows).toHaveLength(1);
    expect(result.eventRows[0]).toMatchObject({ id: "event-1", title: "Arena" });
    expect(dbMocks.select).toHaveBeenCalledTimes(6);
    expect(dbMocks.limits).toContain(8);
  });

  it("excludes completed and cancelled events from the Today slice", async () => {
    dbMocks.results[5] = [
      { id: "event-1", title: "Arena", event_type: "concert", status: "planned", start_date: "2026-08-20", project_name: "Tour", venue_name: "Vega", city: "Berlin" },
      { id: "event-2", title: "Done gig", event_type: "broadcast", status: "completed", start_date: "2026-08-21", project_name: "Tour", venue_name: "Royal Arena", city: "Berlin" },
      { id: "event-3", title: "Called off", event_type: "interview", status: "cancelled", start_date: "2026-08-22", project_name: "Tour", venue_name: "Studio", city: "Copenhagen" },
    ];

    const { getTodayHubData } = await import("./today");
    const result = await getTodayHubData("org-1");

    expect(result.eventRows).toHaveLength(1);
    expect(result.eventRows[0].status).toBe("planned");
  });

  it("excludes legacy `canceled` spelling from the Today slice", async () => {
    dbMocks.results[5] = [
      { id: "event-1", title: "Cancelled in old spelling", event_type: "concert", status: "canceled", start_date: "2026-08-20", project_name: "Tour", venue_name: "Old Hall", city: "Berlin" },
      { id: "event-2", title: "Arena", event_type: "concert", status: "planned", start_date: "2026-08-20", project_name: "Tour", venue_name: "Vega", city: "Berlin" },
    ];

    const { getTodayHubData } = await import("./today");
    const result = await getTodayHubData("org-1");

    expect(result.eventRows).toHaveLength(1);
    expect(result.eventRows[0].id).toBe("event-2");
  });

  it("uses SQL predicate exclusion for legacy `canceled` before limiting events", async () => {
    dbMocks.results[5] = [
      { id: "event-1", title: "Arena", event_type: "concert", status: "canceled", start_date: "2026-08-20", project_name: "Tour", venue_name: "Vega", city: "Berlin" },
      { id: "event-2", title: "Arena 2", event_type: "concert", status: "planned", start_date: "2026-08-20", project_name: "Tour", venue_name: "Vega", city: "Berlin" },
      { id: "event-3", title: "Arena 3", event_type: "concert", status: "planned", start_date: "2026-08-20", project_name: "Tour", venue_name: "Vega", city: "Berlin" },
      { id: "event-4", title: "Arena 4", event_type: "concert", status: "planned", start_date: "2026-08-20", project_name: "Tour", venue_name: "Vega", city: "Berlin" },
      { id: "event-5", title: "Arena 5", event_type: "concert", status: "planned", start_date: "2026-08-20", project_name: "Tour", venue_name: "Vega", city: "Berlin" },
      { id: "event-6", title: "Arena 6", event_type: "concert", status: "planned", start_date: "2026-08-20", project_name: "Tour", venue_name: "Vega", city: "Berlin" },
      { id: "event-7", title: "Arena 7", event_type: "concert", status: "planned", start_date: "2026-08-20", project_name: "Tour", venue_name: "Vega", city: "Berlin" },
      { id: "event-8", title: "Arena 8", event_type: "concert", status: "planned", start_date: "2026-08-20", project_name: "Tour", venue_name: "Vega", city: "Berlin" },
      { id: "event-9", title: "Arena 9", event_type: "concert", status: "planned", start_date: "2026-08-20", project_name: "Tour", venue_name: "Vega", city: "Berlin" },
    ];

    const { getTodayHubData } = await import("./today");
    await getTodayHubData("org-1");

    expect(neCalls.calls).toContainEqual(expect.objectContaining({ rhs: "canceled" }));
    expect(neCalls.calls).toContainEqual(expect.objectContaining({ rhs: "cancelled" }));
    expect(neCalls.calls).toContainEqual(expect.objectContaining({ rhs: "completed" }));
  });

  it("keeps active events in the Today slice", async () => {
    dbMocks.results[5] = [
      { id: "event-1", title: "Current run", event_type: "concert", status: "confirmed", start_date: "2026-07-27", end_date: "2026-07-27", project_name: "Tour", venue_name: "Main hall", city: "Berlin" },
      { id: "event-2", title: "Upcoming", event_type: "conference", status: "tentative", start_date: "2026-08-04", project_name: "Tour", venue_name: "The Hub", city: "Copenhagen" },
    ];

    const { getTodayHubData } = await import("./today");
    const result = await getTodayHubData("org-1");

    expect(result.eventRows).toHaveLength(2);
    expect(result.eventRows.map((event) => event.status)).toEqual(["confirmed", "tentative"]);
  });

});
