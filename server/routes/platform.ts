/**
 * platform.ts — /api/platform router
 *
 * Routes:
 *   POST /api/platform/reauth      — step-up password re-entry (any logged-in user)
 *   POST /api/platform/orgs        — create org (platform-admin only + step-up required)
 *
 * Authorization model:
 *   - requirePlatformAdminOr404: unauthenticated OR non-platform-admin → 404
 *   - requireStepUp: allows if (a) session.platformReauthAt within 10 min
 *                          OR (b) user.lastLoginAt within 15 min
 *     If not satisfied → 401 { success:false, code:'STEP_UP_REQUIRED' }
 *     This middleware only runs AFTER requirePlatformAdminOr404, so non-admins
 *     never see step-up errors.
 */

import { Router, type RequestHandler } from "express";
import type { Request, Response, NextFunction } from "express";
import { getPublicWebOrigin } from "../lib/appRuntimeConfig";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { db } from "../db";
import { authIdentities, users } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { writePlatformAuditLog } from "../services/platformAuditLogService";
import { createOrgWithInvite, slugify, DuplicateInviteError } from "../services/orgOnboardingService";
import { organizations, auditLogs } from "@shared/schema";
import { notifyDevCritical, notifyDev } from "../services/devNotify";
import { bootstrapAdminBodySchema, bootstrapPlatformAdmin } from "../services/bootstrapAdminService";
import {
  copyOrganizationConfiguration,
  getConfigurationCopyJob,
  getConfigurationCopyPreview,
  listRecentConfigurationCopyJobs,
  OrganizationConfigurationCopyError,
  retryConfigurationCopyJob,
} from "../services/organizationConfigurationCopyService";
import {
  getEditableOrganizations,
  OrganizationEditorError,
  updateOrganizationForPlatform,
} from "../services/organizationEditorService";
import { customerContactMigrationService } from "../services/customerContactMigration/service";

// ─── Session type augmentation ────────────────────────────────────────────────
declare module "express-session" {
  interface SessionData {
    platformReauthAt?: number; // Date.now() timestamp, ms
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Handles both Replit (claims.sub) and local (id) auth user objects. */
function getUserId(user: any): string | undefined {
  return user?.claims?.sub ?? user?.id;
}

/**
 * Base URL for invite links — must resolve to the FRONTEND (Vercel), not the backend.
 * Priority: APP_PUBLIC_WEB_ORIGIN → APP_URL (legacy) → request origin (last resort only).
 * On Railway, set APP_PUBLIC_WEB_ORIGIN to the Vercel frontend URL, e.g.
 *   APP_PUBLIC_WEB_ORIGIN=https://dev.printershero.com
 */
function getBaseUrl(req: Request): string {
  const configured = getPublicWebOrigin() ?? (process.env.APP_URL ?? "").replace(/\/$/, "");
  if (configured) {
    console.log(`[platform/getBaseUrl] Using configured origin: ${configured}`);
    return configured;
  }
  const fallback = `${req.protocol}://${req.get("host")}`.replace(/\/$/, "");
  console.warn(`[platform/getBaseUrl] WARNING: APP_PUBLIC_WEB_ORIGIN not set — falling back to request host ${fallback}. Invite links may point to the backend instead of the frontend.`);
  return fallback;
}

function isBootstrapModeEnabled(): boolean {
  return (process.env.BOOTSTRAP_MODE ?? "").trim().toLowerCase() === "true";
}

function timingSafeTokenMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

// ─── Middleware: requirePlatformAdminOr404 ────────────────────────────────────
/**
 * Returns 404 for unauthenticated requests AND for authenticated non-platform-admins.
 * This way the route's existence is never revealed to non-admins.
 */
const requirePlatformAdminOr404: RequestHandler = async (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(404).json({ message: "Not Found" });
  }

  const userId = getUserId(req.user);
  if (!userId) {
    return res.status(404).json({ message: "Not Found" });
  }

  // Fetch fresh from DB to prevent session-cached stale value
  const [dbUser] = await db
    .select({ isPlatformAdmin: users.isPlatformAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!dbUser?.isPlatformAdmin) {
    return res.status(404).json({ message: "Not Found" });
  }

  next();
};

const requirePlatformOperatorOr404: RequestHandler = async (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(404).json({ message: "Not Found" });
  }

  const userId = getUserId(req.user);
  if (!userId) {
    return res.status(404).json({ message: "Not Found" });
  }

  const [dbUser] = await db
    .select({ isPlatformAdmin: users.isPlatformAdmin, isPlatformDeveloper: users.isPlatformDeveloper })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!dbUser?.isPlatformAdmin && !dbUser?.isPlatformDeveloper) {
    return res.status(404).json({ message: "Not Found" });
  }

