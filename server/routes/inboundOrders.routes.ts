/**
 * inboundOrders.routes.ts
 *
 * Internal TitanOS Inbound Orders Review Queue routes.
 * These endpoints manage intake/review artifacts, matching, immutable snapshots,
 * and quote draft conversion. Order conversion, production, and automation stay out of scope here.
 */

import crypto from "crypto";
import fsPromises from "fs/promises";
import path from "path";
import type { Express } from "express";
import { google } from "googleapis";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

import {
  inboundEmailIgnoreRuleCreateSchema,
  inboundEmailIgnoreRuleUpdateSchema,
  inboundEmailTrustRuleCreateSchema,
  inboundEmailTrustRuleUpdateSchema,
  inboundAttachmentTrustActionSchema,
  inboundOrderAttachToOrderSchema,
  inboundOrderCombineSchema,
  inboundRecordTrustActionSchema,
  inboundOrderBulkActionSchema,
  inboundOrderIgnoreActionSchema,
  inboundOrderListQuerySchema,
  inboundOrderReviewDraftSaveSchema,
  inboundOrderStatusUpdateSchema,
  manualInboundOrderCreateSchema,
  normalizeInboundOrderStatusForStorage,
} from "@shared/inboundOrdersApi";
import type { InboundEmailIgnoreRule, InboundEmailTrustRule } from "@shared/schema";
import { inboundAttachmentClassificationRuleMatchTypeSchema } from "@shared/schema";
import { inboundAttachmentClassificationValues } from "@shared/inboundAttachmentClassification";
import {
  inboundEmailMailboxSettingsSchema,
  inboundEmailMailboxViewSchema,
} from "@shared/inboundEmailMailboxes";
import {
  InboundOrderConversionValidationError,
  InboundEmailRuleConflictError,
  InboundOrderReviewDraftValidationError,
  InboundOrderTransitionError,
  inboundOrderService,
} from "../services/inboundOrders/InboundOrderService";
import { inboundOrderParsingService } from "../services/inboundOrders/InboundOrderParsingService";
import { inboundOrdersRepository } from "../storage/inboundOrders.repo";
import { inboundEmailIntakeSettingsService } from "../services/inboundEmailIntakeSettingsService";
import {
  InboundEmailIngestionError,
  inboundEmailIngestionService,
} from "../services/inboundEmailIngestionService";
import { inboundEmailMailboxSettingsService } from "../services/inboundEmailMailboxSettingsService";
import { canonicalFileReadResolver } from "../services/storage/CanonicalFileReadResolver";
import { storageProviderConfigRepository } from "../storage/storageProviderConfig.repo";
import { storageRegistry } from "../services/storage/StorageRegistry";
import { inboundPdfSizeAnalysisService } from "../services/inboundOrders/InboundPdfSizeAnalysisService";
import { getRequestOrganizationId } from "../tenantContext";
import { hasAdminOrOwnerOperationalRole } from "@shared/roleAccess";

function getUserId(user: any): string | undefined {
  return user?.claims?.sub ?? user?.id;
}

function sendInboundRuleConflict(res: any, error: InboundEmailRuleConflictError) {
  return res.status(error.statusCode).json({
    success: false,
    code: "INBOUND_RULE_CONFLICT",
    message: error.message,
    conflict: error.conflict,
  });
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
  customerId: z.string().trim().min(1).optional().nullable(),
  contactId: z.string().trim().min(1).optional().nullable(),
  staffNote: z.string().trim().max(2000).optional().nullable(),
}).refine((value) => Boolean(value.customerId || value.contactId), {
  message: "Select a customer, a contact, or both.",
  path: ["customerId"],
});

const inboundCustomerCreateSchema = z.object({
  companyName: z.string().trim().min(1).max(255),
  customerEmail: z.string().trim().email().optional().nullable(),
  customerPhone: z.string().trim().max(80).optional().nullable(),
  contactFirstName: z.string().trim().max(120).optional().nullable(),
  contactLastName: z.string().trim().max(120).optional().nullable(),
  contactEmail: z.string().trim().email().optional().nullable(),
  contactPhone: z.string().trim().max(80).optional().nullable(),
  staffNote: z.string().trim().max(2000).optional().nullable(),
});

const inboundEmailPullLatestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const inboundEmailPullDiagnosticsQuerySchema = z.object({
  subject: z.string().trim().max(500).optional(),
});

const inboundEmailMailboxParamsSchema = z.object({
  id: z.string().trim().min(1),
});

const inboundEmailMailboxUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  settings: inboundEmailMailboxSettingsSchema.partial().optional(),
}).refine((value) => value.enabled !== undefined || value.settings !== undefined, {
  message: "At least one mailbox setting is required.",
});

const inboundEmailIgnoreRuleParamsSchema = z.object({
  id: z.string().trim().min(1),
});

const inboundEmailTrustRuleParamsSchema = z.object({
  id: z.string().trim().min(1),
});

const inboundAttachmentParamsSchema = z.object({
  id: z.string().trim().min(1),
  fileId: z.string().trim().min(1),
});

const inboundAttachmentClassificationUpdateSchema = z.object({
  classification: z.enum(inboundAttachmentClassificationValues),
  rememberForCustomer: z.boolean().optional().default(false),
  rule: z.object({
    customerId: z.string().trim().min(1).optional().nullable(),
    senderDomain: z.string().trim().min(1).max(255).optional().nullable(),
    matchType: inboundAttachmentClassificationRuleMatchTypeSchema,
    matchValue: z.string().trim().min(1).max(500),
  }).optional().nullable(),
});

const inboundAttachmentClassificationBulkUpdateSchema = z.object({
  fileIds: z.array(z.string().trim().min(1)).min(1).max(100),
  classification: z.union([
    z.enum(inboundAttachmentClassificationValues),
    z.literal("reset_to_ai"),
  ]),
});

const inboundEmailReprocessActionSchema = z.object({
  action: z.enum(["reprocess_email", "backfill_attachments", "rerun_trust_attachment_download"]),
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
  if (!hasAdminOrOwnerOperationalRole(String(req.actorOrgRole ?? req.orgRole ?? ""))) {
    res.status(403).json({ success: false, message: "Only owners and admins can manage inbound mailboxes" });
    return false;
  }
  return true;
}

function formatInboundEmailIgnoreRule(rule: InboundEmailIgnoreRule) {
  return {
    ...rule,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
    lastMatchedAt: rule.lastMatchedAt ? rule.lastMatchedAt.toISOString() : null,
  };
}

function formatInboundEmailTrustRule(rule: InboundEmailTrustRule) {
  return {
    ...rule,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
    lastMatchedAt: rule.lastMatchedAt ? rule.lastMatchedAt.toISOString() : null,
  };
}

function stripDiagnosticSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDiagnosticSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/(auth|token|secret|credential|password)/i.test(key))
    .map(([key, entry]) => [key, stripDiagnosticSecrets(entry)]));
}

