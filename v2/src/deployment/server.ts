import type { Server } from "node:http";
import { Pool } from "pg";
import {
  loadV2RuntimeConfig,
  requireV2DeploymentDatabaseUrl,
  type V2RuntimeConfig,
} from "../config/runtimeConfig.js";
import { createV2HttpApp } from "../interfaces/http/app.js";
import { createConsoleLogger, type V2Logger } from "../observability/logger.js";
import {
  createStandaloneStaffAuthentication,
  createV2SessionMiddleware,
  loadV2StandaloneAuthConfig,
  PostgresPortalCredentialLifecycle,
  PostgresStandalonePortalCredentialVerifier,
  PostgresStandaloneStaffCredentialVerifier,
  type StandaloneStaffAuthentication,
} from "../../infrastructure/authentication/standaloneStaffAuth.js";
import { composeAuthenticatedQuoteRuntime } from "../../infrastructure/sales/authenticatedQuoteRuntime.js";
import { composeAuthenticatedOrderRuntime } from "../../infrastructure/sales/authenticatedOrderRuntime.js";
import { OrderApplicationService } from "../modules/sales/orderApplication.js";
import { PostgresOrderTransactionRunner } from "../../infrastructure/sales/postgresOrderTransaction.js";
import { PostgresOrderAutomaticLifecycle } from "../../infrastructure/sales/postgresOrderAutomaticLifecycle.js";
import { ProductionApplicationService } from "../modules/production/productionApplication.js";
import { PostgresProductionTransactionRunner } from "../../infrastructure/production/postgresProductionTransaction.js";
import { FulfillmentApplicationService } from "../modules/fulfillment/fulfillmentApplication.js";
import { PostgresFulfillmentTransactionRunner } from "../../infrastructure/fulfillment/postgresFulfillmentTransaction.js";
import { RoutingLifecycleApplicationService } from "../modules/routing/routingLifecycle.js";
import { PostgresRoutingLifecycleTransactionRunner } from "../../infrastructure/routing/postgresRoutingLifecycleTransaction.js";
import { composeAuthenticatedBillingRuntime } from "../../infrastructure/billing/authenticatedBillingRuntime.js";
import { composeAuthenticatedArtworkRuntime } from "../../infrastructure/artwork/authenticatedArtworkRuntime.js";
import { composeAuthenticatedProofingRuntime } from "../../infrastructure/proofing/authenticatedProofingRuntime.js";
import { composeAuthenticatedPrepressRuntime } from "../../infrastructure/prepress/authenticatedPrepressRuntime.js";
import { composeAuthenticatedProductionRuntime } from "../../infrastructure/production/authenticatedProductionRuntime.js";
import { composeAuthenticatedFulfillmentRuntime } from "../../infrastructure/fulfillment/authenticatedFulfillmentRuntime.js";
import { composeAuthenticatedRoutingRuntime } from "../../infrastructure/routing/authenticatedRoutingRuntime.js";
import { composeAuthenticatedInventoryRuntime } from "../../infrastructure/inventory/authenticatedInventoryRuntime.js";
import { composeAuthenticatedFormulaRuntime } from "../../infrastructure/pricing/authenticatedFormulaRuntime.js";
import { composeAuthenticatedEmailIntegrationRuntime } from "../../infrastructure/communications/authenticatedEmailIntegrationRuntime.js";
import { composeAuthenticatedQuickBooksIntegrationRuntime } from "../../infrastructure/accounting/authenticatedQuickBooksIntegrationRuntime.js";
import { startV2QuickBooksBillingWorker } from "../../infrastructure/accounting/quickBooksBillingQueue.js";
import { startV2InvoiceEmailDeliveryWorker } from "../../infrastructure/communications/invoiceEmailDeliveryQueue.js";
import { startV2ProofEmailDeliveryWorker } from "../../infrastructure/communications/proofEmailDeliveryQueue.js";
import { resolveV2MutationWorkerStartup } from "./mutationWorkerStartup.js";
import { PostgresPortalProofRead } from "../../infrastructure/proofing/postgresPortalProofRead.js";
import { V2ApplicationError } from "../errors/applicationError.js";
import { PermissionSetPrincipalIssuer } from "../authorization/permissionSets.js";
import { PostgresPermissionAuthorityReader } from "../../infrastructure/authorization/postgresPermissionAuthorityRead.js";

