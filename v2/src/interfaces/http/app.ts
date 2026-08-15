import express, {
  type Express,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import type { V2RuntimeConfig } from "../../config/runtimeConfig.js";
import type { V2Logger } from "../../observability/logger.js";
import {
  createQuoteRouter,
  type QuoteHttpDependencies,
} from "./quoteRoutes.js";

export type ReadinessProbe = () => Promise<Readonly<{ ready: boolean }>>;
export type AuthenticatedQuoteRouteRuntime = Readonly<{
  dependencies: QuoteHttpDependencies;
  trustedHostMiddleware: RequestHandler;
}>;

export const createV2HttpApp = (
  config: V2RuntimeConfig,
  logger: V2Logger,
  readinessProbe: ReadinessProbe = async () => ({ ready: true }),
  quote?: AuthenticatedQuoteRouteRuntime,
): Express => {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request: Request, response: Response) => {
    response.status(200).json({ status: "ok", service: config.serviceName });
  });

  app.get("/ready", async (_request: Request, response: Response) => {
    try {
      const readiness = await readinessProbe();
      response.status(readiness.ready ? 200 : 503).json({
        status: readiness.ready ? "ready" : "not_ready",
        checks: { application: readiness.ready ? "ok" : "unavailable" },
      });
    } catch {
      logger.log("warn", "v2.readiness.failed");
      response
        .status(503)
        .json({ status: "not_ready", checks: { application: "unavailable" } });
    }
  });
  if (quote)
    app.use(
      "/v2/organizations/:organizationId/quotes",
      quote.trustedHostMiddleware,
      createQuoteRouter(quote.dependencies),
    );

  app.use((_request, response) =>
    response.status(404).json({ code: "NOT_FOUND" }),
  );
  return app;
};
