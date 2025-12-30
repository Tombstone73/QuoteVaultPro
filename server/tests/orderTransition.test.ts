/**
 * Order Transition Validation Tests
 * 
 * Tests business logic for order status transitions.
 */

import { describe, it, expect } from '@jest/globals';
import { 
  validateOrderTransition, 
  getAllowedNextStatuses,
  isTerminalStatus,
  isOrderEditable,
  areLineItemsEditable,
  isPricingEditable,
  type TransitionContext 
} from '../server/services/orderTransition';
import type { Order } from '@shared/schema';

// Mock order factory
function createMockOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'test-order-id',
    organizationId: 'org_test',
    orderNumber: 'ORD-001',
    poNumber: null,
    label: null,
    quoteId: null,
    customerId: 'customer-1',
    contactId: null,
    status: 'new',
    priority: 'normal',
    fulfillmentStatus: 'pending',
    dueDate: new Date().toISOString(),
    promisedDate: null,
    subtotal: '100.00',
    tax: '0.00',
    taxRate: null,
    taxAmount: '0.00',
    taxableSubtotal: '100.00',
    total: '100.00',
    discount: '0.00',
    notesInternal: null,
    billToName: 'Test Customer',
    billToCompany: null,
    billToAddress1: null,
    billToAddress2: null,
    billToCity: null,
    billToState: null,
    billToPostalCode: null,
    billToCountry: null,
    billToPhone: null,
    billToEmail: null,
    shippingMethod: null,
    shippingMode: null,
    shipToName: null,
    shipToCompany: null,
    shipToAddress1: null,
    shipToAddress2: null,
    shipToCity: null,
    shipToState: null,
    shipToPostalCode: null,
    shipToCountry: null,
    shipToPhone: null,
    shipToEmail: null,
    carrier: null,
    carrierAccountNumber: null,
    shippingInstructions: null,
    trackingNumber: null,
    shippedAt: null,
    requestedDueDate: null,
    productionDueDate: null,
    shippingAddress: null,
    packingSlipHtml: null,
    externalAccountingId: null,
    syncStatus: null,
    syncError: null,
    syncedAt: null,
    startedProductionAt: null,
    completedProductionAt: null,
    canceledAt: null,
    cancellationReason: null,
    createdByUserId: 'user-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Order;
}