  next();
};

// ─── Middleware: requireStepUp ────────────────────────────────────────────────
const REAUTH_WINDOW_MS = 10 * 60 * 1000;   // 10 minutes
const LOGIN_WINDOW_MS  = 15 * 60 * 1000;   // 15 minutes

const requireStepUp: RequestHandler = async (req, res, next) => {
  const now = Date.now();

  // (a) Recent explicit re-auth via /api/platform/reauth
  const reauthAt = req.session.platformReauthAt;
  if (reauthAt && now - reauthAt < REAUTH_WINDOW_MS) {
    return next();
  }

  // (b) Recent login within 15 minutes based on user.lastLoginAt
  const userId = getUserId(req.user);
  if (userId) {
    const [dbUser] = await db
      .select({ lastLoginAt: users.lastLoginAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (dbUser?.lastLoginAt) {
      const loginAge = now - new Date(dbUser.lastLoginAt).getTime();
      if (loginAge < LOGIN_WINDOW_MS) {
        return next();
      }
    }
  }

  return res.status(401).json({ success: false, code: "STEP_UP_REQUIRED" });
};

// ─── Rate limiter: 5 org creations per hour per IP ───────────────────────────
const orgCreateRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Combine IPv6-safe IP + userId for per-user limiting where possible.
    // ipKeyGenerator normalises IPv6 addresses to avoid ERR_ERL_KEY_GEN_IPV6.
    const ipKey = ipKeyGenerator(req.ip ?? "unknown");
    const userId = getUserId(req.user) ?? "anon";
    return `${ipKey}:${userId}`;
  },
  message: { success: false, message: "Too many organization creation requests. Try again later." },
});

// ─── Zod schemas ──────────────────────────────────────────────────────────────
const reauthBodySchema = z.object({
  password: z.string().min(1, "Password required"),
});

const createOrgBodySchema = z.object({
  name: z.string().min(1, "Org name required").max(255),
  slug: z.string().max(100).regex(/^[a-z0-9-]*$/, "Slug must be lowercase alphanumeric with hyphens").optional(),
  ownerEmail: z.string().email("A valid owner email is required"),
  seedConfiguration: z.object({
    enabled: z.boolean().default(false),
    sourceOrganizationId: z.string().min(1).optional(),
  }).optional(),
});

const copyPreviewParamsSchema = z.object({
  organizationId: z.string().min(1),
});

const copyJobParamsSchema = z.object({
  jobId: z.string().min(1),
});

const updateOrgParamsSchema = z.object({
  orgId: z.string().min(1),
});

const updateOrgBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z.string().min(1).max(100).optional(),
  isArchived: z.boolean().optional(),
}).strict().refine((body) => body.name !== undefined || body.slug !== undefined || body.isArchived !== undefined, {
  message: "At least one editable field is required.",
});

const migrationBatchCreateSchema = z.object({
  organizationId: z.string().min(1),
  sourceLabel: z.string().max(255).optional(),
  quickBooksSourceSnapshotId: z.string().min(1).optional(),
  qbSourceLabel: z.string().max(255).optional(),
  quickBooksCustomers: z.array(z.record(z.any())).optional(),
  infoFloCompanyCsv: z.string().optional(),
  infoFloCompanyFilename: z.string().max(255).optional(),
  infoFloContactsCsv: z.string().optional(),
  infoFloContactsFilename: z.string().max(255).optional(),
});

const migrationQuickBooksSourceBodySchema = z.object({
  organizationId: z.string().min(1),
});

const migrationQuickBooksSourceUploadSchema = z.object({
  organizationId: z.string().min(1),
  quickBooksCustomers: z.array(z.record(z.any())),
});

const migrationBatchParamsSchema = z.object({
  batchId: z.string().min(1),
});

const migrationBatchFinalizeSchema = z.object({
  organizationId: z.string().min(1),
  confirmation: z.literal("FINALIZE"),
});