export const createV2DeploymentApp = (
  config: V2RuntimeConfig,
  pool: Pool,
  logger: V2Logger,
  authentication: StandaloneStaffAuthentication,
) => {
  const { trustedHostIdentity, trustedHostMiddleware } = authentication;
  const orderLifecycle = new PostgresOrderAutomaticLifecycle(pool);
  const quote = composeAuthenticatedQuoteRuntime({ pool, trustedHostIdentity, trustedHostMiddleware });
  const order = composeAuthenticatedOrderRuntime({
    pool,
    trustedHostIdentity,
    trustedHostMiddleware,
    service: new OrderApplicationService(new PostgresOrderTransactionRunner(pool), undefined, orderLifecycle),
  });
  const billing = composeAuthenticatedBillingRuntime({ pool, trustedHostIdentity, trustedHostMiddleware, publicWebOrigin: authentication.publicWebOrigin, orderLifecycle });
  const artwork = composeAuthenticatedArtworkRuntime({ pool, trustedHostIdentity, trustedHostMiddleware });
  const proofing = composeAuthenticatedProofingRuntime({ pool, trustedHostIdentity, trustedHostMiddleware });
  const prepress = composeAuthenticatedPrepressRuntime({ pool, trustedHostIdentity, trustedHostMiddleware });
  const production = composeAuthenticatedProductionRuntime({ pool, trustedHostIdentity, trustedHostMiddleware, service: new ProductionApplicationService(new PostgresProductionTransactionRunner(pool), undefined, orderLifecycle) });
  const fulfillment = composeAuthenticatedFulfillmentRuntime({ pool, trustedHostIdentity, trustedHostMiddleware, service: new FulfillmentApplicationService(new PostgresFulfillmentTransactionRunner(pool), undefined, orderLifecycle) });
  const routing = composeAuthenticatedRoutingRuntime({ pool, trustedHostIdentity, trustedHostMiddleware, service: new RoutingLifecycleApplicationService(new PostgresRoutingLifecycleTransactionRunner(pool), undefined, orderLifecycle) });
  const inventory = composeAuthenticatedInventoryRuntime({ pool, trustedHostIdentity, trustedHostMiddleware });
  const formulas = composeAuthenticatedFormulaRuntime({ pool, trustedHostIdentity, trustedHostMiddleware });
  const emailIntegration = composeAuthenticatedEmailIntegrationRuntime({ pool, trustedHostIdentity, publicWebOrigin: authentication.publicWebOrigin });
  const quickBooksIntegration = composeAuthenticatedQuickBooksIntegrationRuntime({ pool, trustedHostIdentity, publicWebOrigin: authentication.publicWebOrigin });

  return createV2HttpApp(
    config,
    logger,
    async () => {
      try {
        await pool.query("SELECT 1");
        return { ready: true };
      } catch {
        return { ready: false };
      }
    },
    quote,
    order,
    billing,
    artwork,
    proofing,
    prepress,
    production,
    fulfillment,
    routing,
    authentication.install,
    inventory,
    formulas,
    emailIntegration,
    quickBooksIntegration,
    { principals: billing.dependencies.principals, connections:billing.dependencies.stripeConnect },
    { middleware: authentication.portalMiddleware, principal: authentication.portalPrincipal, proofing: proofing.dependencies.service, proofs: new PostgresPortalProofRead(pool,{file:async(organizationId,artworkFileId)=>{const file=await artwork.dependencies.delivery?.file(organizationId,artworkFileId);if(!file)throw new V2ApplicationError("NOT_FOUND","Proof file was not found.");return file;}}) },
  );
};

export type RunningV2DeploymentServer = Readonly<{ close: () => Promise<void> }>;

export const startV2DeploymentServer = async (
  environment: Readonly<Record<string, string | undefined>> = process.env,
  logger: V2Logger = createConsoleLogger(),
): Promise<RunningV2DeploymentServer> => {
  const databaseUrl = requireV2DeploymentDatabaseUrl(environment);
  const config = loadV2RuntimeConfig(environment);
  const mutationWorkers = resolveV2MutationWorkerStartup(environment);
  const authConfig = loadV2StandaloneAuthConfig(environment);
  const pool = new Pool({ connectionString: databaseUrl });
  const authentication = createStandaloneStaffAuthentication({
    verifier: new PostgresStandaloneStaffCredentialVerifier(pool),
    portalVerifier: new PostgresStandalonePortalCredentialVerifier(pool),
    portalLifecycle: new PostgresPortalCredentialLifecycle(pool, authConfig.publicWebOrigin),
    portalIssuer: new PermissionSetPrincipalIssuer(new PostgresPermissionAuthorityReader(pool)),
    config: authConfig,
    sessionMiddleware: createV2SessionMiddleware(databaseUrl, authConfig),
  });
  const app = createV2DeploymentApp(config, pool, logger, authentication);
  let stopQuickBooksWorker: (() => void) | null = null;
  let stopInvoiceEmailWorker: (() => void) | null = null;
  let stopProofEmailWorker: (() => void) | null = null;
  let server: Server | undefined;
  try {
    server = await new Promise<Server>((resolve, reject) => {
      const instance = app.listen(config.port, () => resolve(instance));
      instance.once("error", reject);
    });
    if (mutationWorkers.enabled) {
      stopQuickBooksWorker = startV2QuickBooksBillingWorker(pool, (event, data) => logger.log("info", event, data));
      stopInvoiceEmailWorker = startV2InvoiceEmailDeliveryWorker(pool, (event, data) => logger.log("info", event, data));
      stopProofEmailWorker = startV2ProofEmailDeliveryWorker(pool, (event, data) => logger.log("info", event, data));
    } else {
      logger.log("info", "v2.deployment.mutation_workers.disabled", {
        errorCode: `MUTATION_WORKERS_${mutationWorkers.reason.toUpperCase()}`,
      });
    }
  } catch (error) {
    stopInvoiceEmailWorker?.();
    stopProofEmailWorker?.();
    stopQuickBooksWorker?.();
    await pool.end();
    throw error;
  }

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
    stopQuickBooksWorker?.();
    stopInvoiceEmailWorker?.();
    stopProofEmailWorker?.();
    await pool.end();
    logger.log("info", "v2.deployment.stopped");
  };
  logger.log("info", "v2.deployment.started", { operationId: "startup" });
  return { close };
};

export const installV2DeploymentShutdownHandlers = (server: RunningV2DeploymentServer, logger: V2Logger): void => {
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log("info", "v2.deployment.shutdown.requested", { operationId: signal });
    void server.close().then(() => process.exit(0)).catch(() => process.exit(1));
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
};
