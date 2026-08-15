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
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { issueV2CsrfToken, issueV2SessionScope, requireV2CsrfToken } from "../../../infrastructure/authentication/sessionCsrf.js";

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
    app.get(
      "/v2/organizations/:organizationId/ui-bootstrap",
      quote.trustedHostMiddleware,
      async (request, response) => {
        try {
          // This opaque session epoch is intentionally not authority. Emit it
          // before the capability decision so a safely denied old tenant
          // request can still clear a browser session that was replaced.
          response.setHeader("x-v2-session-scope", issueV2SessionScope(request));
          const organizationId = request.params.organizationId;
          const principal = await quote.dependencies.principals.principal(
            request,
            organizationId,
          );
          const policy = new AuthorityPolicy();
          if (!policy.decide(principal, { capability: "quote.view", resource: { organizationId } }).allowed)
            return response.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Quote access is unavailable." } });
          return response.status(200).json({
            ok: true,
            data: {
              organizationId,
              csrfToken: issueV2CsrfToken(request),
              sessionScope: issueV2SessionScope(request),
              capabilities: {
                quoteOverridePrice: policy.decide(principal, { capability: "quote.overridePrice", resource: { organizationId } }).allowed,
              },
            },
          });
        } catch {
          return response.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Authenticated access is required." } });
        }
      },
    );
  if (quote)
    app.use(
      "/v2/organizations/:organizationId/quotes",
      quote.trustedHostMiddleware,
      (request, response, next) => {
        try {
          response.setHeader("x-v2-session-scope", issueV2SessionScope(request));
        } catch {
          // The principal provider remains responsible for the opaque auth denial.
        }
        next();
      },
      requireV2CsrfToken,
      createQuoteRouter(quote.dependencies),
    );

  app.use((_request, response) =>
    response.status(404).json({ code: "NOT_FOUND" }),
  );
  return app;
};
