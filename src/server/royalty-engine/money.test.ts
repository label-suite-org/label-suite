import { describe, expect, it } from "vitest";
import { addMoney, createMoney } from "./money";

const dkk = {
  currency: "DKK",
  scale: 2,
  roundingMode: "ROUND_HALF_UP",
} as const;

const eur = {
  currency: "EUR",
  scale: 2,
  roundingMode: "ROUND_HALF_UP",
} as const;

const dkkMills = {
  currency: "DKK",
  scale: 3,
  roundingMode: "ROUND_HALF_UP",
} as const;

const dkkRoundDown = {
  currency: "DKK",
  scale: 2,
  roundingMode: "ROUND_DOWN",
} as const;

describe("royalty decimal money", () => {
  // Catches a regression to JavaScript-number arithmetic that serializes 0.1 + 0.2 imprecisely.
  it("adds decimal strings without binary floating-point drift", () => {
    const result = addMoney(
      createMoney("0.1", dkk),
      createMoney("0.2", dkk),
    );

    expect(result).toEqual({ amount: "0.30", ...dkk });
  });

  // Catches a subtraction implementation that drops or reverses negative royalty adjustments.
  it("preserves a negative decimal adjustment when subtracting money", async () => {
    const { subtractMoney } = await import("./money");
    const result = subtractMoney(
      createMoney("0.10", dkk),
      createMoney("0.30", dkk),
    );

    expect(result).toEqual({ amount: "-0.20", ...dkk });
  });

  // Catches multiplication that ignores the explicitly supplied rounding mode at a half-minor-unit boundary.
  it("multiplies by a decimal factor and rounds at the configured scale", async () => {
    const { multiplyMoney } = await import("./money");
    const result = multiplyMoney(createMoney("0.05", dkk), "0.5");

    expect(result).toEqual({ amount: "0.03", ...dkk });
  });

  // Catches unsafe acceptance of malformed, non-finite, exponent, or over-scale monetary input.
  it("rejects malformed monetary strings and incomplete money context", () => {
    for (const amount of ["1e2", "Infinity", "1.001", "01.00", ".50", "1."]) {
      expect(() => createMoney(amount, dkk)).toThrow("Invalid money amount");
    }

    expect(() => createMoney("1.00", { ...dkk, currency: "KRD" })).toThrow("Invalid ISO 4217 currency");
    expect(() => createMoney("1.00", { ...dkk, scale: 2.5 })).toThrow("Invalid money scale");
    expect(() => createMoney("1.00", { ...dkk, roundingMode: "ROUND_UNREVIEWED" } as never)).toThrow("Invalid money rounding mode");
  });

  // Catches arithmetic that silently combines values expressed in different ISO currencies.
  it("rejects arithmetic across different currencies", () => {
    expect(() => addMoney(
      createMoney("1.00", dkk),
      createMoney("1.00", eur),
    )).toThrow("Money currency mismatch");
  });

  // Catches lexical string ordering, which would incorrectly rank "10.00" below "2.00".
  it("compares decimal money values numerically", async () => {
    const { compareMoney } = await import("./money");

    expect(compareMoney(createMoney("2.00", dkk), createMoney("10.00", dkk))).toBe(-1);
    expect(compareMoney(createMoney("10.00", dkk), createMoney("10.00", dkk))).toBe(0);
    expect(compareMoney(createMoney("10.00", dkk), createMoney("2.00", dkk))).toBe(1);
  });

  // Catches database serialization that converts exact signed decimal strings through JavaScript numbers.
  it("round-trips canonical money through database strings exactly", async () => {
    const { fromDatabaseString, toDatabaseString } = await import("./money");
    const money = fromDatabaseString("-1234567890.10", dkk);

    expect(money).toEqual({ amount: "-1234567890.10", ...dkk });
    expect(toDatabaseString(money)).toBe("-1234567890.10");
  });

  // Catches residual allocation that loses a positive minor unit or ignores supplied recipient order.
  it("allocates a positive residual minor unit to the first recipient", async () => {
    const { allocateResidual } = await import("./money");
    const allocations = allocateResidual(createMoney("0.05", dkk), [
      { recipientId: "first", share: "0.5" },
      { recipientId: "second", share: "0.5" },
    ]);

    expect(allocations).toEqual([
      { recipientId: "first", money: { amount: "0.03", ...dkk } },
      { recipientId: "second", money: { amount: "0.02", ...dkk } },
    ]);
  });

  // Catches residual allocation that changes a negative adjustment's sign or assigns it out of order.
  it("allocates a negative residual minor unit to the first recipient", async () => {
    const { allocateResidual } = await import("./money");
    const allocations = allocateResidual(createMoney("-0.05", dkk), [
      { recipientId: "first", share: "0.5" },
      { recipientId: "second", share: "0.5" },
    ]);

    expect(allocations).toEqual([
      { recipientId: "first", money: { amount: "-0.03", ...dkk } },
      { recipientId: "second", money: { amount: "-0.02", ...dkk } },
    ]);
  });

  // Catches factor parsing that accepts exponent notation outside the canonical decimal-string contract.
  it("rejects exponent notation for multiplication factors", async () => {
    const { multiplyMoney } = await import("./money");

    expect(() => multiplyMoney(createMoney("1.00", dkk), "1e1")).toThrow("Invalid decimal factor");
  });

  // Catches residual allocation that accepts exponent notation for recipient shares.
  it("rejects exponent notation for residual shares", async () => {
    const { allocateResidual } = await import("./money");

    expect(() => allocateResidual(createMoney("1.00", dkk), [
      { recipientId: "first", share: "1e0" },
    ])).toThrow("Invalid residual share");
  });

  // Catches same-currency arithmetic that silently rounds a higher-scale operand to the left operand's scale.
  it("rejects arithmetic across different scales", () => {
    expect(() => addMoney(
      createMoney("1.00", dkk),
      createMoney("0.001", dkkMills),
    )).toThrow("Money scale mismatch");
  });

  // Catches arithmetic that silently adopts the left operand's reviewed rounding policy.
  it("rejects arithmetic across different rounding modes", () => {
    expect(() => addMoney(
      createMoney("1.00", dkk),
      createMoney("1.00", dkkRoundDown),
    )).toThrow("Money rounding mode mismatch");
  });

  // Catches callers bypassing construction and injecting exponent text through a structurally compatible Money object.
  it("rejects noncanonical money passed directly to arithmetic", () => {
    expect(() => addMoney(
      { amount: "1e2", ...dkk },
      createMoney("1.00", dkk),
    )).toThrow("Invalid money amount");
  });

  // Catches Decimal's default 20-significant-digit precision truncating an identity addition.
  it("preserves a large decimal value through identity addition", () => {
    const result = addMoney(
      createMoney("12345678901234567890.12", dkk),
      createMoney("0.00", dkk),
    );

    expect(result.amount).toBe("12345678901234567890.12");
  });

  // Catches Decimal's default 20-significant-digit precision dropping cents in large-value addition.
  it("adds a minor unit to a value with more than twenty significant digits", () => {
    const result = addMoney(
      createMoney("12345678901234567890.12", dkk),
      createMoney("0.01", dkk),
    );

    expect(result.amount).toBe("12345678901234567890.13");
  });

  // Catches Decimal's default 20-significant-digit precision dropping cents in large-value subtraction.
  it("subtracts a minor unit from a value with more than twenty significant digits", async () => {
    const { subtractMoney } = await import("./money");
    const result = subtractMoney(
      createMoney("12345678901234567890.12", dkk),
      createMoney("0.01", dkk),
    );

    expect(result.amount).toBe("12345678901234567890.11");
  });

  // Catches Decimal's default 20-significant-digit precision changing a large value during multiplication by one.
  it("preserves a large decimal value when multiplied by one", async () => {
    const { multiplyMoney } = await import("./money");
    const result = multiplyMoney(createMoney("12345678901234567890.12", dkk), "1");

    expect(result.amount).toBe("12345678901234567890.12");
  });

  // Catches precision loss that lets shares differing from one beyond twenty digits pass total validation.
  it("rejects residual shares that differ from one beyond twenty significant digits", async () => {
    const { allocateResidual } = await import("./money");

    expect(() => allocateResidual(createMoney("1.00", dkk), [
      { recipientId: "first", share: "0.5" },
      { recipientId: "second", share: "0.500000000000000000001" },
    ])).toThrow("Residual allocation shares must total 1");
  });

  // Catches precision loss in 50/50 allocation of a large total.
  it("allocates an exact large 50/50 total", async () => {
    const { allocateResidual } = await import("./money");
    const allocations = allocateResidual(createMoney("12345678901234567890.12", dkk), [
      { recipientId: "first", share: "0.5" },
      { recipientId: "second", share: "0.5" },
    ]);

    expect(allocations).toEqual([
      { recipientId: "first", money: { amount: "6172839450617283945.06", ...dkk } },
      { recipientId: "second", money: { amount: "6172839450617283945.06", ...dkk } },
    ]);
  });

  // Catches residual distribution that drops multiple large-total minor units or ignores supplied order.
  it("distributes multiple large-total residual units in supplied order", async () => {
    const { allocateResidual } = await import("./money");
    const allocations = allocateResidual(createMoney("12345678901234567890.05", dkk), [
      { recipientId: "first", share: "0.34" },
      { recipientId: "second", share: "0.33" },
      { recipientId: "third", share: "0.33" },
    ]);

    expect(allocations).toEqual([
      { recipientId: "first", money: { amount: "4197530826419753082.62", ...dkk } },
      { recipientId: "second", money: { amount: "4074074037407407403.72", ...dkk } },
      { recipientId: "third", money: { amount: "4074074037407407403.71", ...dkk } },
    ]);
  });

  // Catches platform-specific currency support that rejects valid ISO 4217 special-purpose codes.
  it("accepts reviewed ISO 4217 special-purpose codes", () => {
    for (const currency of ["XAU", "XTS", "XXX"]) {
      expect(createMoney("1.00", { ...dkk, currency }).amount).toBe("1.00");
    }
  });
});
