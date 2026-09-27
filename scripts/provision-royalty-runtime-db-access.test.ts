import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ inherited: false, queries: [] as string[] }));
vi.mock("pg", () => ({ Client: class {
  constructor(private options: { connectionString: string }) {}
  async connect() {}
  async end() {}
  async query(query: string) {
    state.queries.push(query);
    if (query.includes("rolcanlogin")) return { rows: [{ principal: "runtime", can_login: true, superuser: false, bypass_rls: false }] };
    if (query === "select current_user as principal") return { rows: [{ principal: this.options.connectionString }] };
    if (query.includes("pg_has_role")) return { rows: [{ inherited: state.inherited }] };
    if (query.includes("to_regprocedure")) return { rows: [{ routine: "label_suite.register_notification_device(text,text,text,text,uuid)" }] };
    return { rows: [] };
  }
} }));
import { provisionRoyaltyRuntimeDatabaseAccess, quoteDatabaseIdentifier } from "./provision-royalty-runtime-db-access";
beforeEach(() => { state.inherited = false; state.queries = []; });

describe("royalty runtime database access provisioning", () => {
  it("quotes the runtime principal as a PostgreSQL identifier", () => {
    // Break caught: interpolating current_user without identifier quoting lets
    // a provider-controlled role name alter the GRANT statements.
    expect(quoteDatabaseIdentifier('runtime"role')).toBe('"runtime""role"');
  });

  it("grants private notification registration only to the distinct runtime principal", async () => {
    await provisionRoyaltyRuntimeDatabaseAccess("runtime", "migrator");
    expect(state.queries).toContain('grant execute on function label_suite.register_notification_device(text,text,text,text,uuid) to "runtime"');
    expect(state.queries.at(-1)).toBe("commit");
  });

  it("rolls back provisioning when runtime inherits privileged registration ownership", async () => {
    state.inherited = true;
    await expect(provisionRoyaltyRuntimeDatabaseAccess("runtime", "migrator")).rejects.toThrow("must not own or inherit");
    expect(state.queries.at(-1)).toBe("rollback");
    expect(state.queries.some((query) => query.startsWith("grant execute on function label_suite.register_notification_device"))).toBe(false);
  });
});
