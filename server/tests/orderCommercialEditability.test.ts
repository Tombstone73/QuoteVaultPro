import { describe, expect, it } from '@jest/globals';
import {
  isLineItemCommerciallyEditable,
  isOrderCommerciallyEditable,
} from '@shared/orderCommercialEditability';

describe('commercial order editability', () => {
  it('keeps legacy completed and production-complete Orders commercially editable', () => {
    expect(isOrderCommerciallyEditable({ status: 'completed', state: 'closed' })).toBe(true);
    expect(isOrderCommerciallyEditable({ status: 'in_production', state: 'production_complete' })).toBe(true);
  });

  it('protects cancelled and voided commercial records', () => {
    expect(isOrderCommerciallyEditable({ status: 'cancelled' })).toBe(false);
    expect(isOrderCommerciallyEditable({ status: 'new', canceledAt: new Date() })).toBe(false);
    expect(isLineItemCommerciallyEditable({ workflowState: 'voided' })).toBe(false);
  });

  it('allows a legacy complete line item price correction', () => {
    expect(isLineItemCommerciallyEditable({ status: 'complete', workflowState: 'completed' })).toBe(true);
  });
});
