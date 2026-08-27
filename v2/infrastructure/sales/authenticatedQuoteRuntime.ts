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
import { PostgresCustomerDocumentService } from "./postgresCustomerDocuments.js";
import { PostgresQuoteDeliveryService } from "./postgresQuoteDelivery.js";
import { PostgresCustomerWorkspaceReader } from "../compatibility/postgresCustomerWorkspaceRead.js";
import { CanonicalCustomerCreationService } from "../customers/canonicalCustomerCreation.js";
import { CanonicalContactCreationService } from "../customers/canonicalContactCreation.js";
import type { CustomerHttpDependencies } from "../../src/interfaces/http/customerRoutes.js";
import { PostgresContactWorkspaceReader } from "../compatibility/postgresContactWorkspaceRead.js";
import type { ContactHttpDependencies } from "../../src/interfaces/http/contactRoutes.js";
import { PostgresProductWorkspaceReads } from "../products/postgresProductWorkspaceReads.js";
import { PostgresProductDraftFormulaReader, PostgresProductDraftGeneralReader, PostgresProductDraftOptionPricingReader, PostgresProductDraftOptionsReader, PostgresProductDraftPricingMatrixReader, PostgresProductDraftPricingPreview, PostgresProductDraftPricingReader, PostgresProductVersionTransactionRunner } from "../products/postgresProductVersionLifecycle.js";
import type { ProductHttpDependencies } from "../../src/interfaces/http/productRoutes.js";
import { ProductVersionLifecycleApplicationService } from "../../src/modules/products/productVersionLifecycle.js";
import { ProductRecipeApplicationService } from "../../src/modules/products/productRecipes.js";
import { PostgresProductMaterialSearch, PostgresProductRecipeTransactionRunner, PostgresProductWorkspaceRecipeReader } from "../products/postgresProductRecipes.js";
import { ProductPublicationApplicationService } from "../../src/modules/products/productPublication.js";
import { PostgresProductPublicationTransactionRunner } from "../products/postgresProductPublication.js";
import { PostgresProductDraftRoutingReader, PostgresProductRoutingTransactionRunner } from "../products/postgresProductRouting.js";
import { ProductRoutingApplicationService } from "../../src/modules/products/productRouting.js";
import { canonicalProductPublishOperations } from "../../../server/services/products/canonicalProductPublishOperations.js";
import { PostgresSalesTaxSettings } from "./postgresSalesTaxSettings.js";
import type { TaxSettingsHttpDependencies } from "../../src/interfaces/http/taxSettingsRoutes.js";

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
  taxSettingsDependencies: Omit<TaxSettingsHttpDependencies, "logger">;
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
  const service = new QuoteApplicationService(new PostgresQuoteTransactionRunner(input.pool));
  return {
    dependencies: {
      service,
      conversion: new QuoteConversionApplicationService(
        new PostgresQuoteConversionTransactionRunner(input.pool),
        new OrderApplicationService(new PostgresOrderTransactionRunner(input.pool)),
      ),
      principals,
      formReads: new PostgresQuoteFormReads(input.pool),
      workspace: new PostgresSalesWorkspaceReads(input.pool),
      documents: new PostgresCustomerDocumentService(input.pool),
      delivery: new PostgresQuoteDeliveryService(input.pool, service),
    },
    customerDependencies: (() => {
      const customers = new PostgresCustomerWorkspaceReader(input.pool);
      return { customers, creation: new CanonicalCustomerCreationService(customers), principals };
    })(),
    contactDependencies: (() => {
      const contacts = new PostgresContactWorkspaceReader(input.pool);
      return { contacts, creation: new CanonicalContactCreationService(contacts), principals };
    })(),
    productDependencies: { workspace: new PostgresProductWorkspaceReads(input.pool), draftGeneral: new PostgresProductDraftGeneralReader(input.pool), draftOptions: new PostgresProductDraftOptionsReader(input.pool), draftPricing: new PostgresProductDraftPricingReader(input.pool), draftMatrix: new PostgresProductDraftPricingMatrixReader(input.pool), draftFormula: new PostgresProductDraftFormulaReader(input.pool), draftOptionPricing: new PostgresProductDraftOptionPricingReader(input.pool), draftPreview: new PostgresProductDraftPricingPreview(input.pool), draftRecipe: new PostgresProductWorkspaceRecipeReader(input.pool), draftRouting: new PostgresProductDraftRoutingReader(input.pool), materials: new PostgresProductMaterialSearch(input.pool), recipes: new ProductRecipeApplicationService(new PostgresProductRecipeTransactionRunner(input.pool)), routing: new ProductRoutingApplicationService(new PostgresProductRoutingTransactionRunner(input.pool)), lifecycle: new ProductVersionLifecycleApplicationService(new PostgresProductVersionTransactionRunner(input.pool)), publication: new ProductPublicationApplicationService(new PostgresProductPublicationTransactionRunner(input.pool), canonicalProductPublishOperations), principals },
    taxSettingsDependencies: { settings: new PostgresSalesTaxSettings(input.pool), principals },
    trustedHostMiddleware: input.trustedHostMiddleware,
  };
};
