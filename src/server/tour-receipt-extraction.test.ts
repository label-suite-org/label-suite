import { describe, expect, it } from 'vitest';
import { extractTourReceipt, receiptExpenseMatches } from './tour-receipt-extraction';
describe('receipt suggestions', () => {
  it('extracts an explicit total without confusing subtotal, tax or dollar currency', () => {
    expect(extractTourReceipt('Iconic Diner\n10/19/2026\nSubtotal 20.00\nTax 2.00\nTOTAL $22.00\nUSD')).toMatchObject({name:'Iconic Diner',date:'2026-10-19',amount:2200,currency:'USD',category:'Food',person:null});
    expect(extractTourReceipt('TOTAL $22.00').currency).toBeNull();
    expect(extractTourReceipt('TOTAL 22.00\nTOTAL WITH TIP 26.00').amount).toBeNull();
    expect(extractTourReceipt('2026-02-31\nTOTAL 12.00\nUSD CAD').date).toBeNull();
    expect(extractTourReceipt('USD CAD').currency).toBeNull();
  });
  it('treats imported expenses with missing dates as possible duplicates, excluding income', () => {
    expect(receiptExpenseMatches([{id:'booking',data:{kind:'expense',amount:9900,currency:'USD'}},{id:'sale',data:{kind:'merch_card',amount:9900,currency:'USD'}}],9900,'USD').map(r=>r.id)).toEqual(['booking']);
  });
});
