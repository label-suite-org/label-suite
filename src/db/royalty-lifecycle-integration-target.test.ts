import { describe, expect, it } from "vitest";
import { assertDisposableRoyaltyLifecycleTarget } from "./royalty-lifecycle-integration-target";

describe("royalty lifecycle disposable Postgres target", () => {
  it("accepts only an explicitly marked local royalty lifecycle database", () => {
    expect(() => assertDisposableRoyaltyLifecycleTarget({
      databaseUrl: "postgresql://fixture:fixture@127.0.0.1/royalty_lifecycle_test_task4",
      testDatabase: "1",
      disposable: "1",
    })).not.toThrow();
  });

  it.each([
    [{ databaseUrl: "postgresql://fixture:fixture@127.0.0.1/royalty_lifecycle_test_task4", testDatabase: undefined, disposable: "1" }],
    [{ databaseUrl: "postgresql://fixture:fixture@127.0.0.1/royalty_lifecycle_test_task4", testDatabase: "1", disposable: undefined }],
    [{ databaseUrl: "postgresql://fixture:fixture@production.example/royalty_lifecycle_test_task4", testDatabase: "1", disposable: "1" }],
    [{ databaseUrl: "postgresql://fixture:fixture@127.0.0.1/label_suite", testDatabase: "1", disposable: "1" }],
  ])("refuses an unmarked or production-like target: %o", (input) => {
    expect(() => assertDisposableRoyaltyLifecycleTarget(input)).toThrow("Refusing royalty lifecycle integration target");
  });
});
