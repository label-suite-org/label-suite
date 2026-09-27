import Decimal from "decimal.js";

const decimalRoundingModes = {
  ROUND_UP: Decimal.ROUND_UP,
  ROUND_DOWN: Decimal.ROUND_DOWN,
  ROUND_CEIL: Decimal.ROUND_CEIL,
  ROUND_FLOOR: Decimal.ROUND_FLOOR,
  ROUND_HALF_UP: Decimal.ROUND_HALF_UP,
  ROUND_HALF_DOWN: Decimal.ROUND_HALF_DOWN,
  ROUND_HALF_EVEN: Decimal.ROUND_HALF_EVEN,
  ROUND_HALF_CEIL: Decimal.ROUND_HALF_CEIL,
  ROUND_HALF_FLOOR: Decimal.ROUND_HALF_FLOOR,
} as const;

// ISO 4217 List One (Current Currency & Funds), SIX Financial Information,
// retrieved 2026-08-10. This pinned registry deliberately avoids host ICU data.
const iso4217Currencies = new Set([
  "AED", "AFN", "ALL", "AMD", "AOA", "ARS", "AUD", "AWG", "AZN", "BAM", "BBD", "BDT", "BHD", "BIF", "BMD", "BND", "BOB", "BOV", "BRL", "BSD", "BTN", "BWP", "BYN", "BZD", "CAD", "CDF", "CHE", "CHF", "CHW", "CLF", "CLP", "CNY", "COP", "COU", "CRC", "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD", "EGP", "ERN", "ETB", "EUR", "FJD", "FKP", "GBP", "GEL", "GHS", "GIP", "GMD", "GNF", "GTQ", "GYD", "HKD", "HNL", "HTG", "HUF", "IDR", "ILS", "INR", "IQD", "IRR", "ISK", "JMD", "JOD", "JPY", "KES", "KGS", "KHR", "KMF", "KPW", "KRW", "KWD", "KYD", "KZT", "LAK", "LBP", "LKR", "LRD", "LSL", "LYD", "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP", "MRU", "MUR", "MVR", "MWK", "MXN", "MXV", "MYR", "MZN", "NAD", "NGN", "NIO", "NOK", "NPR", "NZD", "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG", "QAR", "RON", "RSD", "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK", "SGD", "SHP", "SLE", "SOS", "SRD", "SSP", "STN", "SVC", "SYP", "SZL", "THB", "TJS", "TMT", "TND", "TOP", "TRY", "TTD", "TWD", "TZS", "UAH", "UGX", "USD", "USN", "UYI", "UYU", "UYW", "UZS", "VED", "VES", "VND", "VUV", "WST", "XAD", "XAF", "XAG", "XAU", "XBA", "XBB", "XBC", "XBD", "XCD", "XCG", "XDR", "XOF", "XPD", "XPF", "XPT", "XSU", "XTS", "XUA", "XXX", "YER", "ZAR", "ZMW", "ZWG",
]);
const decimalStringPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const calculationPrecisionGuardDigits = 2;

export type MoneyRoundingMode = keyof typeof decimalRoundingModes;

export type MoneySpec = {
  currency: string;
  scale: number;
  roundingMode: MoneyRoundingMode;
};

export type Money = MoneySpec & {
  amount: string;
};

export type ResidualRecipient = {
  recipientId: string;
  share: string;
};

export type ResidualAllocation = {
  recipientId: string;
  money: Money;
};

function assertMoneySpec(spec: MoneySpec): void {
  if (!spec || typeof spec !== "object" || !iso4217Currencies.has(spec.currency)) {
    throw new RangeError("Invalid ISO 4217 currency");
  }
  if (!Number.isInteger(spec.scale) || spec.scale < 0) {
    throw new RangeError("Invalid money scale");
  }
  if (!Object.hasOwn(decimalRoundingModes, spec.roundingMode)) {
    throw new RangeError("Invalid money rounding mode");
  }
}

function parseMoneyAmount(amount: string, scale: number): void {
  if (typeof amount !== "string" || !decimalStringPattern.test(amount)) {
    throw new TypeError("Invalid money amount");
  }
  const fractionalDigits = amount.split(".")[1]?.length ?? 0;
  if (fractionalDigits > scale) {
    throw new RangeError("Invalid money amount");
  }
}

function parseDecimalFactor(factor: string): void {
  if (typeof factor !== "string" || !decimalStringPattern.test(factor)) {
    throw new TypeError("Invalid decimal factor");
  }
}

function parseResidualShare(share: string): void {
  if (typeof share !== "string" || !decimalStringPattern.test(share)) {
    throw new TypeError("Invalid residual share");
  }
}

function significantDigits(value: string): number {
  const digits = value.replace(/[.-]/g, "").replace(/^0+/, "");
  return digits.length || 1;
}

