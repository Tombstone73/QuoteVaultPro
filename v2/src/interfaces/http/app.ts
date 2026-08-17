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
import {
  createOrderRouter,
  type OrderHttpDependencies,
} from "./orderRoutes.js";
import { createInvoiceRouter, type InvoiceHttpDependencies } from "./invoiceRoutes.js";
import { createFinanceRouter, type FinanceHttpDependencies } from "./financeRoutes.js";
import { createArtworkRouter, type ArtworkHttpDependencies } from "./artworkRoutes.js";
import { createProofingRouter, type ProofingHttpDependencies } from "./proofingRoutes.js";
import { createPrepressRouter, type PrepressHttpDependencies } from "./prepressRoutes.js";
import { createProductionRouter, type ProductionHttpDependencies } from "./productionRoutes.js";
import { createFulfillmentRouter, type FulfillmentHttpDependencies } from "./fulfillmentRoutes.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { issueV2CsrfToken, issueV2SessionScope, requireV2CsrfToken } from "../../../infrastructure/authentication/sessionCsrf.js";

export type ReadinessProbe = () => Promise<Readonly<{ ready: boolean }>>;
export type AuthenticatedQuoteRouteRuntime = Readonly<{
  dependencies: QuoteHttpDependencies;
  trustedHostMiddleware: RequestHandler;
}>;
export type AuthenticatedOrderRouteRuntime = Readonly<{
  dependencies: OrderHttpDependencies;
  trustedHostMiddleware: RequestHandler;
}>;
export type AuthenticatedBillingRouteRuntime = Readonly<{ dependencies: InvoiceHttpDependencies & FinanceHttpDependencies; trustedHostMiddleware: RequestHandler }>;
export type AuthenticatedArtworkRouteRuntime = Readonly<{ dependencies: ArtworkHttpDependencies; trustedHostMiddleware: RequestHandler }>;
export type AuthenticatedProofingRouteRuntime = Readonly<{ dependencies: ProofingHttpDependencies; trustedHostMiddleware: RequestHandler }>;
export type AuthenticatedPrepressRouteRuntime = Readonly<{ dependencies: PrepressHttpDependencies; trustedHostMiddleware: RequestHandler }>;
export type AuthenticatedProductionRouteRuntime = Readonly<{ dependencies: ProductionHttpDependencies; trustedHostMiddleware: RequestHandler }>;
export type AuthenticatedFulfillmentRouteRuntime = Readonly<{ dependencies: FulfillmentHttpDependencies; trustedHostMiddleware: RequestHandler }>;

