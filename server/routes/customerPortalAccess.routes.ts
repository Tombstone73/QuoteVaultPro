import type { Express, RequestHandler } from "express";
import { z } from "zod";
import {
  acceptCustomerPortalInvite,
  activateCustomerPortalAccess,
  cancelCustomerPortalInvite,
  createCustomerPortalAccess,
  disableCustomerPortalAccess,
  listCustomerPortalAccess,
  previewCustomerPortalInvite,
  resendCustomerPortalInvite,
  resetCustomerPortalPassword,
  suspendCustomerPortalAccess,
} from "../services/customerPortalAccessService";

type AdminRouteDeps = {
  isAuthenticated: RequestHandler;
  tenantContext: RequestHandler;
  requireOrgOwnerAdmin: RequestHandler;
};

function getActorUserId(req: any): string {
  const userId = req.user?.claims?.sub || req.user?.id;
  if (!userId) {
    throw Object.assign(new Error("Authenticated user id is required."), { status: 401 });
  }
  return userId;
}

function sendRouteError(res: any, err: unknown) {
  const status = (err as any)?.status || 500;
  const code = (err as any)?.code;
  const message = (err as any)?.message || "Request failed.";
  if (status >= 500) {
    console.error("[CustomerPortalAccessRoutes]", err);
  }
  return res.status(status).json({ success: false, code, message });
}

export function registerCustomerPortalInvitePublicRoutes(app: Express): void {
  app.get("/api/customer-portal/invites/preview", async (req, res) => {
    const parse = z.object({ token: z.string().min(1) }).safeParse(req.query);
    if (!parse.success) {
      return res.status(400).json({ success: false, status: "invalid", message: "Token is required." });
    }

    try {
      const invite = await previewCustomerPortalInvite(parse.data.token);
      return res.json({ success: true, kind: "portal", ...invite });
    } catch (err) {
      return sendRouteError(res, err);
    }
  });

  app.post("/api/customer-portal/invites/accept", async (req, res) => {
    const parse = z
      .object({
        token: z.string().min(1, "Token is required."),
        password: z.string().min(8, "Password must be at least 8 characters."),
      })
      .safeParse(req.body);

    if (!parse.success) {
      return res.status(400).json({ success: false, message: parse.error.issues[0]?.message || "Invalid request." });
    }

    try {
      const result = await acceptCustomerPortalInvite({
        rawToken: parse.data.token,
        password: parse.data.password,
        req,
      });

      if (result.user) {
        await new Promise<void>((resolve, reject) => {
          req.login(result.user!, (err) => (err ? reject(err) : resolve()));
        });
      }

      return res.json({
        success: true,
        kind: "portal",
        redirectTo: "/portal",
        user: result.user,
      });
    } catch (err) {
      return sendRouteError(res, err);
    }
  });
}

export function registerCustomerPortalAccessAdminRoutes(app: Express, deps: AdminRouteDeps): void {
  const adminGuards = [deps.isAuthenticated, deps.tenantContext, deps.requireOrgOwnerAdmin];

  app.get("/api/customers/:customerId/portal-access", ...adminGuards, async (req, res) => {
    try {
      const rows = await listCustomerPortalAccess(req.organizationId!, req.params.customerId);
      return res.json({ success: true, data: rows });
    } catch (err) {
      return sendRouteError(res, err);
    }
  });

  app.post("/api/customers/:customerId/contacts/:contactId/portal-access", ...adminGuards, async (req, res) => {
    try {
      const access = await createCustomerPortalAccess({
        organizationId: req.organizationId!,
        customerId: req.params.customerId,
        contactId: req.params.contactId,
        actorUserId: getActorUserId(req),
        req,
      });
      return res.status(201).json({ success: true, data: access });
    } catch (err) {
      return sendRouteError(res, err);
    }
  });

  app.post("/api/customer-portal-access/:accessId/resend-invite", ...adminGuards, async (req, res) => {
    try {
      const access = await resendCustomerPortalInvite({
        organizationId: req.organizationId!,
        accessId: req.params.accessId,
        actorUserId: getActorUserId(req),
        req,
      });
      return res.json({ success: true, data: access });
    } catch (err) {
      return sendRouteError(res, err);
    }
  });

  app.post("/api/customer-portal-access/:accessId/cancel-invite", ...adminGuards, async (req, res) => {
    try {
      const access = await cancelCustomerPortalInvite({
        organizationId: req.organizationId!,
        accessId: req.params.accessId,
        actorUserId: getActorUserId(req),
        req,
      });
      return res.json({ success: true, data: access });
    } catch (err) {
      return sendRouteError(res, err);
    }
  });

  app.post("/api/customer-portal-access/:accessId/suspend", ...adminGuards, async (req, res) => {
    try {
      const access = await suspendCustomerPortalAccess({
        organizationId: req.organizationId!,
        accessId: req.params.accessId,
        actorUserId: getActorUserId(req),
        req,
      });
      return res.json({ success: true, data: access });
    } catch (err) {
      return sendRouteError(res, err);
    }
  });

  app.post("/api/customer-portal-access/:accessId/disable", ...adminGuards, async (req, res) => {
    try {
      const access = await disableCustomerPortalAccess({
        organizationId: req.organizationId!,
        accessId: req.params.accessId,
        actorUserId: getActorUserId(req),
        req,
      });
      return res.json({ success: true, data: access });
    } catch (err) {
      return sendRouteError(res, err);
    }
  });

  app.post("/api/customer-portal-access/:accessId/activate", ...adminGuards, async (req, res) => {
    try {
      const access = await activateCustomerPortalAccess({
        organizationId: req.organizationId!,
        accessId: req.params.accessId,
        actorUserId: getActorUserId(req),
        req,
      });
      return res.json({ success: true, data: access });
    } catch (err) {
      return sendRouteError(res, err);
    }
  });

  app.post("/api/customer-portal-access/:accessId/reset-password", ...adminGuards, async (req, res) => {
    try {
      const result = await resetCustomerPortalPassword({
        organizationId: req.organizationId!,
        accessId: req.params.accessId,
        actorUserId: getActorUserId(req),
        req,
      });
      return res.json(result);
    } catch (err) {
      return sendRouteError(res, err);
    }
  });
}