function calculationDecimal(values: readonly string[]): typeof Decimal {
  // Exact add/subtract/multiply results need no more than the sum of operand
  // significant digits; the guard covers carries during residual aggregation.
  const precision = values.reduce((total, value) => total + significantDigits(value), calculationPrecisionGuardDigits);
  return Decimal.clone({ precision });
}

function minorUnitString(scale: number): string {
  return scale === 0 ? "1" : `0.${"0".repeat(scale - 1)}1`;
}

function serializeDecimal(decimal: Decimal, spec: MoneySpec): Money {
  return {
    ...spec,
    amount: decimal.toFixed(spec.scale, decimalRoundingModes[spec.roundingMode]),
  };
}

function assertMoney(money: Money): void {
  assertMoneySpec(money);
  parseMoneyAmount(money.amount, money.scale);
  const DecimalForCalculation = calculationDecimal([money.amount]);
  const decimal = new DecimalForCalculation(money.amount);
  if (serializeDecimal(decimal, money).amount !== money.amount) {
    throw new TypeError("Invalid money amount");
  }
}

function assertSameCurrency(left: Money, right: Money): void {
  assertMoney(left);
  assertMoney(right);
  if (left.currency !== right.currency) {
    throw new RangeError("Money currency mismatch");
  }
  if (left.scale !== right.scale) {
    throw new RangeError("Money scale mismatch");
  }
  if (left.roundingMode !== right.roundingMode) {
    throw new RangeError("Money rounding mode mismatch");
  }
}

export function createMoney(amount: string, spec: MoneySpec): Money {
  assertMoneySpec(spec);
  parseMoneyAmount(amount, spec.scale);
  const DecimalForCalculation = calculationDecimal([amount]);
  const decimal = new DecimalForCalculation(amount);
  return serializeDecimal(decimal, spec);
}

export function addMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  const DecimalForCalculation = calculationDecimal([left.amount, right.amount]);
  return serializeDecimal(new DecimalForCalculation(left.amount).plus(right.amount), left);
}

export function subtractMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  const DecimalForCalculation = calculationDecimal([left.amount, right.amount]);
  return serializeDecimal(new DecimalForCalculation(left.amount).minus(right.amount), left);
}

export function multiplyMoney(money: Money, factor: string): Money {
  assertMoney(money);
  parseDecimalFactor(factor);
  const DecimalForCalculation = calculationDecimal([money.amount, factor]);
  return serializeDecimal(new DecimalForCalculation(money.amount).times(factor), money);
}

export function compareMoney(left: Money, right: Money): -1 | 0 | 1 {
  assertSameCurrency(left, right);
  const DecimalForCalculation = calculationDecimal([left.amount, right.amount]);
  return new DecimalForCalculation(left.amount).comparedTo(right.amount) as -1 | 0 | 1;
}

export function fromDatabaseString(amount: string, spec: MoneySpec): Money {
  return createMoney(amount, spec);
}

export function toDatabaseString(money: Money): string {
  assertMoney(money);
  return money.amount;
}

export function allocateResidual(
  total: Money,
  recipients: readonly ResidualRecipient[],
): ResidualAllocation[] {
  assertMoney(total);
  if (recipients.length === 0) {
    throw new RangeError("Residual allocation requires at least one recipient");
  }

  recipients.forEach((recipient) => parseResidualShare(recipient.share));
  const DecimalForCalculation = calculationDecimal([total.amount, ...recipients.map((recipient) => recipient.share)]);
  const shares = recipients.map((recipient) => new DecimalForCalculation(recipient.share));
  const shareTotal = shares.reduce((sum, share) => sum.plus(share), new DecimalForCalculation("0"));
  if (!shareTotal.equals("1")) {
    throw new RangeError("Residual allocation shares must total 1");
  }

  const totalDecimal = new DecimalForCalculation(total.amount);
  const minorUnit = new DecimalForCalculation(minorUnitString(total.scale));
  const allocatedAmounts = shares.map((share) => totalDecimal.times(share).toDecimalPlaces(total.scale, Decimal.ROUND_DOWN));
  let remaining = totalDecimal.minus(allocatedAmounts.reduce((sum, amount) => sum.plus(amount), new DecimalForCalculation("0")));

  for (let index = 0; index < allocatedAmounts.length && !remaining.isZero(); index += 1) {
    const adjustment = remaining.isPositive() ? minorUnit : minorUnit.negated();
    allocatedAmounts[index] = allocatedAmounts[index].plus(adjustment);
    remaining = remaining.minus(adjustment);
  }

  if (!remaining.isZero()) {
    throw new RangeError("Residual allocation could not be represented at the requested scale");
  }

  return recipients.map((recipient, index) => ({
    recipientId: recipient.recipientId,
    money: serializeDecimal(allocatedAmounts[index], total),
  }));
}
