import type { Express, Request, Response } from "express";
import { Readable } from "node:stream";
import { promises as fsPromises } from "node:fs";

import {
  approvePortalQuote,
  approvePortalProof,
  confirmPortalStripePayment,
  createPortalStripePaymentIntent,
  declinePortalQuote,
  getPortalDashboard,
  getPortalCustomerQuoteDebug,
  getPortalInvoiceFileDownload,
  getPortalInvoicePdf,
  getPortalInvoice,
  getPortalStripeRuntimeConfig,
  getPortalOrder,
  getPortalOrderFileDownload,
  getPortalProof,
  getPortalProofFileDownload,
  getPortalProfile,
  getPortalQuote,
  getPortalQuoteFileDownload,
  getPortalSession,
  listPortalInvoicePayments,
  listPortalInvoiceFiles,
  listPortalInvoices,
  listPortalOrderFiles,
  listPortalOrders,
  listPortalProofs,
  listPortalQuoteFiles,
  listPortalQuotes,
  type PortalFileDownloadResult,
  rejectPortalProof,
  requestPortalProofRevision,
  requestPortalQuoteRevision,
  submitPortalOrderFile,
  submitPortalQuoteFile,
  toPortalErrorResponse,
  updatePortalProfile,
} from "../services/portal.service";
import { isSupabaseConfigured, SupabaseStorageService } from "../supabaseStorage";
import { resolveLocalStoragePath } from "../services/localStoragePath";
import { isStaffPortalPreviewReadMethod } from "../services/staffPortalPreviewService";

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

