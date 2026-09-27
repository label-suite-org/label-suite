export function allocateAwardProportionally(
  awardAmount: number,
  allocations: Array<{ fundingNeedId: string; amountRequested: number }>,
) {
  const positive = allocations.map((allocation) => ({ ...allocation, amountRequested: Math.max(0, allocation.amountRequested) }));
  const totalRequested = positive.reduce((sum, allocation) => sum + allocation.amountRequested, 0);
  if (!totalRequested || awardAmount <= 0) return positive.map(({ fundingNeedId }) => ({ fundingNeedId, amountAwarded: 0 }));
  let remaining = Math.round(awardAmount * 100) / 100;
  return positive.map((allocation, index) => {
    const amountAwarded = index === positive.length - 1
      ? Math.max(0, Math.round(remaining * 100) / 100)
      : Math.round((awardAmount * allocation.amountRequested / totalRequested) * 100) / 100;
    remaining -= amountAwarded;
    return { fundingNeedId: allocation.fundingNeedId, amountAwarded };
  });
}

export function reportingTaskForAward(reportingDue: string | null | undefined) {
  if (!reportingDue) return null;
  const date = new Date(`${reportingDue}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() - 14);
  return { nextAction: "Submit funder report", nextActionDue: date.toISOString().slice(0, 10) };
}
