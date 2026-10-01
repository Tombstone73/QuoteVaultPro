import type { Pool, PoolClient } from "pg";
import type { SalesWorkspaceHttpDependencies } from "../../src/interfaces/http/salesWorkspaceRoutes.js";
import type { QuoteFormReadPort, VerifiedV2PrincipalProvider } from "../../src/interfaces/http/quoteRoutes.js";
import type { ArtworkBinaryStorage } from "../artwork/artworkBinaryStorage.js";
import type { SalesWorkspaceTransaction } from "../../src/modules/sales/workspaceContracts.js";
import { SalesWorkspaceApplicationService } from "../../src/modules/sales/workspaceApplication.js";
import { SalesWorkspaceLineService } from "../../src/modules/sales/workspaceLines.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { explainPricingResult } from "../../src/modules/pricing/operatorPricingExplanation.js";
import {
  PostgresWorkspaceArtwork, promoteWorkspaceArtworkInTransaction,
  requestWorkspaceArtworkCleanupInTransaction,
} from "../artwork/postgresWorkspaceArtwork.js";
import { WorkspaceArtworkUploadService } from "../artwork/workspaceArtworkUpload.js";
import { PostgresSalesWorkspaceStore, PostgresSalesWorkspaceTransaction } from "./postgresSalesWorkspace.js";
import { PostgresWorkspaceLinePricing } from "./postgresWorkspaceLinePricing.js";
import { PostgresWorkspacePromotion } from "./postgresWorkspacePromotion.js";
import { PostgresQuoteTransaction } from "./postgresQuoteTransaction.js";
import { PostgresOrderTransaction } from "./postgresOrderTransaction.js";
import { PostgresOrderEditWorkspace } from "./postgresOrderEditWorkspace.js";
import { readOrderEditBlockedLines } from "./postgresOrderEditOperationalContext.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import { reconcileOrderInTransaction } from "./postgresOrderAutomaticLifecycle.js";
import { createCustomerCommercialPricingPort } from "../products/customerCommercialPricingPort.js";
import { assessOrderEditBillingInTransaction } from "../billing/postgresOrderEditSafety.js";
import {
  PostgresOrderEditArtwork, captureOrderEditArtworkFingerprint, captureOrderEditArtwork,
  validateOrderEditArtworkInTransaction, applyOrderEditArtworkInTransaction, authorizeOrderEditArtworkReplay,
} from "../artwork/postgresOrderEditArtwork.js";

const clientOf = (tx: SalesWorkspaceTransaction): PoolClient => {
  if (!(tx instanceof PostgresSalesWorkspaceTransaction)) throw new V2ApplicationError("INTERNAL_ERROR", "Workspace transaction composition is unavailable.");
  return tx.client;
};

/** The deployed composition is intentionally separate from the transaction
 * algorithms, so deterministic tests never import V1 database/provider setup. */
export function createSalesWorkspaceDependencies(input: Readonly<{
  pool: Pool;
  principals: VerifiedV2PrincipalProvider;
  formReads: QuoteFormReadPort;
  storage: ArtworkBinaryStorage;
}>): SalesWorkspaceHttpDependencies {
  const store = new PostgresSalesWorkspaceStore(input.pool);
  const artwork = new PostgresWorkspaceArtwork(input.pool, input.storage);
  const service = new SalesWorkspaceApplicationService(store, {
    onDiscard: (tx, workspace) => requestWorkspaceArtworkCleanupInTransaction(clientOf(tx), {
      organizationId: workspace.organizationId, workspaceId: workspace.id,
    }),
  });
  const orderEdits = new PostgresOrderEditWorkspace(input.pool, {
    orderTransaction: client => new PostgresOrderTransaction(client, undefined, createCustomerCommercialPricingPort(client)),
    billingEditGuard: async (client, context, orderId) => {
      return assessOrderEditBillingInTransaction(client, { organizationId: context.organizationId, orderId });
    },
    readProductionContext: readOrderEditBlockedLines,
    reconcileOrderInTransaction: async (client, organizationId, orderId) => { await reconcileOrderInTransaction(client, brandedId<"OrganizationId">(organizationId), brandedId<"OrderId">(orderId)); },
    artwork: client => ({
      captureFingerprint: (context, orderId) => captureOrderEditArtworkFingerprint(client, { context, orderId }),
      initializeWorkspace: async (context, workspace) => {
        await captureOrderEditArtwork(client, { context, workspaceId: workspace.id, orderId: workspace.sourceDocumentId!,
          lineMap: workspace.lines.map(line => ({ workspaceLineId: line.id, canonicalLineId: line.sourceLineId! })) });
      },
      validate: async (context, workspace) => {
        const result = await validateOrderEditArtworkInTransaction(client, { context, workspaceId: workspace.id, orderId: workspace.sourceDocumentId! });
        const retainedIds = new Set(workspace.lines.flatMap(line => line.sourceLineId ? [line.sourceLineId] : []));
        if (result.sourceLineIdsWithHistory.some(id => !retainedIds.has(id))) {
          throw new V2ApplicationError("CONFLICT", "Artwork history prevents removing this source line.");
        }
        return { changed: result.hasChanges };
      },
      apply: async (context, workspace, lineMap) => {
        const result = await applyOrderEditArtworkInTransaction(client, { context, workspaceId: workspace.id, orderId: workspace.sourceDocumentId!, lineMap });
        return { changed: Boolean(result.removedCount || result.promotedCount) };
      },
      authorizeReplay: (context, workspace) => authorizeOrderEditArtworkReplay(client, { context, workspaceId: workspace.id, orderId: workspace.sourceDocumentId! }),
    }),
  });
  return {
    service,
    orderEdits,
    orderEditArtwork: new PostgresOrderEditArtwork(input.pool),
    principals: input.principals,
    formReads: input.formReads,
    lines: new SalesWorkspaceLineService(store, {
      pricing: tx => new PostgresWorkspaceLinePricing(clientOf(tx)),
      releaseLineArtwork: (tx, workspace, lineId) => requestWorkspaceArtworkCleanupInTransaction(clientOf(tx), {
        organizationId: workspace.organizationId, workspaceId: workspace.id, workspaceLineId: lineId,
      }),
    }),
    promotion: new PostgresWorkspacePromotion(input.pool, promoteWorkspaceArtworkInTransaction, {
      quoteTransaction: client => new PostgresQuoteTransaction(client),
      orderTransaction: (client, pricing) => new PostgresOrderTransaction(client, undefined, pricing),
      orderEditHandler: orderEdits.saveInTransaction,
    }),
    artwork: {
      uploads: new WorkspaceArtworkUploadService(artwork, input.storage),
      lifecycle: artwork,
      download: (context, workspaceId, claimId) => artwork.download(context, workspaceId, claimId),
    },
    preview: (context, workspace, line) => store.run(async tx => {
      const previews = await new PostgresWorkspaceLinePricing(clientOf(tx)).preview(context, workspace.header, line, workspace.kind === "order_edit" ? "order" : undefined);
      const preview = previews.quote ?? previews.order;
      if (!preview) throw new V2ApplicationError("CONFLICT", "Pricing preview is unavailable.");
      return {
        calculatedUnitAmount: preview.pricingResult.calculatedUnitAmount,
        calculatedLineAmount: preview.pricingResult.calculatedLineAmount,
        currency: preview.pricingResult.currency,
        explanation: preview.explanation ?? explainPricingResult(preview.pricingResult),
      };
    }),
  };
}
