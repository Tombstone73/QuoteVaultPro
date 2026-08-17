import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import {
  loadV2RuntimeConfig,
  type V2RuntimeConfig,
} from "./config/runtimeConfig.js";
import { createV2HttpApp } from "./interfaces/http/app.js";
import {
  composeAuthenticatedQuoteRuntime,
  type AuthenticatedQuoteRuntimeDependencies,
} from "../infrastructure/sales/authenticatedQuoteRuntime.js";
import {
  composeAuthenticatedOrderRuntime,
  type AuthenticatedOrderRuntimeDependencies,
} from "../infrastructure/sales/authenticatedOrderRuntime.js";
import { createConsoleLogger, type V2Logger } from "./observability/logger.js";
import { composeAuthenticatedBillingRuntime, type AuthenticatedBillingRuntimeDependencies } from "../infrastructure/billing/authenticatedBillingRuntime.js";
import { composeAuthenticatedArtworkRuntime, type AuthenticatedArtworkRuntimeDependencies } from "../infrastructure/artwork/authenticatedArtworkRuntime.js";
import { composeAuthenticatedProofingRuntime, type AuthenticatedProofingRuntimeDependencies } from "../infrastructure/proofing/authenticatedProofingRuntime.js";
import { composeAuthenticatedPrepressRuntime, type AuthenticatedPrepressRuntimeDependencies } from "../infrastructure/prepress/authenticatedPrepressRuntime.js";
import { composeAuthenticatedProductionRuntime, type AuthenticatedProductionRuntimeDependencies } from "../infrastructure/production/authenticatedProductionRuntime.js";

export type RunningV2Server = Readonly<{
  close: () => Promise<void>;
}>;

export const startV2Server = async (
  config: V2RuntimeConfig = loadV2RuntimeConfig(),
  logger: V2Logger = createConsoleLogger(),
  dependencies: Readonly<{
    authenticatedQuote?: AuthenticatedQuoteRuntimeDependencies;
    authenticatedOrder?: AuthenticatedOrderRuntimeDependencies;
    authenticatedBilling?: AuthenticatedBillingRuntimeDependencies;
    authenticatedArtwork?: AuthenticatedArtworkRuntimeDependencies;
    authenticatedProofing?: AuthenticatedProofingRuntimeDependencies;
    authenticatedPrepress?: AuthenticatedPrepressRuntimeDependencies;
    authenticatedProduction?: AuthenticatedProductionRuntimeDependencies;
  }> = {},
): Promise<RunningV2Server> => {
  const quote = dependencies.authenticatedQuote
    ? composeAuthenticatedQuoteRuntime(dependencies.authenticatedQuote)
    : undefined;
  const order = dependencies.authenticatedOrder
    ? composeAuthenticatedOrderRuntime(dependencies.authenticatedOrder)
    : undefined;
  const billing = dependencies.authenticatedBilling ? composeAuthenticatedBillingRuntime(dependencies.authenticatedBilling) : undefined;
  const artwork = dependencies.authenticatedArtwork ? composeAuthenticatedArtworkRuntime(dependencies.authenticatedArtwork) : undefined;
  const proofing = dependencies.authenticatedProofing ? composeAuthenticatedProofingRuntime(dependencies.authenticatedProofing) : undefined;
  const prepress = dependencies.authenticatedPrepress ? composeAuthenticatedPrepressRuntime(dependencies.authenticatedPrepress) : undefined;
  const production = dependencies.authenticatedProduction ? composeAuthenticatedProductionRuntime(dependencies.authenticatedProduction) : undefined;
  const app = createV2HttpApp(config, logger, undefined, quote, order, billing, artwork, proofing, prepress, production);
  const server = await new Promise<Server>((resolve, reject) => {
    const instance = app.listen(config.port, () => resolve(instance));
    instance.once("error", reject);
  });

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    logger.log("info", "v2.stopped");
  };

  logger.log("info", "v2.started", { operationId: "startup" });
  return { close };
};

const installShutdownHandlers = (
  server: RunningV2Server,
  logger: V2Logger,
): void => {
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log("info", "v2.shutdown.requested", { operationId: signal });
    void server
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const logger = createConsoleLogger();
  startV2Server(loadV2RuntimeConfig(), logger)
    .then((server) => installShutdownHandlers(server, logger))
    .catch((error: unknown) => {
      logger.log("error", "v2.startup.failed", { errorCode: "INTERNAL_ERROR" });
      process.exitCode = 1;
    });
}