export const createV2HttpApp = (
  config: V2RuntimeConfig,
  logger: V2Logger,
  readinessProbe: ReadinessProbe = async () => ({ ready: true }),
  quote?: AuthenticatedQuoteRouteRuntime,
  order?: AuthenticatedOrderRouteRuntime,
  billing?: AuthenticatedBillingRouteRuntime,
  artwork?: AuthenticatedArtworkRouteRuntime,
  proofing?: AuthenticatedProofingRouteRuntime,
  prepress?: AuthenticatedPrepressRouteRuntime,
  production?: AuthenticatedProductionRouteRuntime,
  fulfillment?: AuthenticatedFulfillmentRouteRuntime,
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
                quoteCreate: policy.decide(principal, { capability: "quote.create", resource: { organizationId } }).allowed,
                quoteEdit: policy.decide(principal, { capability: "quote.edit", resource: { organizationId } }).allowed,
                quoteSend: policy.decide(principal, { capability: "quote.send", resource: { organizationId } }).allowed,
                quoteConvert: policy.decide(principal, { capability: "quote.convert", resource: { organizationId } }).allowed,
                orderView: policy.decide(principal, { capability: "order.view", resource: { organizationId } }).allowed,
                orderEdit: policy.decide(principal, { capability: "order.edit", resource: { organizationId } }).allowed,
                orderOverridePrice: policy.decide(principal, { capability: "order.overridePrice", resource: { organizationId } }).allowed,
                invoiceView: policy.decide(principal, { capability: "invoice.view", resource: { organizationId } }).allowed,
                invoiceIssue: policy.decide(principal, { capability: "invoice.issue", resource: { organizationId } }).allowed,
                paymentView: policy.decide(principal, { capability: "payment.view", resource: { organizationId } }).allowed,
                paymentRecord: policy.decide(principal, { capability: "payment.record", resource: { organizationId } }).allowed,
                refundIssue: policy.decide(principal, { capability: "refund.issue", resource: { organizationId } }).allowed,
                artworkView: policy.decide(principal, { capability: "artwork.view", resource: { organizationId } }).allowed,
                artworkAssign: policy.decide(principal, { capability: "artwork.assign", resource: { organizationId } }).allowed,
                proofView: policy.decide(principal, { capability: "proof.view", resource: { organizationId } }).allowed,
                proofPrepare: policy.decide(principal, { capability: "proof.prepare", resource: { organizationId } }).allowed,
                proofIssue: policy.decide(principal, { capability: "proof.issue", resource: { organizationId } }).allowed,
                proofRespond: policy.decide(principal, { capability: "proof.respond", resource: { organizationId } }).allowed,
                prepressView: policy.decide(principal, { capability: "prepress.view", resource: { organizationId } }).allowed,
                prepressWork: policy.decide(principal, { capability: "prepress.work", resource: { organizationId } }).allowed,
                prepressComplete: policy.decide(principal, { capability: "prepress.complete", resource: { organizationId } }).allowed,
                productionView: policy.decide(principal, { capability: "production.view", resource: { organizationId } }).allowed,
                productionWork: policy.decide(principal, { capability: "production.work", resource: { organizationId } }).allowed,
                productionComplete: policy.decide(principal, { capability: "production.complete", resource: { organizationId } }).allowed,
                fulfillmentView: policy.decide(principal, { capability: "fulfillment.view", resource: { organizationId } }).allowed,
                fulfillmentPickup: policy.decide(principal, { capability: "fulfillment.pickup", resource: { organizationId } }).allowed,
                fulfillmentShip: policy.decide(principal, { capability: "fulfillment.ship", resource: { organizationId } }).allowed,
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
  if (order)
    app.use(
      "/v2/organizations/:organizationId/orders",
      order.trustedHostMiddleware,
      (request, response, next) => {
        try {
          response.setHeader("x-v2-session-scope", issueV2SessionScope(request));
        } catch {
          // The principal provider remains responsible for opaque auth denial.
        }
        next();
      },
      requireV2CsrfToken,
      createOrderRouter(order.dependencies),
    );
  if (billing)
    app.use(
      "/v2/organizations/:organizationId/invoices",
      billing.trustedHostMiddleware,
      (request, response, next) => { try { response.setHeader("x-v2-session-scope", issueV2SessionScope(request)); } catch {} next(); },
      requireV2CsrfToken,
      createInvoiceRouter(billing.dependencies),
    );
  if (billing)
    app.use(
      "/v2/organizations/:organizationId/finance",
      billing.trustedHostMiddleware,
      (request, response, next) => { try { response.setHeader("x-v2-session-scope", issueV2SessionScope(request)); } catch {} next(); },
      requireV2CsrfToken,
      createFinanceRouter(billing.dependencies),
    );
  if (artwork)
    app.use(
      "/v2/organizations/:organizationId/artwork",
      artwork.trustedHostMiddleware,
      (request, response, next) => { try { response.setHeader("x-v2-session-scope", issueV2SessionScope(request)); } catch {} next(); },
      requireV2CsrfToken,
      createArtworkRouter(artwork.dependencies),
    );
  if (proofing)
    app.use(
      "/v2/organizations/:organizationId/proofing",
      proofing.trustedHostMiddleware,
      (request, response, next) => { try { response.setHeader("x-v2-session-scope", issueV2SessionScope(request)); } catch {} next(); },
      requireV2CsrfToken,
      createProofingRouter(proofing.dependencies),
    );
  if (prepress)
    app.use(
      "/v2/organizations/:organizationId/prepress",
      prepress.trustedHostMiddleware,
      (request, response, next) => { try { response.setHeader("x-v2-session-scope", issueV2SessionScope(request)); } catch {} next(); },
      requireV2CsrfToken,
      createPrepressRouter(prepress.dependencies),
    );
  if (production)
    app.use("/v2/organizations/:organizationId/production",production.trustedHostMiddleware,(request,response,next)=>{try{response.setHeader("x-v2-session-scope",issueV2SessionScope(request));}catch{}next();},requireV2CsrfToken,createProductionRouter(production.dependencies));
  if (fulfillment)
    app.use("/v2/organizations/:organizationId/fulfillment",fulfillment.trustedHostMiddleware,(request,response,next)=>{try{response.setHeader("x-v2-session-scope",issueV2SessionScope(request));}catch{}next();},requireV2CsrfToken,createFulfillmentRouter(fulfillment.dependencies));

  app.use((_request, response) =>
    response.status(404).json({ code: "NOT_FOUND" }),
  );
  return app;
};