function portalPatch<T>(handler: PortalHandler<T>) {
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

  if (isSupabaseConfigured()) {
    try {
      const storage = new SupabaseStorageService();
      const signedUrl = await storage.getSignedDownloadUrl(result.objectPath, 600);
      const upstream = await fetch(signedUrl);
      if (upstream.ok) {
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
    } catch (error) {
      console.warn("[Portal] Supabase file read failed; trying local storage fallback", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    const localPath = resolveLocalStoragePath(result.objectPath);
    const bytes = await fsPromises.readFile(localPath);
    return res.status(200).send(bytes);
  } catch {
    return res.status(404).json({ success: false, message: "Not found" });
  }
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

function portalProofFileDownload(
  handler: (req: Request, proofId: string) => Promise<PortalFileDownloadResult | null>,
) {
  return async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || "").trim();
      if (!id) {
        return res.status(404).json({ success: false, message: "Not found" });
      }

      const result = await handler(req, id);
      if (!result) {
        return res.status(404).json({ success: false, message: "Not found" });
      }

      return sendPortalFile(res, result);
    } catch (error) {
      console.error("[Portal] proof file request failed", {
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

function denyStaffPreviewMutations(req: Request, res: Response, next: () => void) {
  if ((req as any).staffPortalPreview && !isStaffPortalPreviewReadMethod(req.method)) {
    return res.status(403).json({
      success: false,
      code: "STAFF_PORTAL_PREVIEW_READ_ONLY",
      message: "Staff portal preview is read-only.",
    });
  }

  return next();
}

export function registerPortalRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    portalContext: any;
    tenantContext: any;
  },
): void {
  const { isAuthenticated, portalContext, tenantContext } = middleware;
  const portalMiddlewares = [isAuthenticated, portalContext, denyStaffPreviewMutations];

  function requireNonProductionStaff(req: Request, res: Response, next: () => void) {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const user = (req as any).user;
    const role = String(user?.role || "").toLowerCase();
    if (user?.accountType === "PORTAL_CUSTOMER" || role === "customer") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    if (!["owner", "admin", "manager", "employee"].includes(role)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    return next();
  }

  app.get("/api/portal/me", ...portalMiddlewares, portalGet(getPortalSession));
  app.get("/api/portal/dashboard", ...portalMiddlewares, portalGet(getPortalDashboard));
  app.get("/api/portal/profile", ...portalMiddlewares, portalGet(getPortalProfile));
  app.patch("/api/portal/profile", ...portalMiddlewares, portalPatch(updatePortalProfile));
  app.get("/api/portal/debug/customer-quotes", isAuthenticated, tenantContext, requireNonProductionStaff, async (req: Request, res: Response) => {
    try {
      const customerId = String(req.query.customerId || "").trim();
      if (!customerId) {
        return res.status(400).json({ success: false, message: "customerId is required" });
      }
      const data = await getPortalCustomerQuoteDebug(req.organizationId!, customerId);
      return res.json({ success: true, data });
    } catch (error) {
      console.error("[Portal Debug] customer quote diagnostic failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return sendPortalError(res, error);
    }
  });

  app.get("/api/portal/invoices", ...portalMiddlewares, portalGet(listPortalInvoices));
  app.get("/api/portal/invoices/:id/pdf", ...portalMiddlewares, portalInvoicePdf());
  app.get("/api/portal/invoices/:id/files", ...portalMiddlewares, portalGetById("id", listPortalInvoiceFiles));
  app.get("/api/portal/invoices/:id/files/:fileId", ...portalMiddlewares, portalFileDownload(getPortalInvoiceFileDownload));
  app.get("/api/portal/invoices/:id/payments", ...portalMiddlewares, portalGetById("id", listPortalInvoicePayments));
  app.get("/api/portal/invoices/:id/payments/stripe/runtime-config", ...portalMiddlewares, portalGetById("id", getPortalStripeRuntimeConfig));
  app.post("/api/portal/invoices/:id/payments/stripe/create-intent", ...portalMiddlewares, portalPostById("id", createPortalStripePaymentIntent));
  app.post("/api/portal/invoices/:id/payments/stripe/confirm", ...portalMiddlewares, portalPostById("id", confirmPortalStripePayment));
  app.get("/api/portal/invoices/:id", ...portalMiddlewares, portalGetById("id", getPortalInvoice));

  app.get("/api/portal/orders", ...portalMiddlewares, portalGet(listPortalOrders));
  app.post("/api/portal/orders/:id/files", ...portalMiddlewares, portalPostById("id", submitPortalOrderFile));
  app.get("/api/portal/orders/:id/files", ...portalMiddlewares, portalGetById("id", listPortalOrderFiles));
  app.get("/api/portal/orders/:id/files/:fileId", ...portalMiddlewares, portalFileDownload(getPortalOrderFileDownload));
  app.get("/api/portal/orders/:id", ...portalMiddlewares, portalGetById("id", getPortalOrder));

  app.get("/api/portal/proofs", ...portalMiddlewares, portalGet(listPortalProofs));
  app.get("/api/portal/proofs/:id/file", ...portalMiddlewares, portalProofFileDownload(getPortalProofFileDownload));
  app.post("/api/portal/proofs/:id/approve", ...portalMiddlewares, portalPostById("id", approvePortalProof));
  app.post("/api/portal/proofs/:id/reject", ...portalMiddlewares, portalPostById("id", rejectPortalProof));
  app.post("/api/portal/proofs/:id/request-revision", ...portalMiddlewares, portalPostById("id", requestPortalProofRevision));
  app.get("/api/portal/proofs/:id", ...portalMiddlewares, portalGetById("id", getPortalProof));

  app.get("/api/portal/quotes", ...portalMiddlewares, portalGet(listPortalQuotes));
  app.post("/api/portal/quotes/:id/approve", ...portalMiddlewares, portalPostById("id", approvePortalQuote));
  app.post("/api/portal/quotes/:id/decline", ...portalMiddlewares, portalPostById("id", declinePortalQuote));
  app.post("/api/portal/quotes/:id/request-revision", ...portalMiddlewares, portalPostById("id", requestPortalQuoteRevision));
  app.post("/api/portal/quotes/:id/files", ...portalMiddlewares, portalPostById("id", submitPortalQuoteFile));
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
