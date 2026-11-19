// The tests are explicit so a new database fixture cannot enter a routine lane
// through a filename pattern. TypeScript also checks these tests and imports.
export const lanes = {
  orders: {
    sources: [
      'server/routes/orders.routes.ts',
      'server/routes/orderStatusPillCatalog.routes.ts',
    ],
    tests: [
      'server/tests/orderStatusPillService.test.ts',
      'server/tests/orderStatusPillFilter.test.ts',
      'server/tests/orderStatusPillClosedGuard.test.ts',
      'server/tests/orderStatusPillCatalog.routes.test.ts',
      'server/tests/orderMutationAtomicity.contract.test.ts',
    ],
  },
  quotes: {
    sources: [
      'server/routes/quotes.routes.ts',
      'server/routes/email.routes.ts',
      'server/services/quotes/canonicalQuoteOperations.ts',
    ],
    tests: [
      'server/tests/quoteEmailRoute.test.ts',
      'server/tests/quoteConversionAtomicity.contract.test.ts',
      'server/tests/quoteCreateLineItemNormalizer.test.ts',
    ],
  },
  pricing: {
    sources: [
      'server/routes/pricing.routes.ts',
      'server/services/pricing/PricingService.ts',
    ],
    tests: [
      'server/services/pricing/tests/PricingService.basePrice.test.ts',
      'server/services/pricing/tests/PricingService.pricingMatrix.test.ts',
      'server/tests/pricingPreviewValidation.test.ts',
      'server/tests/orderChildLineItemPricing.contract.test.ts',
    ],
  },
  billing: {
    sources: [
      'server/routes/mvpInvoicing.routes.ts',
      'server/routes/groupedStripePayments.routes.ts',
      'server/routes/paymentProvider.routes.ts',
      'server/services/billing/canonicalInvoiceOperations.ts',
      'server/services/billing/canonicalPaymentOperations.ts',
    ],
    tests: [
      'server/tests/invoiceCustomerRelease.service.test.ts',
      'server/tests/epsPaymentProviderRoutes.test.ts',
      'server/tests/paymentEligibilityParity.contract.test.ts',
    ],
  },
  production: {
    sources: [
      'server/routes/productionJobs.routes.ts',
      'server/routes/productionRuns.routes.ts',
      'server/routes/fulfillment.routes.ts',
      'server/routes/bulkFulfillment.routes.ts',
    ],
    tests: [
      'server/tests/fulfillmentHistoryNote.test.ts',
      'server/tests/productionRunCompletionIntegrity.contract.test.ts',
      'server/tests/productionOwnership.unit.test.ts',
    ],
  },
  frontend: {
    sources: [
      'client/src/components/OrderStatusPillSelector.tsx',
      'client/src/hooks/useOrderStatusPills.ts',
      'client/src/contexts/WorkspaceContext.tsx',
    ],
    tests: [
      'client/src/components/OrderStatusPillSelector.test.tsx',
      'client/src/hooks/useOrderStatusPills.cache.test.ts',
      'client/src/contexts/WorkspaceContext.esm.test.tsx',
    ],
  },
};

export const laneNames = Object.keys(lanes);

export function expandLanes(names) {
  return [...new Set(names.flatMap((name) => (name === 'all' ? laneNames : [name])))];
}
