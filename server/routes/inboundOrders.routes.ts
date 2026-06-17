/**
 * inboundOrders.routes.ts
 *
 * Internal TitanOS Inbound Orders Review Queue routes.
 * These endpoints manage intake/review artifacts, matching, immutable snapshots,
 * and quote draft conversion. Order conversion, production, and automation stay out of scope here.
 */

import crypto from "crypto";
import type { Express } from "express";
import { google } from "googleapis";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

import {
  inboundOrderListQuerySchema,
  inboundOrderReviewDraftSaveSchema,
  inboundOrderStatusUpdateSchema,
  manualInboundOrderCreateSchema,
  normalizeInboundOrderStatusForStorage,
} from "@shared/inboundOrdersApi";
import { inboundEmailMailboxViewSchema } from "@shared/inboundEmailMailboxes";
import {
  InboundOrderConversionValidationError,
  InboundOrderReviewDraftValidationError,
  InboundOrderTransitionError,
  inboundOrderService,
} from "../services/inboundOrders/InboundOrderService";
import { inboundOrderParsingService } from "../services/inboundOrders/InboundOrderParsingService";
import { inboundEmailIntakeSettingsService } from "../services/inboundEmailIntakeSettingsService";
import {
  InboundEmailIngestionError,
  inboundEmailIngestionService,
} from "../services/inboundEmailIngestionService";
import { inboundEmailMailboxSettingsService } from "../services/inboundEmailMailboxSettingsService";
import { getRequestOrganizationId } from "../tenantContext";

function getUserId(user: any): string | undefined {
  return user?.claims?.sub ?? user?.id;
}

const jsonObjectSchema = z.record(z.unknown());

const legacyManualInboundOrderCreateSchema = z.object({
  sourceId: z.string().trim().min(1).optional().nullable(),
  sourceLabel: z.string().trim().min(1).max(255).optional().nullable(),
  sourceRecordId: z.string().trim().min(1).max(255).optional().nullable(),
  sourceMessageId: z.string().trim().min(1).max(255).optional().nullable(),
  externalReference: z.string().trim().min(1).max(255).optional().nullable(),
  idempotencyKey: z.string().trim().min(1).max(255).optional().nullable(),
  payloadHash: z.string().trim().min(1).max(128).optional().nullable(),
  rawPayloadJson: jsonObjectSchema.optional().default({}),
  normalizedPayloadJson: jsonObjectSchema.optional().default({}),
  extractedCustomerJson: jsonObjectSchema.optional().nullable(),
  extractedOrderJson: jsonObjectSchema.optional().nullable(),
  extractedShippingJson: jsonObjectSchema.optional().nullable(),
  requiresHumanDecision: z.boolean().optional().default(false),
  reviewRequiredReason: z.string().trim().min(1).max(2000).optional().nullable(),
});

function isMissingInboundSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("inbound_order")
    && (
      message.includes("does not exist")
      || message.includes("relation")
      || message.includes("type")
      || message.includes("column")
    )
  );
}

function sendInboundSchemaUnavailable(res: any) {
  return res.status(503).json({
    success: false,
    message: "Inbound order tables are not available yet. Run the inbound orders migration before using this queue.",
  });
}

const reviewActionSchema = z.object({
  note: z.string().trim().min(1).max(2000).optional().nullable(),
  reason: z.string().trim().min(1).max(2000).optional().nullable(),
});

const reviewDraftSnapshotSchema = z.object({
  customerDraft: jsonObjectSchema.default({}),
  contactDraft: jsonObjectSchema.default({}),
  orderNotes: z.string().trim().max(10000).optional().nullable(),
  desiredOutputType: z.string().trim().max(255).optional().nullable(),
  lineItemDrafts: z.array(jsonObjectSchema).max(250).default([]),
  staffNotes: z.string().trim().max(10000).optional().nullable(),
  metadata: jsonObjectSchema.default({}),
});

const lineItemProductMatchSchema = z.object({
  productId: z.string().trim().min(1),
  variantId: z.string().trim().min(1).optional().nullable(),
  optionSelectionsJson: jsonObjectSchema.optional().nullable(),
  staffNote: z.string().trim().max(2000).optional().nullable(),
});

const warningResolutionSchema = z.object({
  status: z.enum(["resolved", "ignored"]).default("resolved"),
  resolutionNote: z.string().trim().max(2000).optional().nullable(),
});

