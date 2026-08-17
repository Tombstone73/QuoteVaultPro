import type { RequestHandler } from "express";
import type { Pool } from "pg";
import { PermissionSetPrincipalIssuer } from "../../src/authorization/permissionSets.js";
import { BillingApplicationService } from "../../src/modules/billing/billingApplication.js";
import type { InvoiceHttpDependencies } from "../../src/interfaces/http/invoiceRoutes.js";
import { PostgresPermissionAuthorityReader } from "../authorization/postgresPermissionAuthorityRead.js";
import { IssuedV2PrincipalProvider, type TrustedHostIdentitySource } from "../authentication/trustedHostPrincipalProvider.js";
import { PostgresBillingReadRunner } from "./postgresBillingRead.js";
import { PostgresBillingInvoiceTransactionRunner } from "./postgresBillingInvoiceTransaction.js";

export type AuthenticatedBillingRuntimeDependencies = Readonly<{ pool: Pool; trustedHostIdentity: TrustedHostIdentitySource; trustedHostMiddleware: RequestHandler }>;
export const composeAuthenticatedBillingRuntime = (input: AuthenticatedBillingRuntimeDependencies): Readonly<{ dependencies: InvoiceHttpDependencies; trustedHostMiddleware: RequestHandler }> => ({
  dependencies: {
    service: new BillingApplicationService(new PostgresBillingReadRunner(input.pool), undefined, new PostgresBillingInvoiceTransactionRunner(input.pool)),
    principals: new IssuedV2PrincipalProvider(input.trustedHostIdentity, new PermissionSetPrincipalIssuer(new PostgresPermissionAuthorityReader(input.pool))),
  },
  trustedHostMiddleware: input.trustedHostMiddleware,
});