// ─── Router ───────────────────────────────────────────────────────────────────
export function registerPlatformRoutes(app: import("express").Express): void {
  const router = Router();

  /**
   * POST /api/platform/bootstrap-admin
   * One-time bootstrap path to create the first platform admin.
   *
   * Guardrails:
   * - Disabled unless BOOTSTRAP_MODE=true
   * - Requires x-bootstrap-token header matching BOOTSTRAP_TOKEN
   * - Refuses once any platform admin exists
   */
  router.post("/bootstrap-admin", async (req: Request, res: Response) => {
    if (!isBootstrapModeEnabled()) {
      return res.status(404).json({ success: false, data: null, message: "Not Found" });
    }

    const configuredToken = (process.env.BOOTSTRAP_TOKEN ?? "").trim();
    if (!configuredToken) {
      return res.status(503).json({
        success: false,
        data: null,
        message: "Bootstrap is enabled but BOOTSTRAP_TOKEN is not configured.",
      });
    }

    const providedToken = (req.get("x-bootstrap-token") ?? "").trim();
    if (!providedToken || !timingSafeTokenMatch(configuredToken, providedToken)) {
      return res.status(403).json({ success: false, data: null, message: "Forbidden" });
    }

    const parse = bootstrapAdminBodySchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({
        success: false,
        data: null,
        message: parse.error.issues[0]?.message ?? "Validation failed",
      });
    }

    try {
      const result = await bootstrapPlatformAdmin(parse.data);

      if (result.status === "already_bootstrapped") {
        return res.status(409).json({
          success: false,
          data: { existingAdminId: result.existingAdminId },
          message: "Bootstrap already completed. Platform admin already exists.",
        });
      }

      await writePlatformAuditLog({
        action: "platform.bootstrap_admin",
        actorUserId: result.userId,
        actorEmail: result.email,
        req,
        orgId: result.organizationId,
        metadata: {
          bootstrap: true,
          userId: result.userId,
          email: result.email,
          organizationId: result.organizationId,
        },
      });

      return res.status(201).json({
        success: true,
        data: {
          userId: result.userId,
          organizationId: result.organizationId,
        },
        message: "Initial platform admin created.",
      });
    } catch (err: any) {
      if (err?.code === "23505") {
        return res.status(409).json({
          success: false,
          data: null,
          message: "Bootstrap conflict: user or organization already exists.",
        });
      }

      console.error("[platform/bootstrap-admin] error:", err);
      return res.status(500).json({
        success: false,
        data: null,
        message: "Failed to bootstrap platform admin.",
      });
    }
  });

  /**
   * POST /api/platform/reauth
   * Any authenticated user (not admin-gated) — for step-up upgrade.
   */
  router.post("/reauth", async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const parse = reauthBodySchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ success: false, message: parse.error.issues[0].message });
    }

    const { password } = parse.data;
    const userId = getUserId(req.user);

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // Look up auth identity
    const [identity] = await db
      .select()
      .from(authIdentities)
      .where(and(eq(authIdentities.userId, userId), eq(authIdentities.provider, "password")))
      .limit(1);

    const actorEmail = (req.user as any)?.email ?? "unknown";

    if (!identity?.passwordHash) {
      await writePlatformAuditLog({
        action: "platform.reauth",
        actorUserId: userId,
        actorEmail,
        req,
        metadata: { ok: false, reason: "no_password_identity" },
      });
      return res.status(401).json({ success: false });
    }

    const isValid = await bcrypt.compare(password, identity.passwordHash);

    await writePlatformAuditLog({
      action: "platform.reauth",
      actorUserId: userId,
      actorEmail,
      req,
      metadata: { ok: isValid },
    });

    if (!isValid) {
      return res.status(401).json({ success: false });
    }

    req.session.platformReauthAt = Date.now();
    return res.json({ success: true });
  });

  /**
   * GET /api/platform/orgs
   * Platform admin organization selector data for configuration seeding.
   */
  router.get("/orgs", requirePlatformOperatorOr404, async (_req: Request, res: Response) => {
    try {
      const orgs = await getEditableOrganizations();
      return res.json({ success: true, data: orgs });
    } catch (error) {
      console.error("[platform/orgs] list error:", error);
      return res.status(500).json({ success: false, message: "Failed to list organizations." });
    }
  });

  /**
   * PATCH /api/platform/orgs/:orgId
   * Developer/platform-admin safe organization editor.
   */
  router.patch(
    "/orgs/:orgId",
    requirePlatformOperatorOr404,
    requireStepUp,
    async (req: Request, res: Response) => {
      const params = updateOrgParamsSchema.safeParse(req.params);
      if (!params.success) {
        return res.status(400).json({ success: false, message: "Invalid organization ID." });
      }

      const body = updateOrgBodySchema.safeParse(req.body);
      if (!body.success) {
        return res.status(400).json({
          success: false,
          message: body.error.issues[0]?.message ?? "Invalid organization update.",
        });
      }

      const userId = getUserId(req.user);
      const actorEmail = (req.user as any)?.email ?? "unknown";
      if (!userId) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      try {
        const result = await updateOrganizationForPlatform({
          organizationId: params.data.orgId,
          actorUserId: userId,
          ...body.data,
        });

        await writePlatformAuditLog({
          action: "org.update",
          actorUserId: userId,
          actorEmail,
          req,
          orgId: result.organization.id,
          metadata: {
            organizationId: result.organization.id,
            previousName: result.previous.name,
            newName: result.organization.name,
            previousSlug: result.previous.slug,
            newSlug: result.organization.slug,
            previousArchiveState: result.previous.isArchived,
            newArchiveState: result.organization.isArchived,
          },
        });

        return res.json({ success: true, data: result.organization });
      } catch (error: any) {
        if (error instanceof OrganizationEditorError) {
          return res.status(error.statusCode).json({
            success: false,
            code: error.code,
            message: error.message,
            details: error.details,
          });
        }
        console.error("[platform/orgs] update error:", error);
        return res.status(500).json({ success: false, message: "Failed to update organization." });
      }
    }
  );

  /**
   * GET /api/platform/orgs/:organizationId/configuration-copy-preview
   * Read-only source configuration preview.
   */
  router.get(
    "/orgs/:organizationId/configuration-copy-preview",
    requirePlatformAdminOr404,
    async (req: Request, res: Response) => {
      const params = copyPreviewParamsSchema.safeParse(req.params);
      if (!params.success) {
        return res.status(400).json({ success: false, message: "Invalid organization ID." });
      }
      try {
        const preview = await getConfigurationCopyPreview(params.data.organizationId);
        return res.json({ success: true, data: preview });
      } catch (error: any) {
        if (error instanceof OrganizationConfigurationCopyError) {
          return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
        }
        console.error("[platform/configuration-copy-preview] error:", error);
        return res.status(500).json({ success: false, message: "Failed to preview configuration copy." });
      }
    }
  );

  /**
   * GET /api/platform/organization-copy-jobs
   * Read-only recent configuration copy jobs for Developer Tools diagnostics.
   */
  router.get("/organization-copy-jobs", requirePlatformAdminOr404, async (req: Request, res: Response) => {
    try {
      const limit = Number.parseInt(String(req.query.limit ?? "10"), 10);
      const jobs = await listRecentConfigurationCopyJobs(Number.isFinite(limit) ? limit : 10);
      return res.json({ success: true, data: jobs });
    } catch (error) {
      console.error("[platform/organization-copy-jobs] list error:", error);
      return res.status(500).json({ success: false, message: "Failed to list configuration copy jobs." });
    }
  });

  /**
   * GET /api/platform/organization-copy-jobs/:jobId
   */
  router.get("/organization-copy-jobs/:jobId", requirePlatformAdminOr404, async (req: Request, res: Response) => {
    const params = copyJobParamsSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ success: false, message: "Invalid copy job ID." });
    }
    const job = await getConfigurationCopyJob(params.data.jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: "Copy job not found." });
    }
    return res.json({ success: true, data: job });
  });

  /**
   * POST /api/platform/organization-copy-jobs/:jobId/retry
   */
  router.post(
    "/organization-copy-jobs/:jobId/retry",
    requirePlatformAdminOr404,
    requireStepUp,
    async (req: Request, res: Response) => {
      const params = copyJobParamsSchema.safeParse(req.params);
      if (!params.success) {
        return res.status(400).json({ success: false, message: "Invalid copy job ID." });
      }
      const userId = getUserId(req.user);
      const actorEmail = (req.user as any)?.email ?? "unknown";
      if (!userId) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      try {
        const result = await retryConfigurationCopyJob(params.data.jobId, userId);
        await writePlatformAuditLog({
          action: "org.configuration_copy.retry",
          actorUserId: userId,
          actorEmail,
          req,
          orgId: result.destinationOrganizationId,
          metadata: { configurationCopy: result },
        });
        const status = result.status === "completed" ? 200 : 500;
        return res.status(status).json({ success: result.status === "completed", data: result, message: result.errorSummary ?? undefined });
      } catch (error: any) {
        if (error instanceof OrganizationConfigurationCopyError) {
          return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message, details: error.details });
        }
        console.error("[platform/organization-copy-jobs/retry] error:", error);
        return res.status(500).json({ success: false, message: "Failed to retry configuration copy." });
      }
    }
  );

  /**
   * Customer/contact migration batches.
   * Platform operator only. Target tenant is explicit in the request body/query
   * because this workflow is run from the platform Developer Tools area.
   */
  router.get("/customer-contact-migrations/qb-source/status", requirePlatformOperatorOr404, async (req: Request, res: Response) => {
    const organizationId = String(req.query.organizationId ?? "").trim();
    if (!organizationId) {
      return res.status(400).json({ success: false, message: "organizationId query parameter is required." });
    }
    try {
      const status = await customerContactMigrationService.getQuickBooksSourceStatus(organizationId);
      return res.json({ success: true, data: status });
    } catch (error) {
      console.error("[platform/customer-contact-migrations/qb-source/status] error:", error);
      return res.status(500).json({ success: false, message: "Failed to check QuickBooks source status." });
    }
  });

  router.post("/customer-contact-migrations/qb-source/retrieve", requirePlatformOperatorOr404, async (req: Request, res: Response) => {
    const parse = migrationQuickBooksSourceBodySchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ success: false, message: parse.error.issues[0]?.message ?? "Invalid QuickBooks source request." });
    }
    const actorUserId = getUserId(req.user);
    if (!actorUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    try {
      const result = await customerContactMigrationService.retrieveQuickBooksSourceSnapshot({
        organizationId: parse.data.organizationId,
        actorUserId,
      });

      await writePlatformAuditLog({
        action: "customer_contact_migration.qb_source_retrieved",
        actorUserId,
        actorEmail: (req.user as any)?.email ?? "unknown",
        req,
        orgId: parse.data.organizationId,
        metadata: {
          snapshotId: result.snapshot.id,
          customerCount: result.customerCount,
          connectedCompanyName: result.status.connectedCompanyName,
          quickBooksCompanyId: result.status.quickBooksCompanyId,
        },
      });

      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      const statusCode = Number(error?.statusCode || 500);
      if (statusCode >= 400 && statusCode < 500) {
        return res.status(statusCode).json({ success: false, message: error.message });
      }
      console.error("[platform/customer-contact-migrations/qb-source/retrieve] error:", error);
      return res.status(500).json({ success: false, message: "Failed to retrieve QuickBooks customers." });
    }
  });

  router.post("/customer-contact-migrations/qb-source/upload", requirePlatformOperatorOr404, async (req: Request, res: Response) => {
    const parse = migrationQuickBooksSourceUploadSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ success: false, message: parse.error.issues[0]?.message ?? "Invalid QuickBooks JSON fallback." });
    }
    const actorUserId = getUserId(req.user);
    if (!actorUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    try {
      const result = await customerContactMigrationService.uploadQuickBooksSourceSnapshot({
        organizationId: parse.data.organizationId,
        actorUserId,
        quickBooksCustomers: parse.data.quickBooksCustomers,
      });

      await writePlatformAuditLog({
        action: "customer_contact_migration.qb_source_uploaded",
        actorUserId,
        actorEmail: (req.user as any)?.email ?? "unknown",
        req,
        orgId: parse.data.organizationId,
        metadata: { snapshotId: result.snapshot.id, customerCount: result.customerCount },
      });

      return res.status(201).json({ success: true, data: result });
    } catch (error) {
      console.error("[platform/customer-contact-migrations/qb-source/upload] error:", error);
      return res.status(500).json({ success: false, message: "Failed to stage uploaded QuickBooks customers." });
    }
  });

  router.get("/customer-contact-migrations", requirePlatformOperatorOr404, async (req: Request, res: Response) => {
    const organizationId = String(req.query.organizationId ?? "").trim();
    if (!organizationId) {
      return res.status(400).json({ success: false, message: "organizationId query parameter is required." });
    }
    const limit = Number.parseInt(String(req.query.limit ?? "25"), 10);
    try {
      const batches = await customerContactMigrationService.listBatches(organizationId, Number.isFinite(limit) ? limit : 25);
      return res.json({ success: true, data: batches });
    } catch (error) {
      console.error("[platform/customer-contact-migrations] list error:", error);
      return res.status(500).json({ success: false, message: "Failed to list migration batches." });
    }
  });

  router.post("/customer-contact-migrations", requirePlatformOperatorOr404, async (req: Request, res: Response) => {
    const parse = migrationBatchCreateSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ success: false, message: parse.error.issues[0]?.message ?? "Invalid migration batch." });
    }
    const actorUserId = getUserId(req.user);
    if (!actorUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    try {
      const result = await customerContactMigrationService.createBatch({
        organizationId: parse.data.organizationId,
        actorUserId,
        sourceLabel: parse.data.sourceLabel,
        quickBooksSourceSnapshotId: parse.data.quickBooksSourceSnapshotId,
        qbSourceLabel: parse.data.qbSourceLabel,
        quickBooksCustomers: parse.data.quickBooksCustomers,
        infoFloCompanyCsv: parse.data.infoFloCompanyCsv,
        infoFloCompanyFilename: parse.data.infoFloCompanyFilename,
        infoFloContactsCsv: parse.data.infoFloContactsCsv,
        infoFloContactsFilename: parse.data.infoFloContactsFilename,
      });

      await writePlatformAuditLog({
        action: "customer_contact_migration.batch_created",
        actorUserId,
        actorEmail: (req.user as any)?.email ?? "unknown",
        req,
        orgId: parse.data.organizationId,
        metadata: { batchId: result.batch.id, summary: result.summary },
      });

      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      if (error?.statusCode === 400) {
        return res.status(400).json({ success: false, message: error.message, details: error.errors });
      }
      console.error("[platform/customer-contact-migrations] create error:", error);
      return res.status(500).json({ success: false, message: "Failed to create migration batch." });
    }
  });

  router.get("/customer-contact-migrations/:batchId", requirePlatformOperatorOr404, async (req: Request, res: Response) => {
    const params = migrationBatchParamsSchema.safeParse(req.params);
    const organizationId = String(req.query.organizationId ?? "").trim();
    if (!params.success) return res.status(400).json({ success: false, message: "Invalid batch ID." });
    if (!organizationId) return res.status(400).json({ success: false, message: "organizationId query parameter is required." });

    try {
      const batch = await customerContactMigrationService.getBatch(organizationId, params.data.batchId);
      if (!batch) return res.status(404).json({ success: false, message: "Migration batch not found." });
      return res.json({ success: true, data: batch });
    } catch (error) {
      console.error("[platform/customer-contact-migrations] get error:", error);
      return res.status(500).json({ success: false, message: "Failed to load migration batch." });
    }
  });

  router.post(
    "/customer-contact-migrations/:batchId/finalize",
    requirePlatformOperatorOr404,
    requireStepUp,
    async (req: Request, res: Response) => {
      const params = migrationBatchParamsSchema.safeParse(req.params);
      const body = migrationBatchFinalizeSchema.safeParse(req.body);
      if (!params.success) return res.status(400).json({ success: false, message: "Invalid batch ID." });
      if (!body.success) return res.status(400).json({ success: false, message: body.error.issues[0]?.message ?? "Invalid finalization request." });
      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

      try {
        const result = await customerContactMigrationService.finalizeBatch(
          body.data.organizationId,
          params.data.batchId,
          actorUserId,
          body.data.confirmation,
        );

        await writePlatformAuditLog({
          action: "customer_contact_migration.batch_finalized",
          actorUserId,
          actorEmail: (req.user as any)?.email ?? "unknown",
          req,
          orgId: body.data.organizationId,
          metadata: { batchId: params.data.batchId, counts: result.counts },
        });

        return res.json({ success: true, data: result });
      } catch (error: any) {
        const status = error?.statusCode ?? 500;
        console.error("[platform/customer-contact-migrations] finalize error:", error);
        return res.status(status).json({ success: false, message: error?.message ?? "Failed to finalize migration batch." });
      }
    },
  );

  router.get("/customer-contact-migrations/:batchId/report/:kind", requirePlatformOperatorOr404, async (req: Request, res: Response) => {
    const params = migrationBatchParamsSchema.safeParse(req.params);
    const organizationId = String(req.query.organizationId ?? "").trim();
    const kind = String(req.params.kind ?? "").trim();
    if (!params.success) return res.status(400).json({ success: false, message: "Invalid batch ID." });
    if (!organizationId) return res.status(400).json({ success: false, message: "organizationId query parameter is required." });

    const batch = await customerContactMigrationService.getBatch(organizationId, params.data.batchId);
    if (!batch) return res.status(404).json({ success: false, message: "Migration batch not found." });

    const report = customerContactMigrationService.buildReportCsv(kind, params.data.batchId, batch);
    if (!report) return res.status(400).json({ success: false, message: "Unknown report kind." });
    res.setHeader("Content-Type", report.contentType);
    res.setHeader("Content-Disposition", report.contentDisposition);
    return res.send(report.body);
  });

  /**
   * POST /api/platform/orgs
   * Platform-admin only + step-up required.
   */
  router.post(
    "/orgs",
    requirePlatformAdminOr404,
    requireStepUp,
    orgCreateRateLimit,
    async (req: Request, res: Response) => {
      const parse = createOrgBodySchema.safeParse(req.body);
      if (!parse.success) {
        return res.status(400).json({ success: false, message: parse.error.issues[0].message });
      }

      const { name, slug: rawSlug, ownerEmail, seedConfiguration } = parse.data;
      const resolvedSlug = (rawSlug && rawSlug.trim()) ? rawSlug.trim() : slugify(name);
      const shouldSeedConfiguration = seedConfiguration?.enabled === true;
      const sourceOrganizationId = seedConfiguration?.sourceOrganizationId?.trim();

      if (shouldSeedConfiguration && !sourceOrganizationId) {
        return res.status(400).json({ success: false, message: "Source organization is required when seeding configuration." });
      }

      if (!resolvedSlug) {
        return res.status(400).json({ success: false, message: "Could not derive a valid slug from org name." });
      }

      const userId = getUserId(req.user)!;
      const actorEmail = (req.user as any)?.email ?? "unknown";

      try {
        if (shouldSeedConfiguration && sourceOrganizationId) {
          await getConfigurationCopyPreview(sourceOrganizationId);
        }

        const result = await createOrgWithInvite({
          name,
          slug: resolvedSlug,
          createdByUserId: userId,
          ownerEmail,
        });

        const inviteLink = `${getBaseUrl(req)}/accept-invite?token=${result.inviteToken}`;
        // Log domain+path only — never log the raw token
        console.log(`[platform/orgs] Invite link generated: ${getBaseUrl(req)}/accept-invite (token omitted)`);

        await writePlatformAuditLog({
          action: "org.create",
          actorUserId: userId,
          actorEmail,
          req,
          orgId: result.orgId,
          metadata: {
            orgId: result.orgId,
            name,
            slug: resolvedSlug,
            ownerEmail: result.ownerEmail,
            inviteCreated: true,
          },
        });

        let configurationCopy = null;
        if (shouldSeedConfiguration && sourceOrganizationId) {
          configurationCopy = await copyOrganizationConfiguration({
            sourceOrganizationId,
            destinationOrganizationId: result.orgId,
            requestedByUserId: userId,
          });

          await writePlatformAuditLog({
            action: configurationCopy.status === "completed" ? "org.configuration_copy.completed" : "org.configuration_copy.failed",
            actorUserId: userId,
            actorEmail,
            req,
            orgId: result.orgId,
            metadata: { configurationCopy },
          });

          if (configurationCopy.status !== "completed") {
            return res.status(500).json({
              success: false,
              code: "CONFIGURATION_COPY_FAILED",
              message: configurationCopy.errorSummary ?? "Organization created, but configuration copy failed.",
              data: {
                orgId: result.orgId,
                slug: result.slug,
                inviteLink,
                ownerEmail: result.ownerEmail,
                configurationCopy,
              },
            });
          }
        } else {
          await db
            .update(organizations)
            .set({
              settings: { setupStatus: "READY" },
              updatedAt: new Date(),
            } as any)
            .where(eq(organizations.id, result.orgId));
        }

        return res.status(201).json({
          success: true,
          data: {
            orgId: result.orgId,
            slug: result.slug,
            inviteLink,
            ownerEmail: result.ownerEmail,
            configurationCopy,
          },
        });
      } catch (err: any) {
        // Duplicate unaccepted invite for this (org, email)
        if (err instanceof DuplicateInviteError) {
          await writePlatformAuditLog({
            action: "org.create.failed",
            actorUserId: userId,
            actorEmail,
            req,
            metadata: { reason: "duplicate_invite", ownerEmail },
          });
          return res.status(409).json({ success: false, message: err.message });
        }
        if (err instanceof OrganizationConfigurationCopyError) {
          await writePlatformAuditLog({
            action: "org.create.failed",
            actorUserId: userId,
            actorEmail,
            req,
            metadata: { reason: err.code, sourceOrganizationId },
          });
          return res.status(err.statusCode).json({ success: false, code: err.code, message: err.message, details: err.details });
        }
        // Unique constraint on slug
        if (err?.message?.includes("unique") || err?.code === "23505") {
          await writePlatformAuditLog({
            action: "org.create.failed",
            actorUserId: userId,
            actorEmail,
            req,
            metadata: { reason: "slug_conflict", slug: resolvedSlug },
          });
          return res.status(409).json({ success: false, message: "An organization with that slug already exists." });
        }
        console.error("[platform/orgs] create error:", err);
        return res.status(500).json({ success: false, message: "Failed to create organization." });
      }
    }
  );

  /**
   * POST /api/platform/orgs/:orgId/finalize-delete
   * Platform admin finalizes organization deletion (soft delete).
   * Requires step-up auth + platform admin.
   */
  router.post(
    "/orgs/:orgId/finalize-delete",
    requirePlatformAdminOr404,
    requireStepUp,
    async (req: Request, res: Response) => {
      const { orgId } = req.params;
      const userId = getUserId(req.user);
      const actorEmail = (req.user as any)?.email || "unknown";

      if (!userId) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      try {
        // Get org details
        const [org] = await db
          .select({
            id: organizations.id,
            slug: organizations.slug,
            name: organizations.name,
            deleteState: organizations.deleteState,
          })
          .from(organizations)
          .where(eq(organizations.id, orgId))
          .limit(1);

        if (!org) {
          return res.status(404).json({ success: false, message: "Organization not found" });
        }

        // Validate org is in pending_delete state
        if (org.deleteState !== 'pending_delete') {
          return res.status(409).json({
            success: false,
            code: "ORG_NOT_PENDING_DELETE",
            message: `Organization is in ${org.deleteState} state, must be pending_delete to finalize`,
            deleteState: org.deleteState,
          });
        }

        // Extract IP and user agent
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const userAgent = req.get('user-agent') || 'unknown';

        // Update org to soft_deleted state
        await db
          .update(organizations)
          .set({
            deleteState: 'soft_deleted',
            deletedAt: new Date(),
            deletedByUserId: userId,
            deleteConfirmedAt: new Date(),
            deleteConfirmedByUserId: userId,
            deletedIp: ip,
            deletedUserAgent: userAgent,
          })
          .where(eq(organizations.id, orgId));

        // Audit log
        await db.insert(auditLogs).values({
          organizationId: orgId,
          userId,
          actionType: "org.delete.finalized",
          entityType: "organization",
          entityId: orgId,
          description: `Organization "${org.slug}" soft-deleted by platform admin`,
          newValues: {
            deleteState: 'soft_deleted',
            orgSlug: org.slug,
            orgName: org.name,
            ip,
            userAgent,
          },
        });

        // Platform audit log
        await writePlatformAuditLog({
          action: "org.delete.finalized",
          actorUserId: userId,
          actorEmail,
          req,
          metadata: {
            orgId,
            orgSlug: org.slug,
            orgName: org.name,
          },
        });

        // Notify devs (critical priority)
        await notifyDevCritical(
          'org.delete.finalized',
          `Organization "${org.slug}" (${org.name}) soft-deleted by platform admin ${actorEmail}`,
          {
            orgId,
            orgSlug: org.slug,
            orgName: org.name,
            platformAdminId: userId,
            platformAdminEmail: actorEmail,
          }
        );

        return res.json({
          success: true,
          message: `Organization "${org.slug}" has been soft-deleted and is no longer accessible`,
          deleteState: 'soft_deleted',
        });
      } catch (error: any) {
        console.error("[Platform] Finalize delete error:", error);
        return res.status(500).json({ success: false, message: "Failed to finalize organization deletion" });
      }
    }
  );

  /**
   * POST /api/platform/orgs/:orgId/restore
   * Platform admin restores soft-deleted organization.
   * Requires step-up auth + platform admin.
   */
  router.post(
    "/orgs/:orgId/restore",
    requirePlatformAdminOr404,
    requireStepUp,
    async (req: Request, res: Response) => {
      const { orgId } = req.params;
      const userId = getUserId(req.user);
      const actorEmail = (req.user as any)?.email || "unknown";

      if (!userId) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      try {
        // Get org details
        const [org] = await db
          .select({
            id: organizations.id,
            slug: organizations.slug,
            name: organizations.name,
            deleteState: organizations.deleteState,
          })
          .from(organizations)
          .where(eq(organizations.id, orgId))
          .limit(1);

        if (!org) {
          return res.status(404).json({ success: false, message: "Organization not found" });
        }

        // Validate org is soft_deleted or pending_delete
        if (org.deleteState === 'active') {
          return res.status(409).json({
            success: false,
            code: "ORG_ALREADY_ACTIVE",
            message: "Organization is already active",
          });
        }

        // Restore org to active state (clear delete tracking fields)
        await db
          .update(organizations)
          .set({
            deleteState: 'active',
            deleteRequestedAt: null,
            deleteRequestedByUserId: null,
            deleteConfirmedAt: null,
            deleteConfirmedByUserId: null,
            deletedAt: null,
            deletedByUserId: null,
            deleteReason: null,
            deletedIp: null,
            deletedUserAgent: null,
          })
          .where(eq(organizations.id, orgId));

        // Audit log
        await db.insert(auditLogs).values({
          organizationId: orgId,
          userId,
          actionType: "org.delete.restored",
          entityType: "organization",
          entityId: orgId,
          description: `Organization "${org.slug}" restored by platform admin`,
          newValues: {
            deleteState: 'active',
            orgSlug: org.slug,
            orgName: org.name,
          },
        });

        // Platform audit log
        await writePlatformAuditLog({
          action: "org.delete.restored",
          actorUserId: userId,
          actorEmail,
          req,
          metadata: {
            orgId,
            orgSlug: org.slug,
            orgName: org.name,
          },
        });

        // Notify devs
        await notifyDev({
          eventName: 'org.delete.restored',
          priority: 'high',
          organizationId: orgId,
          userId,
          message: `Organization "${org.slug}" (${org.name}) restored by platform admin ${actorEmail}`,
          metadata: {
            orgId,
            orgSlug: org.slug,
            orgName: org.name,
            platformAdminId: userId,
            platformAdminEmail: actorEmail,
          },
        });

        return res.json({
          success: true,
          message: `Organization "${org.slug}" has been restored and is now accessible`,
          deleteState: 'active',
        });
      } catch (error: any) {
        console.error("[Platform] Restore org error:", error);
        return res.status(500).json({ success: false, message: "Failed to restore organization" });
      }
    }
  );

  app.use("/api/platform", router);
}