const decisionFlagResolutionSchema = z.object({
  status: z.enum(["accepted", "overridden", "dismissed"]).default("accepted"),
  decisionValueJson: jsonObjectSchema.optional().nullable(),
  decisionNote: z.string().trim().max(2000).optional().nullable(),
});

const inboundCustomerSearchQuerySchema = z.object({
  search: z.string().trim().max(255).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const inboundContactSearchQuerySchema = z.object({
  customerId: z.string().trim().min(1).optional(),
  search: z.string().trim().max(255).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const inboundProductSearchQuerySchema = z.object({
  search: z.string().trim().max(255).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const customerMatchSchema = z.object({
  customerId: z.string().trim().min(1),
  contactId: z.string().trim().min(1).optional().nullable(),
  staffNote: z.string().trim().max(2000).optional().nullable(),
});

const inboundEmailPullLatestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(25).optional(),
});

const inboundEmailMailboxParamsSchema = z.object({
  id: z.string().trim().min(1),
});

const inboundEmailMailboxEnabledSchema = z.object({
  enabled: z.boolean(),
});

const inboundGmailStartQuerySchema = z.object({
  reconnectMailboxId: z.string().trim().min(1).optional(),
});

type InboundGmailOAuthState = {
  organizationId: string;
  reconnectMailboxId?: string | null;
  actorUserId?: string | null;
};

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function buildInboundGmailOAuthState(payload: InboundGmailOAuthState): string {
  const secret = String(process.env.SESSION_SECRET || "").trim();
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  const ts = Date.now();
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${encodedPayload}:${ts}`)
    .digest("hex")
    .slice(0, 32);
  return `inbound_gmail:${encodedPayload}:${ts}:${signature}`;
}

function parseInboundGmailOAuthState(state: string | undefined | null): InboundGmailOAuthState | null {
  if (!state || typeof state !== "string") return null;
  const parts = state.split(":");
  if (parts.length !== 4) return null;
  const [prefix, encodedPayload, tsRaw, signature] = parts;
  if (prefix !== "inbound_gmail" || !encodedPayload) return null;

  const ts = Number(tsRaw);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const ageMs = Date.now() - ts;
  if (ageMs < 0 || ageMs > 30 * 60 * 1000) {
    console.warn("[Inbound Gmail OAuth] State token expired", { ageSeconds: Math.round(ageMs / 1000) });
    return null;
  }

  const secret = String(process.env.SESSION_SECRET || "").trim();
  if (!secret) return null;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${encodedPayload}:${ts}`)
    .digest("hex")
    .slice(0, 32);
  if (expected !== signature) {
    console.warn("[Inbound Gmail OAuth] State token signature mismatch");
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(encodedPayload));
    if (!parsed?.organizationId || typeof parsed.organizationId !== "string") return null;
    return {
      organizationId: parsed.organizationId,
      reconnectMailboxId: typeof parsed.reconnectMailboxId === "string" ? parsed.reconnectMailboxId : null,
      actorUserId: typeof parsed.actorUserId === "string" ? parsed.actorUserId : null,
    };
  } catch {
    return null;
  }
}

function getInboundGmailRedirectUri(req: any): string {
  if (process.env.GOOGLE_INBOUND_OAUTH_REDIRECT_URI) return process.env.GOOGLE_INBOUND_OAUTH_REDIRECT_URI;
  const base = (process.env.APP_URL ?? `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  return `${base}/api/inbound-orders/email/mailboxes/gmail/callback`;
}

function getEmailSettingsRedirectUrl(req: any, query?: string): string {
  const base = (process.env.APP_URL ?? `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  return `${base}/settings/email${query ? `?${query}` : ""}`;
}

function assertOwnerOrAdmin(req: any, res: any): boolean {
  const role = req.user?.role || "customer";
  if (!["owner", "admin"].includes(role)) {
    res.status(403).json({ success: false, message: "Only owners and admins can manage inbound mailboxes" });
    return false;
  }
  return true;
}

export function registerInboundOrderRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    assertInternalUser: (req: any, res: any) => boolean;
    inboundOrderService?: typeof inboundOrderService;
    inboundOrderParsingService?: typeof inboundOrderParsingService;
    inboundEmailIntakeSettingsService?: typeof inboundEmailIntakeSettingsService;
    inboundEmailIngestionService?: typeof inboundEmailIngestionService;
    inboundEmailMailboxSettingsService?: typeof inboundEmailMailboxSettingsService;
  },
): void {
  const { isAuthenticated, tenantContext, assertInternalUser } = middleware;
  const service = middleware.inboundOrderService ?? inboundOrderService;
  const parsingService = middleware.inboundOrderParsingService ?? inboundOrderParsingService;
  const emailSettingsService = middleware.inboundEmailIntakeSettingsService ?? inboundEmailIntakeSettingsService;
  const emailIngestionService = middleware.inboundEmailIngestionService ?? inboundEmailIngestionService;
  const emailMailboxSettingsService = middleware.inboundEmailMailboxSettingsService ?? inboundEmailMailboxSettingsService;

  app.get("/api/inbound-orders/email-settings", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const settings = await emailSettingsService.getSettings(organizationId);
      res.json({ success: true, data: settings });
    } catch (error: any) {
      if (error?.statusCode === 404) {
        return res.status(404).json({ success: false, message: "Organization not found" });
      }

      console.error("Error loading inbound email intake settings:", error);
      res.status(500).json({ success: false, message: "Failed to load inbound email intake settings" });
    }
  });

  app.post("/api/inbound-orders/email/pull-latest", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const guard = await emailSettingsService.getPullGuard(organizationId);
      if (!guard.allowed) {
        return res.status(409).json({
          success: false,
          code: guard.reason === "disabled" ? "INBOUND_EMAIL_INTAKE_DISABLED" : "INBOUND_EMAIL_PULL_PAUSED",
          message: guard.message,
          data: guard.settings,
        });
      }

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ success: false, message: "User ID not found" });

      const input = inboundEmailPullLatestSchema.parse(req.body ?? {});
      const result = await emailIngestionService.pullLatestEmails({
        organizationId,
        actorUserId,
        limit: input.limit,
      });

      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: fromZodError(error).message });
      }

      if (error instanceof InboundEmailIngestionError) {
        return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
      }

      if (error?.statusCode === 404) {
        return res.status(404).json({ success: false, message: "Organization not found" });
      }

      console.error("Error pulling latest inbound emails:", error);
      res.status(500).json({ success: false, message: "Failed to pull latest inbound emails" });
    }
  });

  app.get("/api/inbound-orders/email/mailboxes", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const mailboxes = (await emailMailboxSettingsService.listMailboxes(organizationId))
        .map((mailbox) => inboundEmailMailboxViewSchema.parse(mailbox));
      res.json({ success: true, data: { mailboxes } });
    } catch (error) {
      console.error("Error listing inbound email mailboxes:", error);
      res.status(500).json({ success: false, message: "Failed to list inbound email mailboxes" });
    }
  });

  app.get("/api/inbound-orders/email/mailboxes/gmail/start", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      if (!assertOwnerOrAdmin(req, res)) return;

      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return res.status(503).json({
          success: false,
          message: "Inbound Gmail OAuth is not configured on this platform. Contact your administrator to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
        });
      }

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const query = inboundGmailStartQuerySchema.parse(req.query ?? {});
      const redirectUri = getInboundGmailRedirectUri(req);
      const state = buildInboundGmailOAuthState({
        organizationId,
        reconnectMailboxId: query.reconnectMailboxId ?? null,
        actorUserId: getUserId(req.user) ?? null,
      });

      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
      const url = oauth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: [
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/userinfo.email",
          "https://www.googleapis.com/auth/userinfo.profile",
        ],
        state,
      });

      res.json({ success: true, data: { url } });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: fromZodError(error).message });
      }

      console.error("Error starting inbound Gmail OAuth:", error);
      res.status(500).json({ success: false, message: "Failed to start inbound Gmail OAuth" });
    }
  });

  app.get("/api/inbound-orders/email/mailboxes/gmail/callback", async (req: any, res) => {
    const { code, state, error: oauthError } = req.query as Record<string, string>;

    if (oauthError) {
      console.warn("[Inbound Gmail OAuth] Google returned error:", oauthError);
      return res.redirect(getEmailSettingsRedirectUrl(req, `inboundGmailError=${encodeURIComponent(oauthError === "access_denied" ? "cancelled" : oauthError)}`));
    }

    const parsed = parseInboundGmailOAuthState(state);
    if (!parsed) {
      return res.redirect(getEmailSettingsRedirectUrl(req, "inboundGmailError=invalid_state"));
    }

    if (!code) {
      return res.redirect(getEmailSettingsRedirectUrl(req, "inboundGmailError=missing_code"));
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return res.redirect(getEmailSettingsRedirectUrl(req, "inboundGmailError=platform_not_configured"));
    }

    const redirectUri = getInboundGmailRedirectUri(req);
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    let tokens: any;
    try {
      const tokenResponse = await oauth2Client.getToken(code);
      tokens = tokenResponse.tokens;
      if (!tokens.refresh_token) {
        return res.redirect(getEmailSettingsRedirectUrl(req, "inboundGmailError=no_refresh_token"));
      }
      oauth2Client.setCredentials(tokens);
    } catch (error) {
      console.error("[Inbound Gmail OAuth] token exchange failed:", error);
      return res.redirect(getEmailSettingsRedirectUrl(req, "inboundGmailError=token_exchange_failed"));
    }

    let connectedEmail: string;
    try {
      const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
      const { data } = await oauth2.userinfo.get();
      if (!data.email || data.verified_email === false) {
        throw new Error("Google did not return a verified Gmail profile email.");
      }
      connectedEmail = data.email;
    } catch (error) {
      console.error("[Inbound Gmail OAuth] profile lookup failed:", error);
      return res.redirect(getEmailSettingsRedirectUrl(req, "inboundGmailError=profile_lookup_failed"));
    }

    try {
      await emailMailboxSettingsService.connectGmailMailbox({
        organizationId: parsed.organizationId,
        actorUserId: parsed.actorUserId,
        reconnectMailboxId: parsed.reconnectMailboxId,
        emailAddress: connectedEmail,
        refreshToken: tokens.refresh_token,
        scopes: tokens.scope ?? null,
        tokenType: tokens.token_type ?? null,
        redirectUri,
      });
    } catch (error: any) {
      console.error("[Inbound Gmail OAuth] failed to store mailbox connection:", error);
      const reason = error?.statusCode === 409 ? "duplicate_email" : error?.statusCode === 404 ? "mailbox_not_found" : "storage_failed";
      return res.redirect(getEmailSettingsRedirectUrl(req, `inboundGmailError=${reason}`));
    }

    return res.redirect(getEmailSettingsRedirectUrl(req, "inboundGmailConnected=true"));
  });

  app.patch("/api/inbound-orders/email/mailboxes/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      if (!assertOwnerOrAdmin(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const { id } = inboundEmailMailboxParamsSchema.parse(req.params);
      const { enabled } = inboundEmailMailboxEnabledSchema.parse(req.body ?? {});
      const mailbox = inboundEmailMailboxViewSchema.parse(
        await emailMailboxSettingsService.updateMailboxEnabled(organizationId, id, enabled),
      );
      res.json({ success: true, data: mailbox });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: fromZodError(error).message });
      }
      if (error?.statusCode === 404) {
        return res.status(404).json({ success: false, message: "Inbound mailbox not found" });
      }

      console.error("Error updating inbound email mailbox:", error);
      res.status(500).json({ success: false, message: "Failed to update inbound email mailbox" });
    }
  });

  app.post("/api/inbound-orders/email/mailboxes/:id/default", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      if (!assertOwnerOrAdmin(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const { id } = inboundEmailMailboxParamsSchema.parse(req.params);
      const mailbox = inboundEmailMailboxViewSchema.parse(
        await emailMailboxSettingsService.setDefaultMailbox(organizationId, id),
      );
      res.json({ success: true, data: mailbox });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: fromZodError(error).message });
      }
      if (error?.statusCode === 404) {
        return res.status(404).json({ success: false, message: "Inbound mailbox not found" });
      }

      console.error("Error setting default inbound email mailbox:", error);
      res.status(500).json({ success: false, message: "Failed to set default inbound email mailbox" });
    }
  });

  app.delete("/api/inbound-orders/email/mailboxes/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      if (!assertOwnerOrAdmin(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const { id } = inboundEmailMailboxParamsSchema.parse(req.params);
      const result = await emailMailboxSettingsService.deleteMailbox(organizationId, id);
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: fromZodError(error).message });
      }
      if (error?.statusCode === 404) {
        return res.status(404).json({ success: false, message: "Inbound mailbox not found" });
      }

      console.error("Error deleting inbound email mailbox:", error);
      res.status(500).json({ success: false, message: "Failed to delete inbound email mailbox" });
    }
  });

  app.get("/api/inbound-orders", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const filters = inboundOrderListQuerySchema.parse(req.query);
      const result = await service.listInboundOrders({
        organizationId,
        filters,
      });

      res.json({
        success: true,
        data: result.records,
        summary: result.summary,
        pagination: {
          limit: filters.limit,
          offset: filters.offset,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error listing inbound orders:", error);
      res.status(500).json({ message: "Failed to list inbound orders" });
    }
  });

  app.get("/api/inbound-orders/customer-search", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const query = inboundCustomerSearchQuerySchema.parse(req.query);
      const customers = await service.searchCustomers({
        organizationId,
        search: query.search ?? null,
        limit: query.limit,
      });

      res.json({ success: true, data: customers });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      console.error("Error searching inbound customer matches:", error);
      res.status(500).json({ message: "Failed to search inbound customer matches" });
    }
  });

  app.get("/api/inbound-orders/contact-search", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const query = inboundContactSearchQuerySchema.parse(req.query);
      const contacts = await service.searchCustomerContacts({
        organizationId,
        customerId: query.customerId ?? null,
        search: query.search ?? null,
        limit: query.limit,
      });

      res.json({ success: true, data: contacts });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      console.error("Error searching inbound contact matches:", error);
      res.status(500).json({ message: "Failed to search inbound contact matches" });
    }
  });

  app.get("/api/inbound-orders/product-search", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const query = inboundProductSearchQuerySchema.parse(req.query);
      const products = await service.searchProducts({
        organizationId,
        search: query.search ?? null,
        limit: query.limit,
      });

      res.json({ success: true, data: products });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      console.error("Error searching inbound product catalog:", error);
      res.status(500).json({ message: "Failed to search inbound product catalog" });
    }
  });

  app.post("/api/inbound-orders/product-options/:productId", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const data = await service.getProductOptionsForReview({
        organizationId,
        productId: String(req.params.productId),
        lineItem: req.body?.lineItem ?? null,
      });

      res.json({ success: true, data });
    } catch (error) {
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      console.error("Error loading inbound product options:", error);
      res.status(500).json({ message: "Failed to load inbound product options" });
    }
  });

  app.get("/api/inbound-orders/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const detail = await service.getInboundOrder({
        organizationId,
        inboundRecordId: String(req.params.id),
      });

      if (!detail) {
        return res.status(404).json({ message: "Inbound order record not found" });
      }

      res.json({ success: true, data: detail });
    } catch (error) {
      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error fetching inbound order detail:", error);
      res.status(500).json({ message: "Failed to fetch inbound order detail" });
    }
  });

  app.patch("/api/inbound-orders/:id/status", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const input = inboundOrderStatusUpdateSchema.parse(req.body ?? {});
      const detail = await service.updateInboundOrderStatus({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
        status: normalizeInboundOrderStatusForStorage(input.status),
      });

      res.json({ success: true, data: detail });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error updating inbound order status:", error);
      res.status(500).json({ message: "Failed to update inbound order status" });
    }
  });

  app.post("/api/inbound-orders/:id/parse", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const result = await parsingService.parseInboundOrderRecord({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
      });

      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error parsing inbound order:", error);
      res.status(500).json({ message: "Failed to parse inbound order" });
    }
  });

  app.get("/api/inbound-orders/:id/parse-attempts", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const attempts = await parsingService.listParseAttempts({
        organizationId,
        inboundRecordId: String(req.params.id),
      });

      res.json({ success: true, data: attempts });
    } catch (error) {
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error listing inbound order parse attempts:", error);
      res.status(500).json({ message: "Failed to list inbound order parse attempts" });
    }
  });

  app.get("/api/inbound-orders/:id/draft-preview", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const preview = await parsingService.getDraftPreview({
        organizationId,
        inboundRecordId: String(req.params.id),
      });

      res.json({ success: true, data: preview });
    } catch (error) {
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error loading inbound order draft preview:", error);
      res.status(500).json({ message: "Failed to load inbound order draft preview" });
    }
  });

  app.get("/api/inbound-orders/:id/review-draft", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const draft = await service.getReviewDraft({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
      });

      res.json({ success: true, data: draft });
    } catch (error) {
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error loading inbound order review draft:", error);
      res.status(500).json({ message: "Failed to load inbound order review draft" });
    }
  });

  app.put("/api/inbound-orders/:id/review-draft", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const draftInput = inboundOrderReviewDraftSaveSchema.parse(req.body ?? {});
      const draft = await service.saveReviewDraft({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
        draft: draftInput,
      });

      res.json({ success: true, data: draft });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error saving inbound order review draft:", error);
      res.status(500).json({ message: "Failed to save inbound order review draft" });
    }
  });

  app.post("/api/inbound-orders/:id/review-draft/mark-ready", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const draft = await service.markReviewDraftReady({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
      });

      res.json({ success: true, data: draft });
    } catch (error) {
      if (error instanceof InboundOrderReviewDraftValidationError) {
        return res.status(error.statusCode).json({ message: error.message, errors: error.errors });
      }

      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error marking inbound order review draft ready:", error);
      res.status(500).json({ message: "Failed to mark inbound order review draft ready" });
    }
  });

  app.post("/api/inbound-orders/:id/review-draft/reopen", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const draft = await service.reopenReviewDraft({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
      });

      res.json({ success: true, data: draft });
    } catch (error) {
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error reopening inbound order review draft:", error);
      res.status(500).json({ message: "Failed to reopen inbound order review draft" });
    }
  });

  app.post("/api/inbound-orders/:id/review-draft/refresh-from-latest-parse", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const draft = await service.refreshReviewDraftFromLatestParse({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
      });

      res.json({ success: true, data: draft });
    } catch (error) {
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error refreshing inbound order review draft from latest parse:", error);
      res.status(500).json({ message: "Failed to refresh inbound order review draft from latest parse" });
    }
  });

  const handleReviewAction = (
    action: "mark-reviewed" | "needs-clarification" | "reject" | "reopen",
  ) => async (req: any, res: any) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const input = reviewActionSchema.parse(req.body ?? {});
      const detail = await service.applyReviewAction({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
        action,
        note: input.note ?? input.reason ?? null,
      });

      res.json({ success: true, data: detail });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      console.error(`Error applying inbound order review action ${action}:`, error);
      res.status(500).json({ message: "Failed to update inbound order review state" });
    }
  };

  app.post(
    "/api/inbound-orders/:id/mark-reviewed",
    isAuthenticated,
    tenantContext,
    handleReviewAction("mark-reviewed"),
  );

  app.post(
    "/api/inbound-orders/:id/needs-clarification",
    isAuthenticated,
    tenantContext,
    handleReviewAction("needs-clarification"),
  );

  app.post(
    "/api/inbound-orders/:id/reject",
    isAuthenticated,
    tenantContext,
    handleReviewAction("reject"),
  );

  app.post(
    "/api/inbound-orders/:id/reopen",
    isAuthenticated,
    tenantContext,
    handleReviewAction("reopen"),
  );

  app.post("/api/inbound-orders/:id/review-snapshot", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const draftInput = reviewDraftSnapshotSchema.parse(req.body ?? {});
      const detail = await service.saveReviewSnapshot({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
        draft: {
          ...draftInput,
          orderNotes: draftInput.orderNotes ?? null,
          desiredOutputType: draftInput.desiredOutputType ?? null,
          staffNotes: draftInput.staffNotes ?? null,
        },
      });

      res.json({ success: true, data: detail });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      console.error("Error saving inbound order review snapshot:", error);
      res.status(500).json({ message: "Failed to save inbound order review snapshot" });
    }
  });

  app.get("/api/inbound-orders/:id/quote-draft-preview", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const preview = await service.getQuoteDraftPreview({
        organizationId,
        inboundRecordId: String(req.params.id),
      });

      res.json({ success: true, data: preview });
    } catch (error) {
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      console.error("Error loading inbound order quote draft preview:", error);
      res.status(500).json({ message: "Failed to load inbound order quote draft preview" });
    }
  });

  app.post("/api/inbound-orders/:id/match-customer", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const input = customerMatchSchema.parse(req.body ?? {});
      const detail = await service.matchCustomer({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
        customerId: input.customerId,
        contactId: input.contactId ?? null,
        staffNote: input.staffNote ?? null,
      });

      res.json({ success: true, data: detail });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      console.error("Error matching inbound customer:", error);
      res.status(500).json({ message: "Failed to match inbound customer" });
    }
  });

  app.post("/api/inbound-orders/:id/line-items/:lineItemId/match-product", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const input = lineItemProductMatchSchema.parse(req.body ?? {});
      const detail = await service.matchLineItemProduct({
        organizationId,
        inboundRecordId: String(req.params.id),
        lineItemId: String(req.params.lineItemId),
        actorUserId,
        productId: input.productId,
        variantId: input.variantId ?? null,
        optionSelectionsJson: input.optionSelectionsJson ?? {},
        staffNote: input.staffNote ?? null,
      });

      res.json({ success: true, data: detail });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      console.error("Error matching inbound line item product:", error);
      res.status(500).json({ message: "Failed to match inbound line item product" });
    }
  });

  app.post("/api/inbound-orders/:id/warnings/:warningId/resolve", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const input = warningResolutionSchema.parse(req.body ?? {});
      const detail = await service.resolveWarning({
        organizationId,
        inboundRecordId: String(req.params.id),
        warningId: String(req.params.warningId),
        actorUserId,
        status: input.status,
        resolutionNote: input.resolutionNote ?? null,
      });

      res.json({ success: true, data: detail });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      console.error("Error resolving inbound warning:", error);
      res.status(500).json({ message: "Failed to resolve inbound warning" });
    }
  });

  app.post("/api/inbound-orders/:id/decision-flags/:flagId/resolve", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const input = decisionFlagResolutionSchema.parse(req.body ?? {});
      const detail = await service.resolveDecisionFlag({
        organizationId,
        inboundRecordId: String(req.params.id),
        flagId: String(req.params.flagId),
        actorUserId,
        status: input.status,
        decisionValueJson: input.decisionValueJson ?? {},
        decisionNote: input.decisionNote ?? null,
      });

      res.json({ success: true, data: detail });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      console.error("Error resolving inbound decision flag:", error);
      res.status(500).json({ message: "Failed to resolve inbound decision flag" });
    }
  });

  app.post("/api/inbound-orders/:id/create-quote-draft", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      res.status(409).json({
        success: false,
        message: "Inbound Orders Phase 1 is review-only. Draft conversion is not enabled yet.",
      });
    } catch (error) {
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      console.error("Error creating quote draft from inbound order:", error);
      res.status(500).json({ message: "Failed to create quote draft from inbound order" });
    }
  });

  app.post("/api/inbound-orders/:id/convert-to-order", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const result = await service.convertInboundReviewDraftToOrder({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
      });

      res.json({
        success: true,
        data: {
          orderId: result.orderId,
          inboundOrderId: result.inboundOrderId,
          convertedAt: result.convertedAt,
          alreadyConverted: Boolean(result.alreadyConverted),
          order: result.order,
          inbound: result.inbound,
        },
      });
    } catch (error) {
      if (error instanceof InboundOrderConversionValidationError) {
        return res.status(error.statusCode).json({ success: false, message: error.message, errors: error.errors });
      }

      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }

      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error converting inbound review draft to order:", error);
      res.status(500).json({ success: false, message: "Failed to create draft order from inbound review." });
    }
  });

  app.post("/api/inbound-orders/manual", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const parsed = manualInboundOrderCreateSchema.safeParse(req.body);
      const legacyParsed = parsed.success
        ? null
        : legacyManualInboundOrderCreateSchema.safeParse(req.body);

      const created = parsed.success
        ? await service.createManualInboundOrder({
          organizationId,
          actorUserId,
          ...parsed.data,
        })
        : legacyParsed?.success
          ? await service.createManualRecord({
            organizationId,
            actorUserId,
            ...legacyParsed.data,
          })
          : null;

      if (!created) {
        const validationError = parsed.success ? null : parsed.error;
        return res.status(400).json({
          message: validationError ? fromZodError(validationError).message : "Invalid manual inbound order payload",
        });
      }

      res.status(201).json({ success: true, data: created });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error creating manual inbound order:", error);
      res.status(500).json({ message: "Failed to create manual inbound order" });
    }
  });
}
