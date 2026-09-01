import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { customerContacts, customers } from "../../shared/schema";
import {
  assertStage18PDevFixtureAccess,
  isStage18PDevFixtureCustomer,
} from "../lib/stage18pDevFixtureAccess";
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
import { sanitizePortalReturnTarget } from "../../shared/portalReturnTarget";
import {
  listPortalOnboardingBatches,
  listPortalOnboardingCompanies,
  portalOnboardingRowsToCsv,
  runPortalOnboardingAction,
} from "../services/customerPortalOnboardingService";

type AdminRouteDeps = {
  isAuthenticated: RequestHandler;
  tenantContext: RequestHandler;
  requireOrgOwnerAdmin: RequestHandler;
};

const portalOnboardingActionSchema = z.object({
  action: z.enum([
    "enable_companies",
    "invite_selected_contacts",
    "invite_all_eligible_contacts",
    "resend_expired_invitations",
    "suspend_portal_users",
  ]),
  customerIds: z.array(z.string()).optional(),
  contactIds: z.array(z.string()).optional(),
  accessIds: z.array(z.string()).optional(),
  accessRoles: z.record(z.enum(["COMPANY_ADMIN", "BUYER", "BILLING", "VIEWER"])).optional(),
});

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
        returnTo: z.string().optional(),
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
        redirectTo: sanitizePortalReturnTarget(parse.data.returnTo),
        user: result.user,
      });
    } catch (err) {
      return sendRouteError(res, err);
    }
  });
}

export function registerCustomerPortalAccessAdminRoutes(app: Express, deps: AdminRouteDeps): void {
  const adminGuards = [deps.isAuthenticated, deps.tenantContext, deps.requireOrgOwnerAdmin];

  app.get("/api/customer-portal-onboarding/companies", ...adminGuards, async (req, res) => {
    try {
      const result = await listPortalOnboardingCompanies(req.organizationId!, {
        filter: String(req.query.filter ?? "all"),
        search: String(req.query.search ?? ""),
      });
      return res.json({ success: true, data: result });
    } catch (err) {
      return sendRouteError(res, err);
    }
  });

  app.get("/api/customer-portal-onboarding/export.csv", ...adminGuards, async (req, res) => {
    try {
      const result = await listPortalOnboardingCompanies(req.organizationId!, {
        filter: String(req.query.filter ?? "all"),
        search: String(req.query.search ?? ""),
      });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=\"customer-portal-onboarding-review.csv\"");
      return res.send(portalOnboardingRowsToCsv(result.rows));
    } catch (err) {
      return sendRouteError(res, err);
    }
  });

  app.get("/api/customer-portal-onboarding/batches", ...adminGuards, async (req, res) => {
    try {
      const rows = await listPortalOnboardingBatches(req.organizationId!, Number(req.query.limit ?? 10));
      return res.json({ success: true, data: rows });
    } catch (err) {
      return sendRouteError(res, err);
    }
  });

  app.post("/api/customer-portal-onboarding/actions", ...adminGuards, async (req, res) => {
    const parsed = portalOnboardingActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        code: "INVALID_PORTAL_ONBOARDING_ACTION",
        message: parsed.error.issues[0]?.message ?? "Invalid portal onboarding action.",
      });
    }
    try {
      const result = await runPortalOnboardingAction({
        organizationId: req.organizationId!,
        actorUserId: getActorUserId(req),
        actionInput: parsed.data,
        req,
      });
      return res.json({ success: true, data: result });
    } catch (err) {
      return sendRouteError(res, err);
    }
  });

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

  app.post("/api/customers/:customerId/contacts/:contactId/dev-stage18p-portal-setup", ...adminGuards, async (req, res) => {
    const parsed = z.object({ confirmDevFixtureSetup: z.literal(true) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        code: "DEV_STAGE_18P_FIXTURE_CONFIRMATION_REQUIRED",
        message: "confirmDevFixtureSetup: true is required.",
      });
    }

    try {
      assertStage18PDevFixtureAccess({
        requestHost: req.get("host"),
        requestOrigin: req.get("origin"),
      });

      const [fixtureContact] = await db
        .select({
          customerId: customers.id,
          companyName: customers.companyName,
          contactId: customerContacts.id,
          email: customerContacts.email,
        })
        .from(customers)
        .innerJoin(customerContacts, eq(customerContacts.customerId, customers.id))
        .where(and(
          eq(customers.id, req.params.customerId),
          eq(customers.organizationId, req.organizationId!),
          eq(customerContacts.id, req.params.contactId),
        ))
        .limit(1);

      if (!fixtureContact || !fixtureContact.email || !isStage18PDevFixtureCustomer(fixtureContact.companyName)) {
        return res.status(404).json({
          success: false,
          code: "DEV_STAGE_18P_FIXTURE_NOT_FOUND",
          message: "A labelled DEV Stage 18P fixture customer contact is required.",
        });
      }

      const access = await createCustomerPortalAccess({
        organizationId: req.organizationId!,
        customerId: fixtureContact.customerId,
        contactId: fixtureContact.contactId,
        actorUserId: getActorUserId(req),
        accessRole: "VIEWER",
        sendEmail: false,
        req,
      });

      const portalSetupUrl = (access as { portalSetupUrl?: string }).portalSetupUrl;
      if (!portalSetupUrl) {
        throw Object.assign(new Error("DEV fixture portal setup link was not created."), {
          status: 500,
          code: "DEV_STAGE_18P_FIXTURE_SETUP_FAILED",
        });
      }

      return res.status(201).json({
        success: true,
        data: {
          customerId: fixtureContact.customerId,
          contactId: fixtureContact.contactId,
          accessId: access.id,
          email: fixtureContact.email,
          portalSetupUrl,
        },
      });
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
