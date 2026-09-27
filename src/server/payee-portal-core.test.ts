import { describe, expect, it } from "vitest";
import {
  findPayeeContact,
  isPayeeVisiblePayoutStatus,
  isPublishedStatementStatus,
  normalizePayeeEmail,
} from "./payee-portal-core";

describe("payee portal identity and publication rules", () => {
  it("normalizes the authenticated email before binding it to a same-tenant contact", () => {
    expect(normalizePayeeEmail("  PAYEE@Example.com ")).toBe("payee@example.com");
    expect(findPayeeContact([
      { id: "contact-a", name: "A", email: "other@example.com" },
      { id: "contact-payee", name: "Payee", email: "payee@example.com" },
    ], "PAYEE@example.com")).toMatchObject({ id: "contact-payee" });
  });

  it("does not resolve a contact without a usable email", () => {
    expect(findPayeeContact([{ id: "contact-a", name: "A", email: null }], " ")).toBeNull();
  });

  it("exposes only issued or closed statements and recorded payouts", () => {
    expect(isPublishedStatementStatus("draft")).toBe(false);
    expect(isPublishedStatementStatus("calculated")).toBe(false);
    expect(isPublishedStatementStatus("reviewed")).toBe(false);
    expect(isPublishedStatementStatus("issued")).toBe(true);
    expect(isPublishedStatementStatus("closed")).toBe(true);
    expect(isPayeeVisiblePayoutStatus("approved")).toBe(false);
    expect(isPayeeVisiblePayoutStatus("recorded")).toBe(true);
  });
});
