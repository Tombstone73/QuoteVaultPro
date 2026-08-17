import type { Server } from "node:http";
import type { RequestHandler } from "express";
import { Pool } from "pg";
import {
  loadV2RuntimeConfig,
  requireV2DeploymentDatabaseUrl,
  type V2RuntimeConfig,
} from "../config/runtimeConfig.js";
import { createV2HttpApp } from "../interfaces/http/app.js";
import { createConsoleLogger, type V2Logger } from "../observability/logger.js";
import type { TrustedHostIdentitySource } from "../../infrastructure/authentication/trustedHostPrincipalProvider.js";
import { composeAuthenticatedQuoteRuntime } from "../../infrastructure/sales/authenticatedQuoteRuntime.js";
import { composeAuthenticatedOrderRuntime } from "../../infrastructure/sales/authenticatedOrderRuntime.js";
import { OrderApplicationService } from "../modules/sales/orderApplication.js";
import { PostgresOrderTransactionRunner } from "../../infrastructure/sales/postgresOrderTransaction.js";
import { composeAuthenticatedBillingRuntime } from "../../infrastructure/billing/authenticatedBillingRuntime.js";
import { composeAuthenticatedArtworkRuntime } from "../../infrastructure/artwork/authenticatedArtworkRuntime.js";
import { composeAuthenticatedProofingRuntime } from "../../infrastructure/proofing/authenticatedProofingRuntime.js";
import { composeAuthenticatedPrepressRuntime } from "../../infrastructure/prepress/authenticatedPrepressRuntime.js";
import { composeAuthenticatedProductionRuntime } from "../../infrastructure/production/authenticatedProductionRuntime.js";
import { composeAuthenticatedFulfillmentRuntime } from "../../infrastructure/fulfillment/authenticatedFulfillmentRuntime.js";
import { composeAuthenticatedRoutingRuntime } from "../../infrastructure/routing/authenticatedRoutingRuntime.js";

const authConfigurationRequired: RequestHandler = (_request, response) => {
  response.status(503).json({
    code: "AUTH_CONFIGURATION_REQUIRED",
    message: "V2 authentication is not configured for this deployment.",
  });
};

/**
 * A standalone process must not assume the legacy Passport session. Until a
 * dedicated V2 session/auth adapter exists, every business route remains
 * closed; this is deliberately not a fixture login or a staff impersonation.
 */
class StandaloneAuthUnavailable implements TrustedHostIdentitySource {
  async authenticatedIdentity(): Promise<null> {
    return null;
  }
}

export const createV2DeploymentApp = (
  config: V2RuntimeConfig,
  pool: Pool,
  logger: V2Logger,
) => {
  const trustedHostIdentity = new StandaloneAuthUnavailable();
  const trustedHostMiddleware = authConfigurationRequired;
  const quote = composeAuthenticatedQuoteRuntime({ pool, trustedHostIdentity, trustedHostMiddleware });
  const order = composeAuthenticatedOrderRuntime({
    pool,
    trustedHostIdentity,
    trustedHostMiddleware,
    service: new OrderApplicationService(new PostgresOrderTransactionRunner(pool)),
  });
  const billing = composeAuthenticatedBillingRuntime({ pool, trustedHostIdentity, trustedHostMiddleware });
  const artwork = composeAuthenticatedArtworkRuntime({ pool, trustedHostIdentity, trustedHostMiddleware });
  const proofing = composeAuthenticatedProofingRuntime({ pool, trustedHostIdentity, trustedHostMiddleware });
  const prepress = composeAuthenticatedPrepressRuntime({ pool, trustedHostIdentity, trustedHostMiddleware });
  const production = composeAuthenticatedProductionRuntime({ pool, trustedHostIdentity, trustedHostMiddleware });
  const fulfillment = composeAuthenticatedFulfillmentRuntime({ pool, trustedHostIdentity, trustedHostMiddleware });
  const routing = composeAuthenticatedRoutingRuntime({ pool, trustedHostIdentity, trustedHostMiddleware });

  return createV2HttpApp(
    config,
    logger,
    async () => {
      try {
        await pool.query("SELECT 1");
        return { ready: false };
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
  );
};

export type RunningV2DeploymentServer = Readonly<{ close: () => Promise<void> }>;

export const startV2DeploymentServer = async (
  environment: Readonly<Record<string, string | undefined>> = process.env,
  logger: V2Logger = createConsoleLogger(),
): Promise<RunningV2DeploymentServer> => {
  const databaseUrl = requireV2DeploymentDatabaseUrl(environment);
  const config = loadV2RuntimeConfig(environment);
  const pool = new Pool({ connectionString: databaseUrl });
  const app = createV2DeploymentApp(config, pool, logger);
  let server: Server | undefined;
  try {
    server = await new Promise<Server>((resolve, reject) => {
      const instance = app.listen(config.port, () => resolve(instance));
      instance.once("error", reject);
    });
  } catch (error) {
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
