export function formatCoverageMoney(amount: number, currency = "DKK"): string {
  try {
    return new Intl.NumberFormat("da-DK", {
      style: "currency", currency, maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${Math.round(amount).toLocaleString("da-DK")} ${currency}`;
  }
}
