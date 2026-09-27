import { describe, expect, it, vi } from "vitest";
vi.mock("../lib/db", () => ({ db: {} }));
vi.mock("./integrations", () => ({ recordAuditEvent: vi.fn() }));
import { nativeContactCreateSchema, nativeContactUpdateSchema, parseNativeContactList } from "./native-contacts";

describe("native contact contract", () => {
  it("requires an explicit canonical identity kind and never accepts inferred records", () => {
    expect(nativeContactCreateSchema.safeParse({ name: "Same name" }).success).toBe(false);
    expect(nativeContactCreateSchema.safeParse({ kind: "person", name: "Same name", company: "Legacy field" }).success).toBe(false);
    expect(nativeContactCreateSchema.parse({ kind: "person", name: "Same name", role: "Manager" }).kind).toBe("person");
    expect(nativeContactCreateSchema.parse({ kind: "organization", name: "Same name", type: "Label" }).kind).toBe("organization");
  });

  it("requires revision for edits and explicit proposal decisions", () => {
    expect(nativeContactUpdateSchema.safeParse({ kind: "person", email: "new@example.test" }).success).toBe(false);
    expect(nativeContactUpdateSchema.safeParse({ kind: "person", expected_updated_at: "2026-09-17T10:00:00.000Z", type: "Label" }).success).toBe(false);
    expect(nativeContactUpdateSchema.safeParse({ kind: "organization", expected_updated_at: "2026-09-17T10:00:00.000Z", role: "Manager" }).success).toBe(false);
    expect(nativeContactUpdateSchema.safeParse({ kind: "person", expected_updated_at: "2026-09-17T10:00:00.000Z", company: "Legacy field" }).success).toBe(false);
  });

  it("caps list limits and rejects malformed cursors instead of widening a query", () => {
    expect(parseNativeContactList({ limit: "999", cursor: null, query: null, kind: "person" }).limit).toBe(50);
    expect(() => parseNativeContactList({ limit: "20", cursor: "not-a-cursor", query: null, kind: null })).toThrow("Invalid contact cursor");
    const malformed = Buffer.from(JSON.stringify({ name: "Taylor", id: "same-id" })).toString("base64url");
    expect(() => parseNativeContactList({ limit: "20", cursor: malformed, query: null, kind: null })).toThrow("Invalid contact cursor");
  });

  it("binds opaque cursors to their kind and normalized query scope", () => {
    const cursor = Buffer.from(JSON.stringify({ name: "Taylor", id: "same-id", kind: "organization", query: "taylor", filter_kind: null })).toString("base64url");
    expect(parseNativeContactList({ limit: "20", cursor, query: " Taylor ", kind: null }).cursor).toMatchObject({ kind: "organization", query: "taylor" });
    expect(() => parseNativeContactList({ limit: "20", cursor, query: "other", kind: null })).toThrow("Invalid contact cursor");
    expect(() => parseNativeContactList({ limit: "20", cursor, query: "taylor", kind: "organization" })).toThrow("Invalid contact cursor");
  });
});
