import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { requireDeveloperAccess } from "../middleware/requireDeveloperAccess";
import { listCustomerPortalAccess } from "../services/customerPortalAccessService";
import {
  auditDeveloperPortalImpersonation,
  auditDeniedDeveloperPortalImpersonation,
  activeDeveloperMembership,
  DeveloperPortalImpersonationError,
  endDeveloperPortalImpersonation,
  resolveDeveloperPortalImpersonation,
  startDeveloperPortalImpersonation,
} from "../services/developerPortalImpersonationService";

const startSchema = z.object({ customerId: z.string().min(1), accessId: z.string().min(1), returnTo: z.string().optional().nullable() }).strict();

const requireImpersonationDeveloper: RequestHandler = async (req, res, next) => {
  try {
    const actorUserId = (req.user as { id?: string } | undefined)?.id;
    if (actorUserId && req.organizationId && await activeDeveloperMembership(actorUserId, req.organizationId)) return next();
    await auditDeniedDeveloperPortalImpersonation(req, "DEVELOPER_ACCESS_REQUIRED");
    return res.status(403).json({ success: false, code: "IMPERSONATION_ACTOR_DENIED", message: "Developer access is required." });
  } catch (error) { return sendError(res, error); }
};

function sendError(res: Response, error: unknown) {
  if (error instanceof DeveloperPortalImpersonationError) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
  console.error("[DeveloperPortalImpersonation] request failed", error);
  return res.status(503).json({ success: false, code: "IMPERSONATION_UNAVAILABLE", message: "Customer diagnostic session is unavailable." });
}

/** Installed before all portal routes, including public proof-token routes. */
export function registerDeveloperPortalImpersonationRoutes(app: Express, middleware: { isAuthenticated: RequestHandler; tenantContext: RequestHandler }): void {
  app.use("/api", async (req: Request, res: Response, next) => {
    const marker = req.session?.developerPortalImpersonation;
    if (!marker || req.method === "GET" || req.method === "HEAD") return next();
    if (req.path === "/portal/impersonation/end") return next();
    const surface = req.path.startsWith("/portal/") ? "portal"
      : req.path.startsWith("/guest/") ? "guest_payment"
      : req.path.startsWith("/customer-portal-access/") || req.path.startsWith("/customer-portal-onboarding/") || req.path.includes("/portal-access") ? "portal_access"
      : null;
    if (!surface) return next();
    try {
      await auditDeveloperPortalImpersonation(req, marker, "DEVELOPER_PORTAL_IMPERSONATION_MUTATION_BLOCKED", { method: req.method, surface });
    } catch (error) {
      console.error("[DeveloperPortalImpersonation] blocked-mutation audit failed", error);
    }
    return res.status(403).json({ success: false, code: "IMPERSONATION_READ_ONLY", message: "Customer diagnostic view is read-only. Exit impersonation to make changes." });
  });

  app.get("/api/customers/:customerId/portal-impersonation/access", middleware.isAuthenticated, middleware.tenantContext, requireImpersonationDeveloper, requireDeveloperAccess, async (req: Request, res: Response) => {
    try {
      const data = await listCustomerPortalAccess(req.organizationId!, req.params.customerId);
      return res.json({ success: true, data });
    } catch (error) { return sendError(res, error); }
  });

  app.post("/api/portal/impersonation/start", middleware.isAuthenticated, middleware.tenantContext, requireImpersonationDeveloper, requireDeveloperAccess, async (req: Request, res: Response) => {
    const parsed = startSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, message: "Select a customer portal login." });
    try {
      const { marker } = await startDeveloperPortalImpersonation(req, parsed.data.customerId, parsed.data.accessId, parsed.data.returnTo);
      return res.json({ success: true, data: { redirectTo: "/portal?impersonation=1", expiresAt: marker.expiresAt } });
    } catch (error) {
      if (error instanceof DeveloperPortalImpersonationError) {
        try { await auditDeniedDeveloperPortalImpersonation(req, error.code); }
        catch (auditError) { console.error("[DeveloperPortalImpersonation] denied-attempt audit failed", auditError); }
      }
      return sendError(res, error);
    }
  });

  app.get("/api/portal/impersonation/session", middleware.isAuthenticated, async (req: Request, res: Response) => {
    const marker = req.session.developerPortalImpersonation;
    if (!marker) return res.status(403).json({ success: false, code: "IMPERSONATION_REQUIRED", message: "Customer diagnostic session is unavailable." });
    try {
      const target = await resolveDeveloperPortalImpersonation(req, marker);
      return res.json({ success: true, data: { customerId: marker.customerId, customerName: target.customer.companyName, accessId: marker.accessId, contactName: target.contactName, email: target.access.email, role: target.access.accessRole, startedAt: marker.startedAt, expiresAt: marker.expiresAt, returnTo: marker.returnTo, readOnly: true } });
    } catch (error) {
      if (error instanceof DeveloperPortalImpersonationError) {
        try { await endDeveloperPortalImpersonation(req, error.code === "IMPERSONATION_EXPIRED" ? "EXPIRED" : "REVOKED"); }
        catch (auditError) { console.error("[DeveloperPortalImpersonation] Could not close invalid session", auditError); }
      }
      return sendError(res, error);
    }
  });

  app.post("/api/portal/impersonation/end", middleware.isAuthenticated, async (req: Request, res: Response) => {
    const marker = req.session.developerPortalImpersonation;
    if (!marker || (req.user as { id?: string } | undefined)?.id !== marker.actorUserId) return res.status(403).json({ success: false, code: "IMPERSONATION_REQUIRED", message: "Customer diagnostic session is unavailable." });
    try {
      const ended = await endDeveloperPortalImpersonation(req);
      return res.json({ success: true, data: { returnTo: ended?.returnTo ?? "/customers" } });
    } catch (error) { return sendError(res, error); }
  });
}