export function registerInboundOrderRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    assertInternalUser: (req: any, res: any) => boolean;
    inboundOrderService?: typeof inboundOrderService;
    inboundOrderParsingService?: typeof inboundOrderParsingService;
    inboundOrdersRepository?: typeof inboundOrdersRepository;
    inboundEmailIntakeSettingsService?: typeof inboundEmailIntakeSettingsService;
    inboundEmailIngestionService?: typeof inboundEmailIngestionService;
    inboundEmailMailboxSettingsService?: typeof inboundEmailMailboxSettingsService;
  },
): void {
  const { isAuthenticated, tenantContext, assertInternalUser } = middleware;
  const service = middleware.inboundOrderService ?? inboundOrderService;
  const parsingService = middleware.inboundOrderParsingService ?? inboundOrderParsingService;
  const eventRepository = middleware.inboundOrdersRepository ?? inboundOrdersRepository;
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

  app.get("/api/inbound-orders/email/pull-diagnostics", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      if (!assertOwnerOrAdmin(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const input = inboundEmailPullDiagnosticsQuerySchema.parse(req.query ?? {});
      const diagnostics = await service.getEmailPullDiagnostics({
        organizationId,
        subject: input.subject ?? null,
      });
      if (input.subject && typeof emailIngestionService.getGmailPayloadDiagnosticsForSubject === "function") {
        (diagnostics as any).subjectSearch.gmailPayloadDiagnostics = await emailIngestionService.getGmailPayloadDiagnosticsForSubject({
          organizationId,
          subject: input.subject,
          limit: 3,
        });
      }
      res.json({ success: true, data: stripDiagnosticSecrets(diagnostics) });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: fromZodError(error).message });
      }
      console.error("Error loading inbound email pull diagnostics:", error);
      res.status(500).json({ success: false, message: "Failed to load inbound email pull diagnostics" });
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

  app.get("/api/inbound-orders/email/ignore-rules", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const rules = (await service.listEmailIgnoreRules({ organizationId })).map(formatInboundEmailIgnoreRule);
      res.json({ success: true, data: { rules } });
    } catch (error) {
      console.error("Error listing inbound email ignore rules:", error);
      res.status(500).json({ success: false, message: "Failed to list inbound email ignore rules" });
    }
  });

  app.post("/api/inbound-orders/email/ignore-rules", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      if (!assertOwnerOrAdmin(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ success: false, message: "User ID not found" });

      const input = inboundEmailIgnoreRuleCreateSchema.parse(req.body ?? {});
      const rule = await service.createEmailIgnoreRule({
        organizationId,
        actorUserId,
        ruleType: input.ruleType,
        ruleValue: input.ruleValue,
        notes: input.notes ?? null,
        enabled: input.enabled,
        resolveConflict: input.resolveConflict,
      });
      res.status(201).json({ success: true, data: formatInboundEmailIgnoreRule(rule) });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: fromZodError(error).message });
      }
      if (error instanceof InboundEmailRuleConflictError) return sendInboundRuleConflict(res, error);
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      console.error("Error creating inbound email ignore rule:", error);
      res.status(500).json({ success: false, message: "Failed to create inbound email ignore rule" });
    }
  });

  app.patch("/api/inbound-orders/email/ignore-rules/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      if (!assertOwnerOrAdmin(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const { id } = inboundEmailIgnoreRuleParamsSchema.parse(req.params);
      const input = inboundEmailIgnoreRuleUpdateSchema.parse(req.body ?? {});
      const rule = await service.updateEmailIgnoreRule({
        organizationId,
        id,
        ruleType: input.ruleType,
        ruleValue: input.ruleValue,
        enabled: input.enabled,
        notes: input.notes,
        resolveConflict: input.resolveConflict,
      });
      res.json({ success: true, data: formatInboundEmailIgnoreRule(rule) });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: fromZodError(error).message });
      }
      if (error instanceof InboundEmailRuleConflictError) return sendInboundRuleConflict(res, error);
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      console.error("Error updating inbound email ignore rule:", error);
      res.status(500).json({ success: false, message: "Failed to update inbound email ignore rule" });
    }
  });

  app.delete("/api/inbound-orders/email/ignore-rules/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      if (!assertOwnerOrAdmin(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const { id } = inboundEmailIgnoreRuleParamsSchema.parse(req.params);
      const rule = await service.deleteEmailIgnoreRule({ organizationId, id });
      res.json({ success: true, data: formatInboundEmailIgnoreRule(rule) });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: fromZodError(error).message });
      }
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      console.error("Error deleting inbound email ignore rule:", error);
      res.status(500).json({ success: false, message: "Failed to delete inbound email ignore rule" });
    }
  });

  app.get("/api/inbound-orders/email/trust-rules", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const rules = (await service.listEmailTrustRules({ organizationId })).map(formatInboundEmailTrustRule);
      res.json({ success: true, data: { rules } });
    } catch (error) {
      console.error("Error listing inbound email trust rules:", error);
      res.status(500).json({ success: false, message: "Failed to list inbound email trust rules" });
    }
  });

  app.post("/api/inbound-orders/email/trust-rules", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      if (!assertOwnerOrAdmin(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ success: false, message: "User ID not found" });

      const input = inboundEmailTrustRuleCreateSchema.parse(req.body ?? {});
      const rule = await service.createEmailTrustRule({
        organizationId,
        actorUserId,
        ruleType: input.ruleType,
        ruleValue: input.ruleValue,
        notes: input.notes ?? null,
        enabled: input.enabled,
        resolveConflict: input.resolveConflict,
      });
      res.status(201).json({ success: true, data: formatInboundEmailTrustRule(rule) });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: fromZodError(error).message });
      }
      if (error instanceof InboundEmailRuleConflictError) return sendInboundRuleConflict(res, error);
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      console.error("Error creating inbound email trust rule:", error);
      res.status(500).json({ success: false, message: "Failed to create inbound email trust rule" });
    }
  });

  app.patch("/api/inbound-orders/email/trust-rules/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      if (!assertOwnerOrAdmin(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const { id } = inboundEmailTrustRuleParamsSchema.parse(req.params);
      const input = inboundEmailTrustRuleUpdateSchema.parse(req.body ?? {});
      const rule = await service.updateEmailTrustRule({
        organizationId,
        id,
        ruleType: input.ruleType,
        ruleValue: input.ruleValue,
        enabled: input.enabled,
        notes: input.notes,
        resolveConflict: input.resolveConflict,
      });
      res.json({ success: true, data: formatInboundEmailTrustRule(rule) });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: fromZodError(error).message });
      }
      if (error instanceof InboundEmailRuleConflictError) return sendInboundRuleConflict(res, error);
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      console.error("Error updating inbound email trust rule:", error);
      res.status(500).json({ success: false, message: "Failed to update inbound email trust rule" });
    }
  });

  app.delete("/api/inbound-orders/email/trust-rules/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      if (!assertOwnerOrAdmin(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const { id } = inboundEmailTrustRuleParamsSchema.parse(req.params);
      const rule = await service.deleteEmailTrustRule({ organizationId, id });
      res.json({ success: true, data: formatInboundEmailTrustRule(rule) });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: fromZodError(error).message });
      }
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      console.error("Error deleting inbound email trust rule:", error);
      res.status(500).json({ success: false, message: "Failed to delete inbound email trust rule" });
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
      const input = inboundEmailMailboxUpdateSchema.parse(req.body ?? {});
      let updated = input.enabled !== undefined
        ? await emailMailboxSettingsService.updateMailboxEnabled(organizationId, id, input.enabled)
        : null;
      if (input.settings) {
        updated = await emailMailboxSettingsService.updateMailboxSettings(organizationId, id, input.settings);
      }
      const mailbox = inboundEmailMailboxViewSchema.parse(updated);
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

  app.post("/api/inbound-orders/review-line-pricing", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const pricingReviewJson = await service.priceReviewLine({
        organizationId,
        lineItem: req.body?.lineItem ?? null,
      });

      res.json({ success: true, data: { pricingReviewJson } });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      console.error("Error pricing inbound review line:", error);
      res.status(500).json({ message: "Failed to calculate inbound review line pricing" });
    }
  });

  app.get("/api/inbound-orders/order-search", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const search = typeof req.query.search === "string" ? req.query.search : null;
      const rows = await service.searchActiveOrdersForInboundAttachment({ organizationId, search, limit: 20 });
      res.json({ success: true, data: rows.map((row: any) => ({
        id: row.id,
        orderNumber: row.orderNumber,
        customerId: row.customerId,
        label: row.label,
        poNumber: row.poNumber,
        status: row.status,
        customer: row.customerName ? { companyName: row.customerName } : null,
        contact: row.contactEmail || row.contactName ? { email: row.contactEmail, name: row.contactName } : null,
      })) });
    } catch (error) {
      console.error("Error searching orders for inbound attachment:", error);
      res.status(500).json({ message: "Failed to search active orders" });
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

  app.post("/api/inbound-orders/:id/trust-action", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ success: false, message: "User ID not found" });

      const input = inboundRecordTrustActionSchema.parse(req.body ?? {});
      const result = await emailIngestionService.approveRecordTrustAction({
        organizationId,
        actorUserId,
        inboundRecordId: String(req.params.id),
        action: input.action,
        note: input.note ?? null,
        resolveConflict: input.resolveConflict,
      });
      const detail = await service.getInboundOrder({
        organizationId,
        inboundRecordId: String(req.params.id),
      });
      res.json({ success: true, data: { result, inbound: detail } });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: fromZodError(error).message });
      }
      if (error instanceof InboundEmailIngestionError) {
        return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message, ...(error.details ?? {}) });
      }
      console.error("Error applying inbound record trust action:", error);
      res.status(500).json({ success: false, message: "Failed to apply inbound sender trust action" });
    }
  });

  app.post("/api/inbound-orders/:id/email-reprocess", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ success: false, message: "User ID not found" });

      const input = inboundEmailReprocessActionSchema.parse(req.body ?? {});
      const result = await emailIngestionService.manuallyReprocessInboundEmailRecord({
        organizationId,
        actorUserId,
        inboundRecordId: String(req.params.id),
        action: input.action,
      });
      const detail = await service.getInboundOrder({
        organizationId,
        inboundRecordId: String(req.params.id),
      });
      res.json({ success: true, data: { result, inbound: detail } });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: fromZodError(error).message });
      }
      if (error instanceof InboundEmailIngestionError) {
        return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
      }
      console.error("Error manually reprocessing inbound email record:", error);
      res.status(500).json({ success: false, message: "Failed to reprocess inbound email record" });
    }
  });

  app.post("/api/inbound-orders/:id/files/:fileId/trust-action", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ success: false, message: "User ID not found" });

      const params = inboundAttachmentParamsSchema.parse(req.params);
      const input = inboundAttachmentTrustActionSchema.parse(req.body ?? {});
      const file = await emailIngestionService.approveAttachmentTrustAction({
        organizationId,
        actorUserId,
        inboundRecordId: params.id,
        fileId: params.fileId,
        action: input.action,
        note: input.note ?? null,
      });
      res.json({ success: true, data: file });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: fromZodError(error).message });
      }
      if (error instanceof InboundEmailIngestionError) {
        return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
      }
      console.error("Error applying inbound attachment trust action:", error);
      res.status(500).json({ success: false, message: "Failed to apply inbound attachment trust action" });
    }
  });

  app.post("/api/inbound-orders/:id/files/:fileId/classification", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ success: false, message: "User ID not found" });

      const params = inboundAttachmentParamsSchema.parse(req.params);
      const input = inboundAttachmentClassificationUpdateSchema.parse(req.body ?? {});
      const result = await service.updateAttachmentClassification({
        organizationId,
        actorUserId,
        inboundRecordId: params.id,
        fileId: params.fileId,
        classification: input.classification,
        rememberForCustomer: input.rememberForCustomer,
        rule: input.rule ?? null,
      });
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: fromZodError(error).message });
      }
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      console.error("Error updating inbound attachment classification:", error);
      res.status(500).json({ success: false, message: "Failed to update inbound attachment classification" });
    }
  });

  app.post("/api/inbound-orders/:id/files/classification/bulk", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ success: false, message: "User ID not found" });

      const recordId = z.string().trim().min(1).parse(req.params.id);
      const input = inboundAttachmentClassificationBulkUpdateSchema.parse(req.body ?? {});
      const result = await service.bulkUpdateAttachmentClassification({
        organizationId,
        actorUserId,
        inboundRecordId: recordId,
        fileIds: input.fileIds,
        classification: input.classification,
      });
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: fromZodError(error).message });
      }
      console.error("Error bulk updating inbound attachment classifications:", error);
      res.status(500).json({ success: false, message: "Failed to bulk update inbound attachment classifications" });
    }
  });

  app.post("/api/inbound-orders/:id/files/:fileId/pdf-size-scan", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });
      const params = inboundAttachmentParamsSchema.parse(req.params);
      const file = await eventRepository.getFile(organizationId, params.id, params.fileId);
      if (!file) return res.status(404).json({ success: false, message: "Inbound attachment not found" });
      const metadata = file.metadataJson && typeof file.metadataJson === "object" && !Array.isArray(file.metadataJson)
        ? file.metadataJson as Record<string, unknown>
        : {};
      if (!file.fileRecordId || file.status === "rejected" || metadata.attachmentState === "blocked_file_type") {
        return res.status(409).json({ success: false, code: "PDF_SIZE_UNAVAILABLE", message: "This attachment is not available for PDF size detection." });
      }
      if (typeof file.sizeBytes === "number" && file.sizeBytes > 25 * 1024 * 1024) {
        return res.status(413).json({ success: false, code: "PDF_SIZE_LIMIT", message: "This PDF is too large to scan for page size." });
      }
      const result = await inboundPdfSizeAnalysisService.scan({
        organizationId,
        inboundRecordId: params.id,
        file,
        force: req.body?.force === true,
        readBytes: async () => {
          const resolved = await canonicalFileReadResolver.resolveOriginal(file.fileRecordId!);
          if (resolved.status !== "available" || !resolved.providerConfigId) throw new Error("unavailable");
          const providerConfig = await storageProviderConfigRepository.getByIdForOrganization(organizationId, resolved.providerConfigId);
          if (!providerConfig) throw new Error("unavailable");
          const handle = await storageRegistry.getAdapter(providerConfig.providerType).getDownloadHandle({ providerConfig, objectKey: resolved.objectKey, localPathRef: resolved.localPathRef });
          const bytes = handle.kind === "local_path"
            ? await fsPromises.readFile(handle.value)
            : Buffer.from(await (await fetch(handle.value)).arrayBuffer());
          return new Uint8Array(bytes);
        },
      });
      const updated = await eventRepository.getFile(organizationId, params.id, params.fileId);
      res.json({ success: true, data: { analysis: result, file: updated } });
    } catch (error) {
      console.error("Error scanning inbound PDF size:", error);
      res.status(500).json({ success: false, message: "Unable to scan PDF page size." });
    }
  });

  app.get("/api/inbound-orders/:id/files/:fileId/download", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const detail = await service.getInboundOrder({
        organizationId,
        inboundRecordId: String(req.params.id),
      });
      if (!detail) return res.status(404).json({ message: "Inbound order record not found" });

      const file = detail.files.find((candidate) => candidate.id === String(req.params.fileId));
      if (!file) return res.status(404).json({ message: "Inbound attachment not found" });
      if (!file.fileRecordId) return res.status(404).json({ message: "Inbound attachment file is not stored" });
      const metadata = file.metadataJson && typeof file.metadataJson === "object" && !Array.isArray(file.metadataJson)
        ? file.metadataJson as Record<string, unknown>
        : {};
      if (file.status === "rejected" || metadata.attachmentState === "blocked_file_type") {
        return res.status(409).json({ message: "Inbound attachment is not available for download." });
      }

      const resolved = await canonicalFileReadResolver.resolveOriginal(file.fileRecordId);
      if (resolved.status !== "available" || !resolved.providerConfigId) {
        return res.status(404).json({ message: "Inbound attachment file is unavailable" });
      }

      const providerConfig = await storageProviderConfigRepository.getByIdForOrganization(organizationId, resolved.providerConfigId);
      if (!providerConfig) return res.status(404).json({ message: "Inbound attachment storage provider not found" });

      const handle = await storageRegistry.getAdapter(providerConfig.providerType).getDownloadHandle({
        providerConfig,
        objectKey: resolved.objectKey,
        localPathRef: resolved.localPathRef,
      });
      const filename = (file.sourceFilename || "attachment")
        .replace(/[\r\n\t\0]/g, " ")
        .replace(/"/g, "'")
        .slice(0, 240);

      if (handle.kind === "local_path") {
        await fsPromises.access(handle.value, fsPromises.constants.R_OK);
        return res.download(path.resolve(handle.value), filename);
      }

      const upstream = await fetch(handle.value);
      if (!upstream.ok) {
        throw new Error(`Attachment fetch failed: ${upstream.status} ${upstream.statusText}`);
      }
      res.setHeader("Content-Type", file.mimeType || upstream.headers.get("content-type") || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      console.error("Error downloading inbound order attachment:", error);
      res.status(500).json({ message: "Failed to download inbound attachment" });
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

      if (!result.draft) {
        const firstError = Array.isArray(result.latestAttempt.errors)
          ? result.latestAttempt.errors.find((item: any) => typeof item?.message === "string")?.message
          : null;
        return res.status(422).json({
          success: false,
          message: firstError || "Parse completed but did not produce a usable review draft.",
          data: result,
        });
      }

      try {
        const reviewDraft = await service.refreshReviewDraftFromLatestParse({
          organizationId,
          inboundRecordId: String(req.params.id),
          actorUserId,
        });
        await eventRepository.createEvent({
          organizationId,
          inboundRecordId: String(req.params.id),
          actorUserId,
          actorType: "user",
          eventType: "parse.review_draft_persisted",
          fromStatus: result.record.status,
          toStatus: reviewDraft.status === "ready_to_convert" ? "ready" : result.record.status,
          message: "Editable review draft persisted after parse.",
          metadataJson: {
            parseAttemptId: result.latestAttempt.id,
            reviewDraftId: reviewDraft.id,
            reviewDraftStatus: reviewDraft.status,
            extractedLineItemCount: result.draft.lineItems.length,
            extractedAttachmentCount: result.draft.artwork.length,
            poCandidateCount: (result.draft.evidence?.items ?? []).filter((item) => item.type === "PDF_ATTACHMENT" && item.documentType === "purchase_order").length,
            missingDecisionCount: result.draft.missingDecisions.length,
            warningCount: result.draft.globalWarnings.length,
            reviewDraftPersisted: true,
          },
        });
        res.json({ success: true, data: { ...result, reviewDraft } });
      } catch (draftError) {
        const message = draftError instanceof Error ? draftError.message : "Failed to persist review draft after parse.";
        await eventRepository.createEvent({
          organizationId,
          inboundRecordId: String(req.params.id),
          actorUserId,
          actorType: "system",
          eventType: "parse.review_draft_persistence_failed",
          fromStatus: result.record.status,
          toStatus: result.record.status,
          message,
          metadataJson: {
            parseAttemptId: result.latestAttempt.id,
            extractedLineItemCount: result.draft.lineItems.length,
            extractedAttachmentCount: result.draft.artwork.length,
            poCandidateCount: (result.draft.evidence?.items ?? []).filter((item) => item.type === "PDF_ATTACHMENT" && item.documentType === "purchase_order").length,
            missingDecisionCount: result.draft.missingDecisions.length,
            warningCount: result.draft.globalWarnings.length,
            reviewDraftPersisted: false,
            errorMessage: message,
          },
        });
        return res.status(500).json({
          success: false,
          message: "Parse could not save the review draft. Please retry.",
          data: result,
        });
      }
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

  // Persist the current review form, validate it, advance readiness internally,
  // and create the tenant-scoped order as one command. Manual save/ready routes
  // remain available for review handoff workflows.
  app.post("/api/inbound-orders/:id/create-order", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const draft = inboundOrderReviewDraftSaveSchema.parse(req.body ?? {});
      const result = await service.createOrderFromReviewDraft({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
        draft,
      });

      return res.json({
        success: true,
        data: {
          orderId: result.orderId,
          orderNumber: result.orderNumber,
          inboundOrderId: result.inboundOrderId,
          convertedAt: result.convertedAt,
          alreadyConverted: Boolean(result.alreadyConverted),
          order: result.order,
          inbound: result.inbound,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: fromZodError(error).message, errors: error.errors.map((issue) => issue.message) });
      }
      if (error instanceof InboundOrderReviewDraftValidationError || error instanceof InboundOrderConversionValidationError) {
        return res.status(error.statusCode).json({ success: false, message: error.message, errors: error.errors });
      }
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      if (isMissingInboundSchemaError(error)) return sendInboundSchemaUnavailable(res);
      console.error("Error creating order from inbound review draft:", error);
      return res.status(500).json({ success: false, message: "Failed to create order from inbound review." });
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

  app.post("/api/inbound-orders/:id/ignore", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const input = inboundOrderIgnoreActionSchema.parse(req.body ?? {});
      const detail = await service.applyIgnoreAction({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
        action: input.action,
        note: input.note ?? null,
        resolveConflict: input.resolveConflict,
      });

      res.json({ success: true, data: detail });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      if (error instanceof InboundEmailRuleConflictError) return sendInboundRuleConflict(res, error);
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      console.error("Error ignoring inbound order record:", error);
      res.status(500).json({ message: "Failed to ignore inbound order record" });
    }
  });

  app.delete("/api/inbound-orders/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const input = reviewActionSchema.parse(req.body ?? {});
      const detail = await service.deleteQueueRecord({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
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
      console.error("Error deleting inbound order queue record:", error);
      res.status(500).json({ message: "Failed to delete inbound order queue record" });
    }
  });

  app.post("/api/inbound-orders/bulk-action", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const input = inboundOrderBulkActionSchema.parse(req.body ?? {});
      const result = await service.applyBulkQueueAction({
        organizationId,
        actorUserId,
        recordIds: input.recordIds,
        action: input.action,
        note: input.note ?? null,
        resolveConflict: input.resolveConflict,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error applying inbound order bulk action:", error);
      res.status(500).json({ message: "Failed to update selected inbound records" });
    }
  });

  app.post("/api/inbound-orders/combine", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const input = inboundOrderCombineSchema.parse(req.body ?? {});
      const result = await service.combineInboundRecords({
        organizationId,
        actorUserId,
        recordIds: input.recordIds,
        primaryRecordId: input.primaryRecordId,
        confirmCustomerMismatch: input.confirmCustomerMismatch,
        confirmMultipleDrafts: input.confirmMultipleDrafts,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      console.error("Error combining inbound order records:", error);
      res.status(500).json({ message: "Failed to combine selected inbound records" });
    }
  });

  app.post("/api/inbound-orders/:id/attach-to-order", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const input = inboundOrderAttachToOrderSchema.parse(req.body ?? {});
      const result = await service.attachInboundRecordToOrder({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
        ...input,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      console.error("Error attaching inbound record to existing order:", error);
      res.status(500).json({ message: "Failed to attach inbound record to the selected order" });
    }
  });

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

  app.post("/api/inbound-orders/:id/create-customer", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const input = inboundCustomerCreateSchema.parse(req.body ?? {});
      const detail = await service.createCustomerForInbound({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
        ...input,
      });

      res.status(201).json({ success: true, data: detail });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const message = fromZodError(error).message;
        return res.status(400).json({ success: false, message, blockers: [message], warnings: [] });
      }

      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ success: false, message: error.message, blockers: [error.message], warnings: [] });
      }

      console.error("Error creating inbound customer:", error);
      res.status(500).json({ success: false, message: "Failed to create inbound customer", blockers: [], warnings: [] });
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

      const result = await service.createQuoteDraftFromInbound({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
      });

      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          blockers: [error.message],
          warnings: [],
        });
      }

      console.error("Error creating quote draft from inbound order:", error);
      res.status(500).json({ success: false, message: "Failed to create quote draft from inbound order", blockers: [], warnings: [] });
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
          orderNumber: result.orderNumber,
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
