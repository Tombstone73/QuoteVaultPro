import type { Express, Request, Response } from "express";
import { Readable } from "node:stream";

import {
  approvePortalQuote,
  confirmPortalStripePayment,
  createPortalStripePaymentIntent,
  declinePortalQuote,
  getPortalInvoiceFileDownload,
  getPortalInvoicePdf,
  getPortalInvoice,
  getPortalOrder,
  getPortalOrderFileDownload,
  getPortalQuote,
  getPortalQuoteFileDownload,
  getPortalSession,
  listPortalInvoicePayments,
  listPortalInvoiceFiles,
  listPortalInvoices,
  listPortalOrderFiles,
  listPortalOrders,
  listPortalQuoteFiles,
  listPortalQuotes,
  type PortalFileDownloadResult,
  requestPortalQuoteRevision,
  toPortalErrorResponse,
} from "../services/portal.service";
import { isSupabaseConfigured, SupabaseStorageService } from "../supabaseStorage";

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

function portalPostById<T>(
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

function portalInvoicePdf() {
  return async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || "").trim();
      if (!id) {
        return res.status(404).json({ success: false, message: "Not found" });
      }

      const result = await getPortalInvoicePdf(req, id);
      if (!result) {
        return res.status(404).json({ success: false, message: "Not found" });
      }

      const wantsDownload = String(req.query.download || "") === "1";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", `${wantsDownload ? "attachment" : "inline"}; filename="${result.filename}"`);
      return res.status(200).send(result.bytes);
    } catch (error) {
      console.error("[Portal] PDF request failed", {
        path: req.path,
        method: req.method,
        message: error instanceof Error ? error.message : String(error),
      });
      return sendPortalError(res, error);
    }
  };
}

function contentDispositionFilename(filename: string) {
  return filename.replace(/[\r\n\t\0]/g, " ").replace(/"/g, "'").slice(0, 240) || "download";
}

async function sendPortalFile(res: Response, result: PortalFileDownloadResult) {
  const filename = contentDispositionFilename(result.filename);
  res.setHeader("Content-Type", result.mimeType || "application/octet-stream");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  if (result.bytes) {
    return res.status(200).send(result.bytes);
  }

  if (!result.objectPath) {
    return res.status(404).json({ success: false, message: "Not found" });
  }

  if (!isSupabaseConfigured()) {
    return res.status(503).json({ success: false, message: "File serving is not available" });
  }

  const storage = new SupabaseStorageService();
  const signedUrl = await storage.getSignedDownloadUrl(result.objectPath, 600);
  const upstream = await fetch(signedUrl);
  if (!upstream.ok) {
    return res.status(404).json({ success: false, message: "Not found" });
  }

  const upstreamType = upstream.headers.get("content-type");
  if (upstreamType) res.setHeader("Content-Type", upstreamType);

  const body: any = (upstream as any).body;
  if (body && typeof Readable.fromWeb === "function") {
    const nodeStream = Readable.fromWeb(body);
    nodeStream.on("error", (error) => {
      console.error("[Portal] file stream failed", { message: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) res.status(500).end();
    });
    return nodeStream.pipe(res);
  }

  return res.status(200).send(Buffer.from(await upstream.arrayBuffer()));
}

function portalFileDownload(
  handler: (req: Request, entityId: string, fileId: string) => Promise<PortalFileDownloadResult | null>,
) {
  return async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || "").trim();
      const fileId = String(req.params.fileId || "").trim();
      if (!id || !fileId) {
        return res.status(404).json({ success: false, message: "Not found" });
      }

      const result = await handler(req, id, fileId);
      if (!result) {
        return res.status(404).json({ success: false, message: "Not found" });
      }

      return sendPortalFile(res, result);
    } catch (error) {
      console.error("[Portal] file request failed", {
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
  app.get("/api/portal/invoices/:id/pdf", ...portalMiddlewares, portalInvoicePdf());
  app.get("/api/portal/invoices/:id/files", ...portalMiddlewares, portalGetById("id", listPortalInvoiceFiles));
  app.get("/api/portal/invoices/:id/files/:fileId", ...portalMiddlewares, portalFileDownload(getPortalInvoiceFileDownload));
  app.get("/api/portal/invoices/:id/payments", ...portalMiddlewares, portalGetById("id", listPortalInvoicePayments));
  app.post("/api/portal/invoices/:id/payments/stripe/create-intent", ...portalMiddlewares, portalPostById("id", createPortalStripePaymentIntent));
  app.post("/api/portal/invoices/:id/payments/stripe/confirm", ...portalMiddlewares, portalPostById("id", confirmPortalStripePayment));
  app.get("/api/portal/invoices/:id", ...portalMiddlewares, portalGetById("id", getPortalInvoice));

  app.get("/api/portal/orders", ...portalMiddlewares, portalGet(listPortalOrders));
  app.get("/api/portal/orders/:id/files", ...portalMiddlewares, portalGetById("id", listPortalOrderFiles));
  app.get("/api/portal/orders/:id/files/:fileId", ...portalMiddlewares, portalFileDownload(getPortalOrderFileDownload));
  app.get("/api/portal/orders/:id", ...portalMiddlewares, portalGetById("id", getPortalOrder));

  app.get("/api/portal/quotes", ...portalMiddlewares, portalGet(listPortalQuotes));
  app.post("/api/portal/quotes/:id/approve", ...portalMiddlewares, portalPostById("id", approvePortalQuote));
  app.post("/api/portal/quotes/:id/decline", ...portalMiddlewares, portalPostById("id", declinePortalQuote));
  app.post("/api/portal/quotes/:id/request-revision", ...portalMiddlewares, portalPostById("id", requestPortalQuoteRevision));
  app.get("/api/portal/quotes/:id/files", ...portalMiddlewares, portalGetById("id", listPortalQuoteFiles));
  app.get("/api/portal/quotes/:id/files/:fileId", ...portalMiddlewares, portalFileDownload(getPortalQuoteFileDownload));
  app.get("/api/portal/quotes/:id", ...portalMiddlewares, portalGetById("id", getPortalQuote));

  // Compatibility aliases for older draft frontend calls; still served by safe DTO mappers.
  app.get("/api/portal/my-orders", ...portalMiddlewares, portalGet(listPortalOrders));
  app.get("/api/portal/my-quotes", ...portalMiddlewares, portalGet(listPortalQuotes));

  // Phase 0 is read-only: block legacy state-transition/storefront surfaces registered later.
  app.all("/api/portal/convert-quote/:id", ...portalMiddlewares, denyOutOfPhasePortalSurface);
  app.all("/api/portal/products", ...portalMiddlewares, denyOutOfPhasePortalSurface);
}
