import { describe, expect, it } from "vitest";
import { createRequestScopedDatabase } from "./db-context";

type FakeDatabase = {
  label: string;
  readLabel(): string;
  transaction<T>(callback: (transaction: FakeDatabase) => Promise<T>, options?: unknown): Promise<T>;
};

type TestContext = { orgId: string; userId: string };

function fakeDatabase(label: string): FakeDatabase {
  return {
    label,
    readLabel() {
      return this.label;
    },
    async transaction<T>(callback: (transaction: FakeDatabase) => Promise<T>): Promise<T> {
      return callback(fakeDatabase(`${this.label}:transaction`));
    },
  };
}

describe("request-scoped database context", () => {
  it("routes database calls through the active transaction and restores the root afterwards", async () => {
    // Break caught: authenticated request queries use the unrestricted pool
    // instead of the transaction carrying PostgreSQL tenant settings.
    const applied: Array<{ label: string; orgId: string; userId: string }> = [];
    const scoped = createRequestScopedDatabase<FakeDatabase, TestContext>(fakeDatabase("root"), async (transaction, context) => {
      applied.push({ label: transaction.label, ...context });
    });

    expect(scoped.database.readLabel()).toBe("root");
    const inside = await scoped.run({ orgId: "org-a", userId: "user-a" }, async () => scoped.database.readLabel());

    expect(inside).toBe("root:transaction");
    expect(scoped.database.readLabel()).toBe("root");
    expect(applied).toEqual([{ label: "root:transaction", orgId: "org-a", userId: "user-a" }]);
  });

  it("keeps concurrent tenant transactions isolated", async () => {
    // Break caught: a process-global tenant value leaks one request's
    // organization into another request sharing the PostgreSQL pool.
    const scoped = createRequestScopedDatabase<FakeDatabase, TestContext>(fakeDatabase("root"), async (transaction, context) => {
      transaction.label = context.orgId ?? context.userId;
    });
    let releaseA!: () => void;
    const holdA = new Promise<void>((resolve) => { releaseA = resolve; });

    const requestA = scoped.run({ orgId: "org-a", userId: "user-a" }, async () => {
      await holdA;
      return scoped.database.readLabel();
    });
    const requestB = scoped.run({ orgId: "org-b", userId: "user-b" }, async () => scoped.database.readLabel());

    expect(await requestB).toBe("org-b");
    releaseA();
    expect(await requestA).toBe("org-a");
  });

  it("uses a nested transaction without escaping the active request context", async () => {
    // Break caught: an existing service-level db.transaction call drops back
    // to the root pool and loses the request's tenant settings.
    const scoped = createRequestScopedDatabase<FakeDatabase, TestContext>(fakeDatabase("root"), async () => undefined);

    const label = await scoped.run({ orgId: "org-a", userId: "user-a" }, async () =>
      scoped.database.transaction(async () => scoped.database.readLabel()),
    );

    expect(label).toBe("root:transaction:transaction");
  });

  it("restores the parent PostgreSQL context after a successful nested context", async () => {
    // Break caught: releasing a savepoint keeps the nested set_config values,
    // so later outer-request queries can run as the wrong tenant.
    const applied: string[] = [];
    const scoped = createRequestScopedDatabase<FakeDatabase, TestContext>(fakeDatabase("root"), async (_transaction, context) => {
      applied.push(`${context.userId}:${context.orgId}`);
    });

    await scoped.run({ orgId: "org-a", userId: "user-a" }, async () => {
      await scoped.run({ orgId: "org-b", userId: "user-b" }, async () => undefined);
      expect(scoped.database.readLabel()).toBe("root:transaction");
    });

    expect(applied).toEqual([
      "user-a:org-a",
      "user-b:org-b",
      "user-a:org-a",
    ]);
  });

  it("reuses the contextual transaction when service isolation was established before tenant queries", async () => {
    // Break caught in CI: a savepoint cannot change transaction isolation
    // after the request transaction has already established tenant GUCs.
    const applied: string[] = [];
    const scoped = createRequestScopedDatabase<FakeDatabase, TestContext>(fakeDatabase("root"), async (transaction, context) => {
      applied.push(`${transaction.label}:${context.orgId}`);
    });

    const label = await scoped.run(
      { orgId: "org-a", userId: "user-a" },
      async () => scoped.database.transaction(
        async () => scoped.database.readLabel(),
        { isolationLevel: "repeatable read" },
      ),
      { isolationLevel: "repeatable read" },
    );

    expect(label).toBe("root:transaction:transaction");
    expect(applied).toEqual(["root:transaction:org-a"]);
  });
});
