import type { RequestHandler } from "express";
import type { Pool } from "pg";
import { PermissionSetPrincipalIssuer } from "../../src/authorization/permissionSets.js";
import { BillingApplicationService } from "../../src/modules/billing/billingApplication.js";
import { BillingPaymentsApplicationService } from "../../src/modules/billing/paymentApplication.js";
import { FinancialReadApplicationService } from "../../src/modules/billing/financialReadApplication.js";
import type { InvoiceHttpDependencies } from "../../src/interfaces/http/invoiceRoutes.js";
import { PostgresPermissionAuthorityReader } from "../authorization/postgresPermissionAuthorityRead.js";
import { IssuedV2PrincipalProvider, type TrustedHostIdentitySource } from "../authentication/trustedHostPrincipalProvider.js";
import { PostgresBillingReadRunner } from "./postgresBillingRead.js";
import { PostgresBillingInvoiceTransactionRunner } from "./postgresBillingInvoiceTransaction.js";
import { PostgresBillingPaymentsTransactionRunner } from "./postgresBillingPaymentsTransaction.js";
import { PostgresFinancialReadRunner } from "./postgresFinancialRead.js";
import { PostgresInvoiceDocumentService } from "./postgresInvoiceDocuments.js";
import { StripeProviderIngress, productionStripeWebhookVerifier } from "./stripeProviderIngress.js";

export type AuthenticatedBillingRuntimeDependencies = Readonly<{ pool: Pool; trustedHostIdentity: TrustedHostIdentitySource; trustedHostMiddleware: RequestHandler }>;
export const composeAuthenticatedBillingRuntime = (input: AuthenticatedBillingRuntimeDependencies): Readonly<{ dependencies: InvoiceHttpDependencies & import("../../src/interfaces/http/financeRoutes.js").FinanceHttpDependencies & Readonly<{ stripeIngress: StripeProviderIngress }>; trustedHostMiddleware: RequestHandler }> => {
  const payments = new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(input.pool));
  return {
    dependencies: {
      service: new BillingApplicationService(new PostgresBillingReadRunner(input.pool), undefined, new PostgresBillingInvoiceTransactionRunner(input.pool)),
      payments,
      financialRead: new FinancialReadApplicationService(new PostgresFinancialReadRunner(input.pool)),
      documents: new PostgresInvoiceDocumentService(input.pool),
      principals: new IssuedV2PrincipalProvider(input.trustedHostIdentity, new PermissionSetPrincipalIssuer(new PostgresPermissionAuthorityReader(input.pool))),
      stripeIngress: new StripeProviderIngress(productionStripeWebhookVerifier(), payments),
    },
    trustedHostMiddleware: input.trustedHostMiddleware,
  };
};
