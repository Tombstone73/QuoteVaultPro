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
  return {
    service,
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
    }),
    artwork: {
      uploads: new WorkspaceArtworkUploadService(artwork, input.storage),
      lifecycle: artwork,
      download: (context, workspaceId, claimId) => artwork.download(context, workspaceId, claimId),
    },
    preview: (context, workspace, line) => store.run(async tx => {
      const previews = await new PostgresWorkspaceLinePricing(clientOf(tx)).preview(context, workspace.header, line);
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
