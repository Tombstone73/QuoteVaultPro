import base from './jest.config.js';

// Real local PostgreSQL, canonical migrations, no deployed Neon/WebSocket proxy.
export default {
  ...base,
  testMatch: [
    '**/tests/portalStorefrontCheckout.postgres.test.ts',
    '**/tests/printBridgeConnection.postgres.integration.ts',
    '**/tests/epsCallbackBoundary.postgres.integration.ts',
    '**/tests/quoteListSearch.postgres.integration.ts',
    '**/tests/inboundEmail.postgres.integration.ts',
    '**/tests/inboundEmailImport.postgres.integration.ts',
    '**/tests/inboundGmailAcknowledgement.postgres.integration.ts',
    '**/tests/artworkWorkflow.postgres.integration.ts',
    '**/tests/quoteRoutingAndConversion.contract.test.ts',
    '**/tests/shipmentTracking.postgres.integration.ts',
    '**/tests/proofFileLifecycle.postgres.integration.ts',
    '**/tests/redoOrders.postgres.integration.ts',
    '**/tests/fulfillmentCustomerAddress.postgres.integration.ts',
    '**/tests/orderDeadline.postgres.integration.ts',
    '**/tests/paymentEntryReconciliation.postgres.integration.ts',
    '**/tests/paymentReceiptHistory.postgres.integration.ts',
    '**/tests/quickbooksCustomerStateRepair.postgres.integration.ts',
  ],
  setupFilesAfterEnv: ['<rootDir>/server/tests/setupInboundPostgres.ts'],
  moduleNameMapper: {
    '^@neondatabase/serverless$': '<rootDir>/server/tests/helpers/localPostgresDriver.mjs',
    '^drizzle-orm/neon-serverless$': 'drizzle-orm/node-postgres',
    '^drizzle-orm/neon-serverless/migrator$': 'drizzle-orm/node-postgres/migrator',
    ...base.moduleNameMapper,
  },
};
