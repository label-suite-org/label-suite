// Suggestions only: receipt text is untrusted, and money is reviewed before saving.
export function extractTourReceipt(text: string) {
  const lines = text.slice(0, 60000).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const totals = lines.flatMap((line, i) => {
    if (!/^(?:grand\s+total|total(?:\s+(?:due|amount|sale))?|amount\s+(?:due|paid))\b/i.test(line)) return [];
    const value = (line.match(/(?:[$€]|USD|CAD|EUR|DKK)?\s*(\d{1,6}[.,]\d{2})\s*(?:USD|CAD|EUR|DKK)?\s*$/i)
      ?? lines[i + 1]?.match(/^\$?\s*(\d{1,6}[.,]\d{2})$/))?.[1];
    return value ? [Math.round(Number(value.replace(',', '.')) * 100)] : [];
  });
  const currencies = [...new Set(text.match(/\b(?:USD|CAD|EUR|DKK)\b/g) ?? [])];
  const currency = currencies.length === 1 ? currencies[0] : null;
  const iso = text.match(/\b(20\d{2})[-/](\d{2})[-/](\d{2})\b/);
  const us = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2}|\d{2})\b/);
  const date = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : us ? `${us[3].length === 2 ? '20' : ''}${us[3]}-${us[1].padStart(2,'0')}-${us[2].padStart(2,'0')}` : null;
  const validDate = date && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date ? date : null;
  const category = /\b(gallons?|unleaded|diesel|fuel|gasoline)\b/i.test(text) ? 'Fuel' : /\b(hotel|motel|room rate|check.in)\b/i.test(text) ? 'Lodging' : /\b(restaurant|cafe|coffee|grill|diner|pizza)\b/i.test(text) ? 'Food' : 'Other';
  return { name: lines.find(l => /[a-z]{3}/i.test(l))?.slice(0,160) ?? '', amount: new Set(totals).size === 1 ? totals[0] : null,
    currency, date: validDate, category, person: null,
    warnings: [...(!currency ? ['Check currency; a dollar symbol alone does not identify USD or CAD.'] : []), ...(!validDate ? ['Check receipt date.'] : []),
      ...(new Set(totals).size !== 1 ? ['Check the total, including tax and tip.'] : []), 'Check who paid and whether this purchase is already recorded.'] };
}

export function receiptExpenseMatches(entries: {id: string; data: Record<string, unknown>}[], amount: number, currency: string) {
  // Equal totals remain candidates even when an imported booking has no reliable purchase date.
  return entries.filter(e => e.data.kind === 'expense' && e.data.amount === amount && e.data.currency === currency)
    .map(e => ({ id: e.id, name: String(e.data.note ?? e.data.source ?? 'Recorded expense').slice(0,240), date: e.data.date ?? null, person: e.data.person ?? 'Unassigned' }));
}
