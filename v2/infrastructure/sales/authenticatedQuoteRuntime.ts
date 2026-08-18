import type { Pool } from "pg";
import type { RequestHandler } from "express";
import { PostgresPermissionAuthorityReader } from "../authorization/postgresPermissionAuthorityRead.js";
import { PermissionSetPrincipalIssuer } from "../../src/authorization/permissionSets.js";
import type { QuoteHttpDependencies } from "../../src/interfaces/http/quoteRoutes.js";
import { QuoteApplicationService } from "../../src/modules/sales/quoteApplication.js";
import { QuoteConversionApplicationService } from "../../src/modules/sales/quoteConversionApplication.js";
import { OrderApplicationService } from "../../src/modules/sales/orderApplication.js";
import {
  IssuedV2PrincipalProvider,
  type TrustedHostIdentitySource,
} from "../authentication/trustedHostPrincipalProvider.js";
import { PostgresQuoteTransactionRunner } from "./postgresQuoteTransaction.js";
import { PostgresOrderTransactionRunner } from "./postgresOrderTransaction.js";
import { PostgresQuoteConversionTransactionRunner } from "./postgresQuoteConversionTransaction.js";
import { PostgresQuoteFormReads } from "./postgresQuoteFormReads.js";
import { PostgresSalesWorkspaceReads } from "./postgresSalesWorkspaceReads.js";
import { PostgresCustomerWorkspaceReader } from "../compatibility/postgresCustomerWorkspaceRead.js";
import type { CustomerHttpDependencies } from "../../src/interfaces/http/customerRoutes.js";
import { PostgresContactWorkspaceReader } from "../compatibility/postgresContactWorkspaceRead.js";
import type { ContactHttpDependencies } from "../../src/interfaces/http/contactRoutes.js";
import { PostgresProductWorkspaceReads } from "../products/postgresProductWorkspaceReads.js";
import { PostgresProductDraftFormulaReader, PostgresProductDraftGeneralReader, PostgresProductDraftOptionsReader, PostgresProductDraftPricingMatrixReader, PostgresProductDraftPricingPreview, PostgresProductDraftPricingReader, PostgresProductVersionTransactionRunner } from "../products/postgresProductVersionLifecycle.js";
import type { ProductHttpDependencies } from "../../src/interfaces/http/productRoutes.js";
import { ProductVersionLifecycleApplicationService } from "../../src/modules/products/productVersionLifecycle.js";

export type AuthenticatedQuoteRuntimeDependencies = Readonly<{
  pool: Pool;
  trustedHostIdentity: TrustedHostIdentitySource;
  trustedHostMiddleware: RequestHandler;
}>;

export type AuthenticatedQuoteRuntime = Readonly<{
  dependencies: QuoteHttpDependencies;
  customerDependencies: CustomerHttpDependencies;
  contactDependencies: ContactHttpDependencies;
  productDependencies: ProductHttpDependencies;
  trustedHostMiddleware: RequestHandler;
}>;

/** Composition root for an authenticated human Quote request; Sales receives no raw session data. */
export const composeAuthenticatedQuoteRuntime = (
  input: AuthenticatedQuoteRuntimeDependencies,
): AuthenticatedQuoteRuntime => {
  const principalIssuer = new PermissionSetPrincipalIssuer(
    new PostgresPermissionAuthorityReader(input.pool),
  );
  const principals = new IssuedV2PrincipalProvider(input.trustedHostIdentity, principalIssuer);
  return {
    dependencies: {
      service: new QuoteApplicationService(
        new PostgresQuoteTransactionRunner(input.pool),
      ),
      conversion: new QuoteConversionApplicationService(
        new PostgresQuoteConversionTransactionRunner(input.pool),
        new OrderApplicationService(new PostgresOrderTransactionRunner(input.pool)),
      ),
      principals,
      formReads: new PostgresQuoteFormReads(input.pool),
      workspace: new PostgresSalesWorkspaceReads(input.pool),
    },
    customerDependencies: { customers: new PostgresCustomerWorkspaceReader(input.pool), principals },
    contactDependencies: { contacts: new PostgresContactWorkspaceReader(input.pool), principals },
    productDependencies: { workspace: new PostgresProductWorkspaceReads(input.pool), draftGeneral: new PostgresProductDraftGeneralReader(input.pool), draftOptions: new PostgresProductDraftOptionsReader(input.pool), draftPricing: new PostgresProductDraftPricingReader(input.pool), draftMatrix: new PostgresProductDraftPricingMatrixReader(input.pool), draftFormula: new PostgresProductDraftFormulaReader(input.pool), draftPreview: new PostgresProductDraftPricingPreview(input.pool), lifecycle: new ProductVersionLifecycleApplicationService(new PostgresProductVersionTransactionRunner(input.pool)), principals },
    trustedHostMiddleware: input.trustedHostMiddleware,
  };
};