describe('Order Transition Validation', () => {
  describe('validateOrderTransition', () => {
    it('should allow new -> in_production with valid context', () => {
      const order = createMockOrder({ status: 'new', dueDate: new Date().toISOString(), billToName: 'Test' });
      const ctx: TransitionContext = {
        order,
        lineItemsCount: 1,
        attachmentsCount: 1,
      };

      const result = validateOrderTransition('new', 'in_production', ctx);
      expect(result.ok).toBe(true);
    });

    it('should reject new -> in_production without line items', () => {
      const order = createMockOrder({ status: 'new' });
      const ctx: TransitionContext = {
        order,
        lineItemsCount: 0,
      };

      const result = validateOrderTransition('new', 'in_production', ctx);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('NO_LINE_ITEMS');
      expect(result.message).toContain('at least one line item');
    });

    it('should reject new -> in_production without due date (default strict)', () => {
      const order = createMockOrder({ status: 'new', dueDate: null });
      const ctx: TransitionContext = {
        order,
        lineItemsCount: 1,
      };

      const result = validateOrderTransition('new', 'in_production', ctx);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('NO_DUE_DATE');
      expect(result.message).toContain('Due date is required');
      expect(result.message).toContain('organization policy');
    });

    it('should reject new -> in_production without billing info (default strict)', () => {
      const order = createMockOrder({ status: 'new', billToName: null, billToCompany: null });
      const ctx: TransitionContext = {
        order,
        lineItemsCount: 1,
      };

      const result = validateOrderTransition('new', 'in_production', ctx);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('NO_BILLING_INFO');
      expect(result.message).toContain('Billing information');
      expect(result.message).toContain('organization policy');
    });

    it('should warn when new -> in_production without attachments', () => {
      const order = createMockOrder({ status: 'new', dueDate: new Date().toISOString(), billToName: 'Test' });
      const ctx: TransitionContext = {
        order,
        lineItemsCount: 1,
        attachmentsCount: 0,
      };

      const result = validateOrderTransition('new', 'in_production', ctx);
      expect(result.ok).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings?.[0]).toContain('No artwork');
    });

    it('should allow in_production -> ready_for_shipment', () => {
      const order = createMockOrder({ status: 'in_production' });
      const ctx: TransitionContext = {
        order,
        lineItemsCount: 1,
      };

      const result = validateOrderTransition('in_production', 'ready_for_shipment', ctx);
      expect(result.ok).toBe(true);
    });

    it('should allow ready_for_shipment -> completed', () => {
      const order = createMockOrder({ status: 'ready_for_shipment', shippedAt: new Date().toISOString() });
      const ctx: TransitionContext = {
        order,
        lineItemsCount: 1,
        hasShippedAt: true,
      };

      const result = validateOrderTransition('ready_for_shipment', 'completed', ctx);
      expect(result.ok).toBe(true);
    });

    it('should reject completed -> any status (terminal)', () => {
      const order = createMockOrder({ status: 'completed' });
      const ctx: TransitionContext = {
        order,
        lineItemsCount: 1,
      };

      const result = validateOrderTransition('completed', 'new', ctx);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('COMPLETED_TERMINAL');
    });

    it('should reject canceled -> any status (terminal)', () => {
      const order = createMockOrder({ status: 'canceled' });
      const ctx: TransitionContext = {
        order,
        lineItemsCount: 1,
      };

      const result = validateOrderTransition('canceled', 'in_production', ctx);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('CANCELED_TERMINAL');
    });

    it('should reject same status transition', () => {
      const order = createMockOrder({ status: 'new' });
      const ctx: TransitionContext = {
        order,
        lineItemsCount: 1,
      };

      const result = validateOrderTransition('new', 'new', ctx);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('SAME_STATUS');
    });

    it('should reject invalid transition path', () => {
      const order = createMockOrder({ status: 'new' });
      const ctx: TransitionContext = {
        order,
        lineItemsCount: 1,
      };

      const result = validateOrderTransition('new', 'completed', ctx);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('INVALID_TRANSITION');
    });

    // === Configurable Validation Tests (Org Preferences) ===

    it('should allow new -> in_production without due date when org pref disabled', () => {
      const order = createMockOrder({ status: 'new', dueDate: null, billToName: 'Test' });
      const ctx: TransitionContext = {
        order,
        lineItemsCount: 1,
        orgPreferences: {
          orders: {
            requireDueDateForProduction: false,
          },
        },
      };

      const result = validateOrderTransition('new', 'in_production', ctx);
      expect(result.ok).toBe(true);
    });

    it('should allow new -> in_production without billing when org pref disabled', () => {
      const order = createMockOrder({ status: 'new', billToName: null, billToCompany: null, dueDate: new Date().toISOString() });
      const ctx: TransitionContext = {
        order,
        lineItemsCount: 1,
        orgPreferences: {
          orders: {
            requireBillingAddressForProduction: false,
          },
        },
      };

      const result = validateOrderTransition('new', 'in_production', ctx);
      expect(result.ok).toBe(true);
    });

    it('should allow new -> in_production without due date OR billing when both prefs disabled', () => {
      const order = createMockOrder({ status: 'new', dueDate: null, billToName: null, billToCompany: null });
      const ctx: TransitionContext = {
        order,
        lineItemsCount: 1,
        orgPreferences: {
          orders: {
            requireDueDateForProduction: false,
            requireBillingAddressForProduction: false,
          },
        },
      };

      const result = validateOrderTransition('new', 'in_production', ctx);
      expect(result.ok).toBe(true);
    });

    it('should reject new -> in_production without shipping address when org pref enabled', () => {
      const order = createMockOrder({ 
        status: 'new', 
        dueDate: new Date().toISOString(), 
        billToName: 'Test',
        shipToName: null,
        shipToCompany: null,
      });
      const ctx: TransitionContext = {
        order,
        lineItemsCount: 1,
        orgPreferences: {
          orders: {
            requireShippingAddressForProduction: true,
          },
        },
      };

      const result = validateOrderTransition('new', 'in_production', ctx);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('NO_SHIPPING_INFO');
      expect(result.message).toContain('Shipping information');
      expect(result.message).toContain('organization policy');
    });

    it('should ALWAYS require line items regardless of org preferences', () => {
      const order = createMockOrder({ status: 'new', dueDate: null, billToName: null, billToCompany: null });
      const ctx: TransitionContext = {
        order,
        lineItemsCount: 0, // Zero items
        orgPreferences: {
          orders: {
            requireDueDateForProduction: false,
            requireBillingAddressForProduction: false,
            requireShippingAddressForProduction: false,
          },
        },
      };

      const result = validateOrderTransition('new', 'in_production', ctx);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('NO_LINE_ITEMS');
      expect(result.message).toContain('at least one line item');
    });
  });

  describe('getAllowedNextStatuses', () => {
    it('should return correct next statuses for new', () => {
      const allowed = getAllowedNextStatuses('new');
      expect(allowed).toEqual(['in_production', 'on_hold', 'canceled']);
    });

    it('should return correct next statuses for in_production', () => {
      const allowed = getAllowedNextStatuses('in_production');
      expect(allowed).toEqual(['ready_for_shipment', 'on_hold', 'canceled']);
    });

    it('should return empty array for terminal statuses', () => {
      expect(getAllowedNextStatuses('completed')).toEqual([]);
      expect(getAllowedNextStatuses('canceled')).toEqual([]);
    });
  });

  describe('isTerminalStatus', () => {
    it('should identify terminal statuses', () => {
      expect(isTerminalStatus('completed')).toBe(true);
      expect(isTerminalStatus('canceled')).toBe(true);
      expect(isTerminalStatus('new')).toBe(false);
      expect(isTerminalStatus('in_production')).toBe(false);
    });
  });

  describe('isOrderEditable', () => {
    it('should allow editing for non-terminal statuses', () => {
      expect(isOrderEditable(createMockOrder({ status: 'new' }))).toBe(true);
      expect(isOrderEditable(createMockOrder({ status: 'in_production' }))).toBe(true);
    });

    it('should block editing for terminal statuses', () => {
      expect(isOrderEditable(createMockOrder({ status: 'completed' }))).toBe(false);
      expect(isOrderEditable(createMockOrder({ status: 'canceled' }))).toBe(false);
    });
  });

  describe('areLineItemsEditable', () => {
    it('should only allow line item edits in new status', () => {
      expect(areLineItemsEditable(createMockOrder({ status: 'new' }))).toBe(true);
      expect(areLineItemsEditable(createMockOrder({ status: 'in_production' }))).toBe(false);
      expect(areLineItemsEditable(createMockOrder({ status: 'completed' }))).toBe(false);
    });
  });

  describe('isPricingEditable', () => {
    it('should only allow pricing edits in new status', () => {
      expect(isPricingEditable(createMockOrder({ status: 'new' }))).toBe(true);
      expect(isPricingEditable(createMockOrder({ status: 'in_production' }))).toBe(false);
      expect(isPricingEditable(createMockOrder({ status: 'completed' }))).toBe(false);
    });
  });
});
