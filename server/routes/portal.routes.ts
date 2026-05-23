import type { Express, Request, Response } from "express";

import {
  getPortalInvoice,
  getPortalOrder,
  getPortalQuote,
  getPortalSession,
  listPortalInvoices,
  listPortalOrders,
  listPortalQuotes,
  toPortalErrorResponse,
} from "../services/portal.service";

type PortalHandler<T> = (req: Request) => Promise<T>;

function sendPortalError(res: Response, error: unknown) {
  const { statusCode, message } = toPortalErrorResponse(error);
  const safeMessage = statusCode >= 500 ? "Portal request failed" : message;
  return res.status(statusCode).json({ success: false, message: safeMessage });
}

function portalGet<T>(handler: PortalHandler<T>) {
  return async (req: Request, res: Response) => {
    try {
      const data = await handler(req);
      return res.json({ success: true, data });
    } catch (error) {
      console.error("[Portal] request failed", {
        path: req.path,
        method: req.method,
        message: error instanceof Error ? error.message : String(error),
      });
      return sendPortalError(res, error);
    }
  };
}

function portalGetById<T>(
  paramName: string,
  handler: (req: Request, id: string) => Promise<T | null>,
) {
  return async (req: Request, res: Response) => {
    try {
      const id = String(req.params[paramName] || "").trim();
      if (!id) {
        return res.status(404).json({ success: false, message: "Not found" });
      }

      const data = await handler(req, id);
      if (!data) {
        return res.status(404).json({ success: false, message: "Not found" });
      }

      return res.json({ success: true, data });
    } catch (error) {
      console.error("[Portal] request failed", {
        path: req.path,
        method: req.method,
        message: error instanceof Error ? error.message : String(error),
      });
      return sendPortalError(res, error);
    }
  };
}

function denyOutOfPhasePortalSurface(_req: Request, res: Response) {
  return res.status(404).json({ success: false, message: "Not found" });
}

export function registerPortalRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    portalContext: any;
  },
): void {
  const { isAuthenticated, portalContext } = middleware;
  const portalMiddlewares = [isAuthenticated, portalContext];

  app.get("/api/portal/me", ...portalMiddlewares, portalGet(getPortalSession));

  app.get("/api/portal/invoices", ...portalMiddlewares, portalGet(listPortalInvoices));
  app.get("/api/portal/invoices/:id", ...portalMiddlewares, portalGetById("id", getPortalInvoice));

  app.get("/api/portal/orders", ...portalMiddlewares, portalGet(listPortalOrders));
  app.get("/api/portal/orders/:id", ...portalMiddlewares, portalGetById("id", getPortalOrder));

  app.get("/api/portal/quotes", ...portalMiddlewares, portalGet(listPortalQuotes));
  app.get("/api/portal/quotes/:id", ...portalMiddlewares, portalGetById("id", getPortalQuote));

  // Compatibility aliases for older draft frontend calls; still served by safe DTO mappers.
  app.get("/api/portal/my-orders", ...portalMiddlewares, portalGet(listPortalOrders));
  app.get("/api/portal/my-quotes", ...portalMiddlewares, portalGet(listPortalQuotes));

  // Phase 0 is read-only: block legacy state-transition/storefront surfaces registered later.
  app.all("/api/portal/convert-quote/:id", ...portalMiddlewares, denyOutOfPhasePortalSurface);
  app.all("/api/portal/products", ...portalMiddlewares, denyOutOfPhasePortalSurface);
}
